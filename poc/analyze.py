"""
월별 상승/하락 집계 쿼리 샘플.

10년치 일별 종가 → 월별 수익률 → 월별 상승 확률(히트맵용 데이터).
"""
from __future__ import annotations

import argparse

import pandas as pd

from db import get_conn


QUERY_MONTHLY_RETURNS = """
WITH monthly AS (
    SELECT
        ticker,
        strftime('%Y-%m', date) AS ym,
        strftime('%m', date)    AS month,
        FIRST_VALUE(close) OVER (
            PARTITION BY ticker, strftime('%Y-%m', date)
            ORDER BY date ASC
        ) AS first_close,
        LAST_VALUE(close) OVER (
            PARTITION BY ticker, strftime('%Y-%m', date)
            ORDER BY date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS last_close
    FROM daily_prices
    WHERE ticker = ?
),
distinct_monthly AS (
    SELECT DISTINCT ticker, ym, month, first_close, last_close,
        (last_close - first_close) / first_close * 100.0 AS return_pct
    FROM monthly
)
SELECT ym, month, first_close, last_close, return_pct
FROM distinct_monthly
ORDER BY ym;
"""


QUERY_MONTH_STATS = """
WITH monthly AS (
    SELECT
        ticker,
        strftime('%Y-%m', date) AS ym,
        CAST(strftime('%m', date) AS INTEGER) AS month,
        FIRST_VALUE(close) OVER (
            PARTITION BY ticker, strftime('%Y-%m', date)
            ORDER BY date ASC
        ) AS first_close,
        LAST_VALUE(close) OVER (
            PARTITION BY ticker, strftime('%Y-%m', date)
            ORDER BY date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS last_close
    FROM daily_prices
    WHERE ticker = ?
),
distinct_monthly AS (
    SELECT DISTINCT ym, month,
        (last_close - first_close) / first_close * 100.0 AS return_pct
    FROM monthly
)
SELECT
    month,
    COUNT(*)                                        AS years_count,
    AVG(return_pct)                                 AS avg_return,
    AVG(CASE WHEN return_pct > 0 THEN 1.0 ELSE 0.0 END) * 100 AS up_probability,
    MIN(return_pct)                                 AS min_return,
    MAX(return_pct)                                 AS max_return
FROM distinct_monthly
GROUP BY month
ORDER BY month;
"""


def monthly_returns(ticker: str) -> pd.DataFrame:
    conn = get_conn()
    try:
        return pd.read_sql(QUERY_MONTHLY_RETURNS, conn, params=(ticker,))
    finally:
        conn.close()


def month_stats(ticker: str) -> pd.DataFrame:
    """월(1~12)별 평균수익률과 상승확률."""
    conn = get_conn()
    try:
        return pd.read_sql(QUERY_MONTH_STATS, conn, params=(ticker,))
    finally:
        conn.close()


def print_heatmap(ticker: str) -> None:
    stats = month_stats(ticker)
    if stats.empty:
        print(f"[WARN] {ticker}: 데이터 없음")
        return

    print(f"\n=== {ticker} 월별 통계 (10년) ===")
    print(stats.to_string(
        index=False,
        float_format=lambda x: f"{x:>7.2f}",
    ))

    print("\n--- 상승 확률 히트맵 ---")
    for _, r in stats.iterrows():
        bar = "█" * int(r.up_probability / 5)  # 5%당 한 칸
        print(f"  {int(r.month):2d}월  {r.up_probability:5.1f}%  {bar}")


def main() -> None:
    p = argparse.ArgumentParser(description="월별 집계 분석")
    p.add_argument("ticker", help="종목 코드 (예: 005930)")
    p.add_argument("--detail", action="store_true", help="월별 수익률 상세 출력")
    args = p.parse_args()

    if args.detail:
        df = monthly_returns(args.ticker)
        print(df.to_string(index=False))
    else:
        print_heatmap(args.ticker)


if __name__ == "__main__":
    main()
