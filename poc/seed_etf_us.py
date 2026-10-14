"""
미국 ETF 유니버스 시드 — tickers_etf_us.tsv 를 DB에 반영한다.

동작:
  1. TSV(티커/분류/한글 라벨/운용사/이름/수수료/배당기준/설명) 로드
  2. tickers 테이블 UPSERT (market='US_ETF')  — 이름은 TSV 가 기준
  3. etf_meta 테이블 UPSERT (분류/라벨/운용사/수수료/배당기준/설명/정렬순서)
  4. daily_prices 에 데이터가 없는(또는 부족한) 티커만 yfinance 로 백필
     → 재실행해도 이미 수집된 티커는 건너뛰므로 멱등. 전체 재수집은 --force.
  5. REVALIDATE_URL/SECRET 이 있으면 Vercel ISR 캐시 무효화

이후 일별 갱신은 incremental.py 가 market 기준으로 자동 처리한다
(KOSPI/KOSDAQ/ETF 외 시장은 모두 yfinance 경로).

사용법:
    python seed_etf_us.py                  # 메타 동기화 + 누락 티커 백필 (10년)
    python seed_etf_us.py --years 3        # 백필 기간 단축
    python seed_etf_us.py --meta-only      # 가격 수집 없이 메타만 동기화
    python seed_etf_us.py --force          # 모든 티커 재백필
    export DATABASE_URL="postgresql://..." # Neon 에 직접 반영
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime
from pathlib import Path

from dateutil.relativedelta import relativedelta
from tqdm import tqdm

from db import get_conn, init_db, is_pg
from backfill import save_ohlcv, log_ingestion
from backfill_us import fetch_ohlcv_us
from process_pending import trigger_revalidate

TSV_FILE = Path(__file__).parent / "tickers_etf_us.tsv"
MARKET = "US_ETF"
MIN_ROWS_OK = 200  # 이보다 적으면 수집이 불완전한 것으로 보고 다시 백필


def _parse_ratio(s: str) -> float | None:
    """'0.0009' 또는 '0.09%' → 0.0009. 빈 값/파싱 실패는 None."""
    s = (s or "").strip()
    if not s:
        return None
    try:
        if s.endswith("%"):
            return float(s[:-1]) / 100.0
        return float(s)
    except ValueError:
        return None


def load_universe() -> list[dict[str, object]]:
    """
    TSV → [{ticker, category, label, issuer, name, expense_ratio, dividend_freq, description}]
    파일 순서 유지. 컬럼은 탭 구분, 앞 5개 외는 선택.
    """
    rows: list[dict[str, object]] = []
    for line in TSV_FILE.read_text(encoding="utf-8").splitlines():
        line = line.rstrip("\n")
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        parts = [p.strip() for p in line.split("\t")]
        if not parts or not parts[0]:
            continue
        ticker = parts[0].upper()

        def col(i: int) -> str:
            return parts[i] if len(parts) > i else ""

        rows.append({
            "ticker": ticker,
            "category": col(1),
            "label": col(2),
            "issuer": col(3),
            "name": col(4) or ticker,
            "expense_ratio": _parse_ratio(col(5)),
            "dividend_freq": col(6),
            "description": col(7),
        })
    # 중복 티커는 뒤에 나온 행이 이김
    dedup: dict[str, dict[str, object]] = {}
    for r in rows:
        dedup[str(r["ticker"])] = r
    return list(dedup.values())


def upsert_meta(universe: list[dict[str, object]]) -> None:
    conn = get_conn()
    now = datetime.utcnow().isoformat(timespec="seconds")
    try:
        with conn:
            conn.executemany(
                """INSERT INTO tickers(ticker, name, market, updated_at)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(ticker) DO UPDATE SET
                       name=excluded.name,
                       market=excluded.market,
                       updated_at=excluded.updated_at""",
                [(r["ticker"], r["name"], MARKET, now) for r in universe],
            )
            conn.executemany(
                """INSERT INTO etf_meta(ticker, category, label, issuer,
                                        expense_ratio, dividend_freq, description,
                                        sort_order, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(ticker) DO UPDATE SET
                       category=excluded.category,
                       label=excluded.label,
                       issuer=excluded.issuer,
                       expense_ratio=excluded.expense_ratio,
                       dividend_freq=excluded.dividend_freq,
                       description=excluded.description,
                       sort_order=excluded.sort_order,
                       updated_at=excluded.updated_at""",
                [
                    (r["ticker"], r["category"] or None, r["label"] or None,
                     r["issuer"] or None, r["expense_ratio"],
                     r["dividend_freq"] or None, r["description"] or None,
                     i, now)
                    for i, r in enumerate(universe)
                ],
            )
    finally:
        conn.close()
    print(f"[META] tickers/etf_meta UPSERT: {len(universe)}개 (market={MARKET})")


def row_counts(tickers: list[str]) -> dict[str, int]:
    if not tickers:
        return {}
    conn = get_conn()
    try:
        placeholder = "%s" if is_pg() else "?"
        qmarks = ",".join([placeholder] * len(tickers))
        rows = conn.execute(
            f"""SELECT ticker, COUNT(*) FROM daily_prices
                WHERE ticker IN ({qmarks}) GROUP BY ticker""",
            tickers,
        ).fetchall()
        return {r[0]: int(r[1]) for r in rows}
    finally:
        conn.close()


def backfill(tickers: list[str], years: int, sleep_sec: float) -> tuple[int, int, int]:
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)
    start = start_dt.strftime("%Y-%m-%d")
    end_excl = (end_dt + relativedelta(days=1)).strftime("%Y-%m-%d")  # yfinance end exclusive

    print(f"[INFO] 백필: {start} ~ {end_dt:%Y-%m-%d} ({years}년), {len(tickers)}개")
    ok = empty = err = 0
    for t in tqdm(tickers, desc="US ETF backfill"):
        try:
            df = fetch_ohlcv_us(t, start, end_excl)
            n = save_ohlcv(t, df)
            log_ingestion(t, start, end_dt.strftime("%Y-%m-%d"), n, "ok")
            if n == 0:
                empty += 1
                tqdm.write(f"  {t}: EMPTY")
            else:
                ok += 1
        except Exception as e:  # noqa: BLE001
            log_ingestion(t, start, end_dt.strftime("%Y-%m-%d"), 0, "error", str(e))
            err += 1
            tqdm.write(f"  {t}: ERROR — {e}")
        time.sleep(sleep_sec)
    print(f"[SUMMARY] ok={ok}, empty={empty}, error={err}")
    return ok, empty, err


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="미국 ETF 유니버스 시드 (tickers_etf_us.tsv)")
    p.add_argument("--years", type=int, default=10)
    p.add_argument("--sleep", type=float, default=0.2)
    p.add_argument("--meta-only", action="store_true", help="가격 수집 없이 메타만 동기화")
    p.add_argument("--force", action="store_true", help="이미 데이터가 있는 티커도 재백필")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    init_db()

    universe = load_universe()
    if not universe:
        raise SystemExit(f"ERROR: {TSV_FILE} 에 티커가 없습니다.")
    print(f"[INFO] 유니버스 로드: {len(universe)}개 ({TSV_FILE.name})")

    upsert_meta(universe)

    changed = False
    if not args.meta_only:
        all_tickers = [str(r["ticker"]) for r in universe]
        if args.force:
            targets = all_tickers
        else:
            counts = row_counts(all_tickers)
            targets = [t for t in all_tickers if counts.get(t, 0) < MIN_ROWS_OK]
        if targets:
            print(f"[INFO] 백필 대상 {len(targets)}개 "
                  f"({'전체' if args.force else f'daily_prices < {MIN_ROWS_OK}행'})")
            ok, _, _ = backfill(targets, args.years, args.sleep)
            changed = ok > 0
        else:
            print("[INFO] 백필 대상 없음 — 모든 티커가 이미 데이터 보유")

    if changed or args.meta_only:
        trigger_revalidate()
    print("[OK] 미국 ETF 시드 완료")


if __name__ == "__main__":
    main()
