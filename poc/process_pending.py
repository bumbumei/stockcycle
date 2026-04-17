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

import re
import sys
import time
from datetime import datetime
from dateutil.relativedelta import relativedelta

from db import get_conn, init_db, is_pg
from backfill import fetch_ohlcv as fetch_kr, save_ohlcv, log_ingestion
from backfill_us import fetch_ohlcv_us, detect_exchange


KR_RE = re.compile(r"^\d{6}$")
US_RE = re.compile(r"^[A-Z][-.A-Z0-9]{0,9}$")


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
        resolved_name = requested_name or ticker
        # 사용자가 market_hint를 주지 않으면 KOSPI를 기본값으로
        market = market_hint or "KOSPI"
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
    if err > 0:
        sys.exit(1)  # Actions에서 오류 표시용


if __name__ == "__main__":
    main()
