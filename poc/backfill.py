"""
10년치 일별 종가 백필 스크립트.

사용 예:
    python backfill.py --years 10 --tickers 005930 000660 035420
    python backfill.py --years 10 --market KOSPI --top 50
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime
from dateutil.relativedelta import relativedelta
from typing import Iterable

import pandas as pd
from pykrx import stock
from tqdm import tqdm

from db import get_conn, init_db


# ---- Ticker 수집 ------------------------------------------------------------

def fetch_top_tickers(market: str, top: int, ref_date: str) -> list[str]:
    """시총 상위 N개 종목 티커 반환."""
    cap = stock.get_market_cap(ref_date, market=market)
    cap = cap.sort_values("시가총액", ascending=False).head(top)
    return cap.index.tolist()


def upsert_ticker_meta(tickers: Iterable[str]) -> None:
    conn = get_conn()
    now = datetime.utcnow().isoformat(timespec="seconds")
    rows = []
    for t in tickers:
        try:
            name = stock.get_market_ticker_name(t)
        except Exception:  # noqa: BLE001
            name = t
        # KRX 로그인 불필요한 경로: 기본값 'KOSPI' 사용 (PoC). 운영 시 별도 메타 테이블.
        market = "KOSPI"
        rows.append((t, name, market, now))
    with conn:
        conn.executemany(
            """INSERT INTO tickers(ticker, name, market, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(ticker) DO UPDATE SET
                   name=excluded.name,
                   market=excluded.market,
                   updated_at=excluded.updated_at""",
            rows,
        )
    conn.close()


# ---- 가격 데이터 수집 --------------------------------------------------------

def fetch_ohlcv(ticker: str, start: str, end: str) -> pd.DataFrame:
    """pykrx에서 OHLCV 조회 → 표준 컬럼으로 변환."""
    df = stock.get_market_ohlcv(start, end, ticker)
    if df.empty:
        return df
    df = df.rename(
        columns={
            "시가": "open",
            "고가": "high",
            "저가": "low",
            "종가": "close",
            "거래량": "volume",
            "등락률": "change_pct",
        }
    )
    df.index = df.index.strftime("%Y-%m-%d")
    df.index.name = "date"
    return df[["open", "high", "low", "close", "volume", "change_pct"]]


def save_ohlcv(ticker: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    rows = [
        (ticker, d, r.open, r.high, r.low, r.close, int(r.volume), r.change_pct)
        for d, r in df.iterrows()
    ]
    conn = get_conn()
    with conn:
        conn.executemany(
            """INSERT INTO daily_prices
               (ticker, date, open, high, low, close, volume, change_pct)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(ticker, date) DO UPDATE SET
                   open=excluded.open, high=excluded.high, low=excluded.low,
                   close=excluded.close, volume=excluded.volume,
                   change_pct=excluded.change_pct""",
            rows,
        )
    conn.close()
    return len(rows)


def log_ingestion(ticker: str, start: str, end: str, rows: int,
                  status: str, err: str | None = None) -> None:
    conn = get_conn()
    with conn:
        conn.execute(
            """INSERT INTO ingestion_log
               (ticker, from_date, to_date, rows, status, error_msg, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (ticker, start, end, rows, status, err,
             datetime.utcnow().isoformat(timespec="seconds")),
        )
    conn.close()


# ---- 메인 백필 루프 ----------------------------------------------------------

def backfill(tickers: list[str], years: int, sleep_sec: float = 0.3) -> None:
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)
    start = start_dt.strftime("%Y%m%d")
    end = end_dt.strftime("%Y%m%d")

    print(f"[INFO] 백필 기간: {start} ~ {end} ({years}년)")
    print(f"[INFO] 대상 종목: {len(tickers)}개")

    upsert_ticker_meta(tickers)

    for t in tqdm(tickers, desc="Backfill"):
        try:
            df = fetch_ohlcv(t, start, end)
            n = save_ohlcv(t, df)
            log_ingestion(t, start, end, n, "ok")
            tqdm.write(f"  {t}: {n} rows")
        except Exception as e:  # noqa: BLE001
            log_ingestion(t, start, end, 0, "error", str(e))
            tqdm.write(f"  {t}: ERROR — {e}")
        time.sleep(sleep_sec)  # rate limit 방지


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="10년 주식 데이터 백필")
    p.add_argument("--years", type=int, default=10)
    p.add_argument("--tickers", nargs="*", help="명시 티커 리스트 (예: 005930)")
    p.add_argument("--market", choices=["KOSPI", "KOSDAQ"], help="시총 상위 N개 수집")
    p.add_argument("--top", type=int, default=50)
    p.add_argument("--sleep", type=float, default=0.3)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    init_db()

    if args.tickers:
        tickers = args.tickers
    elif args.market:
        ref = datetime.today().strftime("%Y%m%d")
        tickers = fetch_top_tickers(args.market, args.top, ref)
    else:
        print("ERROR: --tickers 또는 --market 중 하나를 지정하세요.", file=sys.stderr)
        sys.exit(1)

    backfill(tickers, args.years, sleep_sec=args.sleep)
    print("[OK] 백필 완료")


if __name__ == "__main__":
    main()
