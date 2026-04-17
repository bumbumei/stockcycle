"""
월별 피처 엔지니어링.

입력: daily_prices 테이블의 일별 OHLCV + macro_indicators 테이블
출력: 월별 피처 + 타겟(다음달 상승=1/하락=0)

피처 설계:
  [종목 피처]
    - 과거 수익률: 1개월, 3개월, 6개월, 12개월
    - 변동성: 1개월, 3개월 rolling std (일별 log return)
    - 거래량: 최근 월 평균 거래량 / 과거 12개월 평균 대비 비율
    - 계절성: month (1~12)
    - 기술지표: 1개월 종가 vs 12개월 이동평균 (모멘텀)

  [매크로 피처] — include_macro=True (기본값)
    - USDKRW, VIX, US10Y, DXY, WTI 의 1개월 lag 값
    - USDKRW, VIX 의 1개월 변화율 (%)
    - VIX 의 3개월 이동평균 (리스크 레짐)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from db import get_conn


def load_daily(ticker: str) -> pd.DataFrame:
    conn = get_conn()
    try:
        df = pd.read_sql(
            "SELECT date, close, volume FROM daily_prices "
            "WHERE ticker = ? ORDER BY date",
            conn,
            params=(ticker,),
        )
    finally:
        conn.close()
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")
    return df


def load_macro_monthly() -> pd.DataFrame:
    """
    매크로 지표를 월별(월초 기준)로 집계하여 wide 포맷으로 반환.
    각 지표는 월말 종가(last) 사용.
    """
    conn = get_conn()
    try:
        df = pd.read_sql(
            "SELECT indicator, date, value FROM macro_indicators ORDER BY date",
            conn,
        )
    finally:
        conn.close()
    if df.empty:
        return pd.DataFrame()
    df["date"] = pd.to_datetime(df["date"])
    # 지표별 월말값 → wide
    pivot = (
        df.set_index("date")
          .groupby("indicator")["value"]
          .resample("MS")
          .last()
          .unstack(level=0)
    )
    pivot.columns = [f"macro_{c}" for c in pivot.columns]
    return pivot


def _monthly_agg(daily: pd.DataFrame) -> pd.DataFrame:
    """일별 → 월별 집계."""
    monthly = pd.DataFrame({
        "first_close": daily["close"].resample("MS").first(),
        "last_close":  daily["close"].resample("MS").last(),
        "avg_volume":  daily["volume"].resample("MS").mean(),
    }).dropna()
    monthly["return_pct"] = (
        (monthly["last_close"] - monthly["first_close"])
        / monthly["first_close"] * 100.0
    )
    # 일별 log return → 월별 변동성
    daily_logret = np.log(daily["close"]).diff()
    monthly["daily_vol"] = daily_logret.resample("MS").std() * np.sqrt(21)
    return monthly


def build_features(ticker: str, include_macro: bool = True) -> pd.DataFrame:
    daily = load_daily(ticker)
    if daily.empty:
        raise ValueError(f"No data for ticker {ticker}")

    m = _monthly_agg(daily)

    # 과거 수익률 (월 기준 lag)
    for k in (1, 3, 6, 12):
        m[f"ret_lag_{k}m"] = m["return_pct"].shift(1).rolling(k).sum()

    # 변동성 lag
    m["vol_lag_1m"] = m["daily_vol"].shift(1)
    m["vol_lag_3m"] = m["daily_vol"].shift(1).rolling(3).mean()

    # 거래량 비율: 최근월 / 과거 12개월 평균
    m["volume_ratio"] = (
        m["avg_volume"].shift(1)
        / m["avg_volume"].shift(1).rolling(12).mean()
    )

    # 모멘텀: 월말 종가 / 12개월 이동평균
    m["momentum_12m"] = (
        m["last_close"].shift(1)
        / m["last_close"].shift(1).rolling(12).mean()
    )

    # 계절성
    m["month"] = m.index.month

    # 타겟: 당월 상승 여부 (현재 return_pct > 0)
    m["target_up"] = (m["return_pct"] > 0).astype(int)

    feature_cols = [
        "ret_lag_1m", "ret_lag_3m", "ret_lag_6m", "ret_lag_12m",
        "vol_lag_1m", "vol_lag_3m",
        "volume_ratio", "momentum_12m",
        "month",
    ]

    # 매크로 피처 병합
    if include_macro:
        macro = load_macro_monthly()
        if not macro.empty:
            # 모든 매크로 값은 lag(1) — 예측 시점에 이미 알려진 직전월 값 사용
            macro_lag = macro.shift(1)
            # 1개월 변화율
            for col in ("macro_USDKRW", "macro_VIX"):
                if col in macro.columns:
                    macro_lag[f"{col}_chg_1m"] = (
                        macro[col].shift(1).pct_change() * 100.0
                    )
            # VIX 3개월 이동평균 (리스크 레짐 프록시)
            if "macro_VIX" in macro.columns:
                macro_lag["macro_VIX_ma3"] = (
                    macro["macro_VIX"].shift(1).rolling(3).mean()
                )
            m = m.join(macro_lag, how="left")
            feature_cols.extend([c for c in macro_lag.columns])
        else:
            print("[WARN] macro_indicators 비어있음 — 매크로 피처 생략. "
                  "python backfill_macro.py --years 10 먼저 실행 권장.")

    # NaN 제거 (초기 12개월은 lag 피처가 비어있음)
    result = m[feature_cols + ["target_up", "return_pct"]].dropna()
    return result


if __name__ == "__main__":
    import sys
    ticker = sys.argv[1] if len(sys.argv) > 1 else "005930"
    df = build_features(ticker)
    print(f"[{ticker}] Features: {df.shape[0]} rows × {df.shape[1]} cols")
    print(df.head())
    print("\n타겟 분포:")
    print(df["target_up"].value_counts(normalize=True).round(3))
