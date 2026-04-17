"""
pending_tickers 에 쌓인 추가 요청을 처리.

동작:
  - status='pending' 인 티커를 하나씩 가져와 백필
  - 6자리 숫자 → pykrx (KOSPI/KOSDAQ)
  - 그 외 (영문) → yfinance (NASDAQ/NYSE)
  - 성공: tickers 테이블에 추가 + pending에서 삭제
  - 실패: pending에 status='error', error_msg 기록

사용법:
    export DATABASE_URL="postgresql://..."
    python process_pending.py

    # 또는 로컬 SQLite
    python process_pending.py
"""
from __future__ import annotations

import os
import re
import sys
import time
from datetime import datetime
from dateutil.relativedelta import relativedelta
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from db import get_conn, init_db, is_pg
from backfill import fetch_ohlcv as fetch_kr, save_ohlcv, log_ingestion
from backfill_us import fetch_ohlcv_us, detect_exchange
from pathlib import Path


KR_RE = re.compile(r"^\d{6}$")
US_RE = re.compile(r"^[A-Z][-.A-Z0-9]{0,9}$")
TSV_FILE = Path(__file__).parent / "tickers_etf_kr.tsv"


def load_tsv_names() -> dict[str, str]:
    """tickers_etf_kr.tsv에서 코드→이름 맵. 파일 없으면 빈 dict."""
    names: dict[str, str] = {}
    if not TSV_FILE.exists():
        return names
    for line in TSV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t")
        if len(parts) >= 2:
            names[parts[0].strip()] = parts[1].strip()
    return names


def resolve_kr_name(ticker: str, fallback: str | None) -> str:
    """한국 티커 이름 해상도: 사용자 입력 → TSV → pykrx → 티커 코드."""
    if fallback:
        return fallback
    tsv = load_tsv_names()
    if ticker in tsv:
        return tsv[ticker]
    try:
        from pykrx import stock
        result = stock.get_market_ticker_name(ticker)
        if isinstance(result, str) and result.strip():
            return result.strip()
    except Exception:
        pass
    return ticker


def fetch_pending() -> list[tuple[str, str | None, str | None]]:
    conn = get_conn()
    try:
        rows = conn.execute(
            "SELECT ticker, requested_name, market_hint FROM pending_tickers "
            "WHERE status = 'pending' ORDER BY requested_at"
        ).fetchall()
        return [(r[0], r[1], r[2]) for r in rows]
    finally:
        conn.close()


def mark_processing(ticker: str) -> None:
    conn = get_conn()
    try:
        conn.execute(
            "UPDATE pending_tickers SET status='processing' WHERE ticker=?",
            (ticker,),
        )
        conn.commit()
    finally:
        conn.close()


def delete_pending(ticker: str) -> None:
    conn = get_conn()
    try:
        conn.execute("DELETE FROM pending_tickers WHERE ticker=?", (ticker,))
        conn.commit()
    finally:
        conn.close()


def mark_error(ticker: str, err: str) -> None:
    conn = get_conn()
    try:
        conn.execute(
            """UPDATE pending_tickers
               SET status='error', error_msg=?, processed_at=?
               WHERE ticker=?""",
            (err[:500], datetime.utcnow().isoformat(timespec="seconds"), ticker),
        )
        conn.commit()
    finally:
        conn.close()


def upsert_single_ticker(ticker: str, name: str, market: str) -> None:
    conn = get_conn()
    try:
        now = datetime.utcnow().isoformat(timespec="seconds")
        conn.execute(
            """INSERT INTO tickers(ticker, name, market, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                   name=excluded.name,
                   market=excluded.market,
                   updated_at=excluded.updated_at""",
            (ticker, name, market, now),
        )
        conn.commit()
    finally:
        conn.close()


def process_one(
    ticker: str, requested_name: str | None, market_hint: str | None,
    years: int = 10,
) -> None:
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)

    is_kr = bool(KR_RE.match(ticker))
    is_us = bool(US_RE.match(ticker))

    if not is_kr and not is_us:
        raise ValueError(f"알 수 없는 티커 형식: {ticker}")

    # 1) 데이터 가져오기
    if is_kr:
        df = fetch_kr(ticker, start_dt.strftime("%Y%m%d"), end_dt.strftime("%Y%m%d"))
        # 이름: 사용자 입력 → TSV 매핑 → pykrx 조회 → 티커 코드
        resolved_name = resolve_kr_name(ticker, requested_name)
        # 시장: 사용자 hint → TSV에 있으면 ETF → 아니면 KOSPI
        tsv = load_tsv_names()
        market = market_hint or ("ETF" if ticker in tsv else "KOSPI")
    else:
        # yfinance는 end exclusive
        df = fetch_ohlcv_us(ticker, start_dt.strftime("%Y-%m-%d"),
                            (end_dt + relativedelta(days=1)).strftime("%Y-%m-%d"))
        # 이름: 사용자 입력 > yfinance info > 티커
        resolved_name = requested_name or ticker
        if not requested_name:
            try:
                import yfinance as yf
                info = yf.Ticker(ticker).info
                resolved_name = info.get("longName") or info.get("shortName") or ticker
            except Exception:
                pass
        market = market_hint or detect_exchange(ticker)

    if df.empty:
        raise ValueError(f"데이터 0행 — 상장 이력 없음 또는 지연")

    # 2) 저장
    upsert_single_ticker(ticker, resolved_name, market)
    n = save_ohlcv(ticker, df)
    log_ingestion(
        ticker,
        start_dt.strftime("%Y-%m-%d"),
        end_dt.strftime("%Y-%m-%d"),
        n, "ok",
    )
    print(f"  [OK] {ticker} ({resolved_name}) — {n} rows, market={market}")


def trigger_revalidate() -> None:
    """Vercel 홈 페이지 ISR 즉시 무효화 (환경변수 설정 시)."""
    url = os.environ.get("REVALIDATE_URL")
    secret = os.environ.get("REVALIDATE_SECRET")
    if not url or not secret:
        print("[INFO] REVALIDATE_URL/SECRET 미설정 — 캐시 무효화 건너뜀")
        return
    full = urljoin(url + "/", "api/revalidate")
    try:
        req = Request(
            full,
            method="POST",
            headers={
                "Authorization": f"Bearer {secret}",
                "Content-Type": "application/json",
            },
            data=b'{"paths":["/"]}',
        )
        with urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            print(f"[OK] revalidate {resp.status}: {body[:200]}")
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] revalidate 실패 — {e}")


def main() -> None:
    init_db()
    pending = fetch_pending()
    if not pending:
        print("[INFO] pending_tickers 비어있음 — 처리할 것 없음")
        return

    print(f"[INFO] {len(pending)}개 pending 티커 처리 시작")
    ok, err = 0, 0
    for ticker, req_name, hint in pending:
        try:
            mark_processing(ticker)
            process_one(ticker, req_name, hint)
            delete_pending(ticker)
            ok += 1
        except Exception as e:  # noqa: BLE001
            err_msg = str(e)
            mark_error(ticker, err_msg)
            err += 1
            print(f"  [ERR] {ticker} — {err_msg}")
        time.sleep(0.3)  # rate limit 여유

    print(f"[SUMMARY] ok={ok}, error={err}")

    # 하나라도 성공하면 ISR 캐시 무효화
    if ok > 0:
        trigger_revalidate()

    if err > 0:
        sys.exit(1)  # Actions에서 오류 표시용


if __name__ == "__main__":
    main()
