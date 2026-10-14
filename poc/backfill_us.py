"""
미국 주식 10년치 일별 OHLCV 백필 (yfinance 기반).

사용 예:
    python backfill_us.py --years 10 --tickers AAPL MSFT NVDA
    python backfill_us.py --years 10 --preset sp500_top50

한국 주식(pykrx)과 동일한 `daily_prices` 테이블을 공유하며,
`tickers.market` 컬럼으로 'NASDAQ' / 'NYSE' 등으로 구분.
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta

import pandas as pd
import yfinance as yf
from tqdm import tqdm

from db import get_conn, init_db
from backfill import save_ohlcv, log_ingestion


# S&P500 시총 상위 50 — 하드코딩 프리셋 (동적 수집은 운영 시 다른 소스 사용)
PRESETS: dict[str, list[str]] = {
    "sp500_top50": [
        "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "BRK-B", "LLY", "AVGO",
        "TSLA", "JPM", "WMT", "V", "XOM", "UNH", "MA", "ORCL", "HD", "PG",
        "COST", "JNJ", "ABBV", "BAC", "KO", "MRK", "NFLX", "CVX", "CRM", "AMD",
        "PEP", "TMO", "ADBE", "LIN", "CSCO", "ACN", "WFC", "MCD", "DHR", "ABT",
        "IBM", "GE", "NOW", "TXN", "INTU", "AMGN", "QCOM", "DIS", "CAT", "PM",
    ],
    "faang": ["META", "AAPL", "AMZN", "NFLX", "GOOGL"],
    "ai": ["NVDA", "MSFT", "GOOGL", "META", "AMD", "AVGO", "ORCL", "PLTR", "SMCI", "TSM"],
}


def detect_exchange(ticker: str) -> str:
    """yfinance에서 상장 거래소 조회 → NASDAQ/NYSE/기타."""
    try:
        info = yf.Ticker(ticker).info
        ex = (info.get("exchange") or info.get("fullExchangeName") or "").upper()
        if "NASDAQ" in ex or ex == "NMS":
            return "NASDAQ"
        if "NEW YORK" in ex or ex in {"NYQ", "NYSE"}:
            return "NYSE"
        return ex or "US_OTHER"
    except Exception:  # noqa: BLE001
        return "US_OTHER"


def upsert_us_ticker_meta(tickers: list[str]) -> None:
    conn = get_conn()
    now = datetime.utcnow().isoformat(timespec="seconds")
    rows = []
    for t in tickers:
        try:
            info = yf.Ticker(t).info
            name = info.get("longName") or info.get("shortName") or t
        except Exception:  # noqa: BLE001
            name = t
        market = detect_exchange(t)
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


def fetch_ohlcv_us(ticker: str, start: str, end: str) -> pd.DataFrame:
    """
    yfinance에서 OHLCV 조회 → pykrx 스키마와 동일한 컬럼으로 변환.
    start/end: 'YYYY-MM-DD' (end 는 yfinance 규칙대로 exclusive)

    change_pct(전일 대비 %)를 구간 첫 행에서도 계산할 수 있도록 start 보다
    열흘 앞서 받아 pct_change 를 구한 뒤 start 이전 행은 버린다.
    (증분 수집은 보통 1~2행만 받으므로, 이 처리가 없으면 전일 대비가 항상 NULL 이 된다.)
    """
    fetch_start = (
        datetime.strptime(start, "%Y-%m-%d") - timedelta(days=10)
    ).strftime("%Y-%m-%d")
    df = yf.download(
        ticker,
        start=fetch_start,
        end=end,
        auto_adjust=False,   # 원본 종가 유지 (splits/div은 별도 관리)
        progress=False,
        threads=False,
    )
    if df.empty:
        return df

    # yfinance 컬럼: Open, High, Low, Close, Adj Close, Volume (MultiIndex 가능)
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    df = df.rename(columns={
        "Open": "open",
        "High": "high",
        "Low": "low",
        "Close": "close",
        "Volume": "volume",
    })
    # 등락률 계산 (앞당겨 받은 구간 포함) → start 이전 행 제거
    df["change_pct"] = df["close"].pct_change() * 100.0
    df.index = df.index.strftime("%Y-%m-%d")
    df.index.name = "date"
    df = df[df.index >= start]
    if df.empty:
        return df
    return df[["open", "high", "low", "close", "volume", "change_pct"]]


def backfill_us(tickers: list[str], years: int, sleep_sec: float = 0.2) -> None:
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)
    start = start_dt.strftime("%Y-%m-%d")
    end = end_dt.strftime("%Y-%m-%d")

    print(f"[INFO] 미국 주식 백필: {start} ~ {end} ({years}년)")
    print(f"[INFO] 대상 종목: {len(tickers)}개")

    upsert_us_ticker_meta(tickers)

    for t in tqdm(tickers, desc="US Backfill"):
        try:
            df = fetch_ohlcv_us(t, start, end)
            # 첫 행은 change_pct가 NaN → 저장 시 None으로 변환됨 (SQLite 허용)
            n = save_ohlcv(t, df)
            log_ingestion(t, start, end, n, "ok")
            tqdm.write(f"  {t}: {n} rows")
        except Exception as e:  # noqa: BLE001
            log_ingestion(t, start, end, 0, "error", str(e))
            tqdm.write(f"  {t}: ERROR — {e}")
        time.sleep(sleep_sec)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="미국 주식 10년 백필 (yfinance)")
    p.add_argument("--years", type=int, default=10)
    p.add_argument("--tickers", nargs="*", help="티커 리스트 (예: AAPL MSFT)")
    p.add_argument("--preset", choices=list(PRESETS.keys()),
                   help="프리셋 사용 (sp500_top50, faang, ai)")
    p.add_argument("--sleep", type=float, default=0.2)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    init_db()

    if args.tickers:
        tickers = args.tickers
    elif args.preset:
        tickers = PRESETS[args.preset]
    else:
        print("ERROR: --tickers 또는 --preset 중 하나를 지정하세요.", file=sys.stderr)
        sys.exit(1)

    backfill_us(tickers, args.years, sleep_sec=args.sleep)
    print("[OK] 미국 주식 백필 완료")


if __name__ == "__main__":
    main()
