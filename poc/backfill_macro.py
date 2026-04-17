"""
매크로 지표 수집 (yfinance 기반).

대상 지표:
  - USDKRW : 원/달러 환율 (KRW=X)
  - VIX    : 변동성 지수 (^VIX)
  - US10Y  : 미국 10년 국채 수익률 (^TNX, % × 10)
  - DXY    : 달러 인덱스 (DX-Y.NYB)
  - WTI    : WTI 원유 선물 (CL=F)

사용 예:
    python backfill_macro.py --years 10            # 전체 백필
    python backfill_macro.py --incremental         # 증분 업데이트
    python backfill_macro.py --indicators VIX USDKRW
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime, timedelta

import pandas as pd
import yfinance as yf
from dateutil.relativedelta import relativedelta
from tqdm import tqdm

from db import get_conn, init_db


# 지표 심볼 매핑 (내부 코드 → yfinance 심볼)
INDICATORS: dict[str, str] = {
    "USDKRW": "KRW=X",
    "VIX":    "^VIX",
    "US10Y":  "^TNX",
    "DXY":    "DX-Y.NYB",
    "WTI":    "CL=F",
}


def fetch_indicator(code: str, start: str, end: str) -> pd.DataFrame:
    """yfinance로 지표 종가 조회. 결과: date, value."""
    symbol = INDICATORS[code]
    df = yf.download(
        symbol,
        start=start,
        end=end,
        auto_adjust=False,
        progress=False,
        threads=False,
    )
    if df.empty:
        return df

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)

    out = pd.DataFrame({"value": df["Close"]})
    out.index = out.index.strftime("%Y-%m-%d")
    out.index.name = "date"
    return out


def save_indicator(code: str, df: pd.DataFrame) -> int:
    if df.empty:
        return 0
    rows = [(code, d, float(v)) for d, v in df["value"].items() if pd.notna(v)]
    conn = get_conn()
    with conn:
        conn.executemany(
            """INSERT INTO macro_indicators(indicator, date, value)
               VALUES (?, ?, ?)
               ON CONFLICT(indicator, date) DO UPDATE SET value=excluded.value""",
            rows,
        )
    conn.close()
    return len(rows)


def get_last_macro_date(code: str) -> str | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT MAX(date) FROM macro_indicators WHERE indicator = ?", (code,)
        ).fetchone()
        return row[0] if row and row[0] else None
    finally:
        conn.close()


def backfill_macro(codes: list[str], years: int, sleep_sec: float = 0.2) -> None:
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)
    start = start_dt.strftime("%Y-%m-%d")
    end   = (end_dt + timedelta(days=1)).strftime("%Y-%m-%d")

    print(f"[INFO] 매크로 백필: {start} ~ {end} ({years}년)")
    print(f"[INFO] 대상 지표: {codes}")

    for code in tqdm(codes, desc="Macro Backfill"):
        try:
            df = fetch_indicator(code, start, end)
            n = save_indicator(code, df)
            tqdm.write(f"  {code}: {n} rows")
        except Exception as e:  # noqa: BLE001
            tqdm.write(f"  {code}: ERROR — {e}")
        time.sleep(sleep_sec)


def incremental_macro(codes: list[str], sleep_sec: float = 0.2) -> None:
    today_iso = datetime.today().strftime("%Y-%m-%d")
    end_iso   = (datetime.today() + timedelta(days=1)).strftime("%Y-%m-%d")

    for code in tqdm(codes, desc="Macro Incremental"):
        last = get_last_macro_date(code)
        if last:
            start_dt = datetime.strptime(last, "%Y-%m-%d") + timedelta(days=1)
            start_iso = start_dt.strftime("%Y-%m-%d")
        else:
            start_iso = today_iso

        if start_iso > today_iso:
            tqdm.write(f"  {code}: 최신 상태 (skip)")
            continue

        try:
            df = fetch_indicator(code, start_iso, end_iso)
            n = save_indicator(code, df)
            tqdm.write(f"  {code}: +{n} rows ({start_iso} ~ {today_iso})")
        except Exception as e:  # noqa: BLE001
            tqdm.write(f"  {code}: ERROR — {e}")
        time.sleep(sleep_sec)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="매크로 지표 수집")
    p.add_argument("--years", type=int, default=10, help="백필 기간 (years)")
    p.add_argument("--indicators", nargs="*", choices=list(INDICATORS.keys()),
                   help="대상 지표 (미지정 시 전체)")
    p.add_argument("--incremental", action="store_true",
                   help="백필 대신 증분 업데이트만")
    p.add_argument("--sleep", type=float, default=0.2)
    return p.parse_args()


def main() -> None:
    args = parse_args()
    init_db()

    codes = args.indicators or list(INDICATORS.keys())

    if args.incremental:
        incremental_macro(codes, sleep_sec=args.sleep)
        print("[OK] 매크로 증분 업데이트 완료")
    else:
        backfill_macro(codes, args.years, sleep_sec=args.sleep)
        print("[OK] 매크로 백필 완료")


if __name__ == "__main__":
    main()
