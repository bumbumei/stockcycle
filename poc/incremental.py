"""
일 단위 증분 수집 스크립트. 장 마감 후 cron/GitHub Actions로 실행.

각 종목의 market 컬럼을 기준으로 소스를 라우팅:
  - KOSPI / KOSDAQ          → pykrx (backfill.fetch_ohlcv)
  - NASDAQ / NYSE / US_OTHER → yfinance (backfill_us.fetch_ohlcv_us)
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime, timedelta

from tqdm import tqdm

from db import get_conn
from backfill import fetch_ohlcv as fetch_ohlcv_kr, save_ohlcv, log_ingestion
from backfill_us import fetch_ohlcv_us
from backfill_macro import incremental_macro, INDICATORS


KR_MARKETS = {"KOSPI", "KOSDAQ", "ETF"}
US_MARKETS = {"NASDAQ", "NYSE", "US_OTHER", "PCX"}


def get_last_date(ticker: str) -> str | None:
    conn = get_conn()
    try:
        row = conn.execute(
            "SELECT MAX(date) FROM daily_prices WHERE ticker = ?", (ticker,)
        ).fetchone()
        return row[0] if row and row[0] else None
    finally:
        conn.close()


def get_all_tickers_with_market() -> list[tuple[str, str]]:
    conn = get_conn()
    try:
        return conn.execute(
            "SELECT ticker, market FROM tickers"
        ).fetchall()
    finally:
        conn.close()


def fetch_for_market(ticker: str, market: str, start_iso: str, end_iso: str):
    """
    market에 따라 적절한 소스 호출. start/end는 'YYYY-MM-DD'.

    KR_MARKETS → pykrx
    그 외(미국 거래소, 알 수 없는 시장) → yfinance
    티커가 6자리 숫자인지도 함께 검사해서 이중 안전망.
    """
    import re
    is_kr_code = bool(re.match(r"^\d{6}$", ticker))

    if market in KR_MARKETS or is_kr_code:
        start = start_iso.replace("-", "")
        end = end_iso.replace("-", "")
        return fetch_ohlcv_kr(ticker, start, end)
    # 미국 / 기타 — yfinance 로 시도
    end_dt = datetime.strptime(end_iso, "%Y-%m-%d") + timedelta(days=1)
    return fetch_ohlcv_us(ticker, start_iso, end_dt.strftime("%Y-%m-%d"))


def incremental_update(sleep_sec: float = 0.3) -> None:
    tickers = get_all_tickers_with_market()
    today_iso = datetime.today().strftime("%Y-%m-%d")
    print(f"[INFO] 증분 업데이트: {len(tickers)}개 종목 → {today_iso} 까지")

    for t, market in tqdm(tickers, desc="Incremental"):
        last = get_last_date(t)
        if last:
            start_dt = datetime.strptime(last, "%Y-%m-%d") + timedelta(days=1)
            start_iso = start_dt.strftime("%Y-%m-%d")
        else:
            start_iso = today_iso  # 기록 없으면 오늘만

        if start_iso > today_iso:
            tqdm.write(f"  {t} [{market}]: 최신 상태 (skip)")
            continue

        try:
            df = fetch_for_market(t, market, start_iso, today_iso)
            n = save_ohlcv(t, df)
            log_ingestion(t, start_iso, today_iso, n, "ok")
            tqdm.write(f"  {t} [{market}]: +{n} rows ({start_iso} ~ {today_iso})")
        except Exception as e:  # noqa: BLE001
            log_ingestion(t, start_iso, today_iso, 0, "error", str(e))
            tqdm.write(f"  {t} [{market}]: ERROR — {e}")
        time.sleep(sleep_sec)

    print("[OK] 증분 업데이트 완료")


def main() -> None:
    p = argparse.ArgumentParser(description="일별 증분 수집 (한/미 + 매크로)")
    p.add_argument("--sleep", type=float, default=0.3)
    p.add_argument("--skip-macro", action="store_true",
                   help="매크로 지표 업데이트 생략")
    p.add_argument("--only-macro", action="store_true",
                   help="매크로 지표만 업데이트 (종목 skip)")
    args = p.parse_args()

    if not args.only_macro:
        incremental_update(sleep_sec=args.sleep)

    if not args.skip_macro:
        print("\n[INFO] 매크로 지표 증분 업데이트")
        incremental_macro(list(INDICATORS.keys()), sleep_sec=args.sleep)

    # Vercel ISR 무효화 (REVALIDATE_URL/SECRET 설정 시)
    try:
        from process_pending import trigger_revalidate
        trigger_revalidate()
    except Exception as e:  # noqa: BLE001
        print(f"[WARN] revalidate trigger 임포트 실패 — {e}")


if __name__ == "__main__":
    main()
