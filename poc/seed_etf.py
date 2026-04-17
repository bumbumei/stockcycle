"""
ETF 시드 스크립트 — tickers_etf_kr.txt 목록을 10년 백필 후
3년 미만 데이터 종목은 정리하고 market='ETF' 로 태그.

사용법:
    # 로컬 SQLite
    python seed_etf.py

    # Neon Postgres
    export DATABASE_URL="postgresql://..."
    python seed_etf.py

    # 시간 단축 (ticker당 대기 시간 감소)
    python seed_etf.py --sleep 0.15
"""
from __future__ import annotations

import argparse
import time
from datetime import datetime
from pathlib import Path

from tqdm import tqdm

from db import get_conn, init_db, is_pg
from backfill import fetch_ohlcv, save_ohlcv, log_ingestion
from dateutil.relativedelta import relativedelta

TSV_FILE = Path(__file__).parent / "tickers_etf_kr.tsv"
TXT_FILE = Path(__file__).parent / "tickers_etf_kr.txt"  # 이름 없는 백업
MIN_ROWS_3Y = 750   # 약 3년 × 250영업일


def load_ticker_map() -> dict[str, str]:
    """
    TSV 우선 (코드→이름). TSV 없으면 TXT에서 코드만 읽고 이름=코드.
    """
    names: dict[str, str] = {}
    src = TSV_FILE if TSV_FILE.exists() else TXT_FILE
    for line in src.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split("\t") if "\t" in line else line.split()
        code = parts[0].strip()
        name = parts[1].strip() if len(parts) >= 2 else code
        if code:
            names[code] = name
    return names


def upsert_with_names(name_map: dict[str, str]) -> None:
    """TSV 기반 이름으로 tickers 테이블 UPSERT (pykrx 이름 조회 없이)."""
    from datetime import datetime as _dt
    conn = get_conn()
    now = _dt.utcnow().isoformat(timespec="seconds")
    rows = [(code, name, "KOSPI", now) for code, name in name_map.items()]
    conn.executemany(
        """INSERT INTO tickers(ticker, name, market, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(ticker) DO UPDATE SET
               name=excluded.name,
               updated_at=excluded.updated_at""",
        rows,
    )
    conn.commit()
    conn.close()


def backfill_etf(name_map: dict[str, str], years: int, sleep_sec: float) -> None:
    tickers = list(name_map.keys())
    end_dt = datetime.today()
    start_dt = end_dt - relativedelta(years=years)
    start = start_dt.strftime("%Y%m%d")
    end = end_dt.strftime("%Y%m%d")

    print(f"[INFO] ETF 백필: {start} ~ {end}, {len(tickers)}개 종목")

    # 메타 먼저 (TSV 이름 사용 — pykrx 조회 실패 방지)
    print("[INFO] 티커 메타 생성 (TSV 기반)...")
    upsert_with_names(name_map)

    ok, empty, err = 0, 0, 0
    for t in tqdm(tickers, desc="Backfill ETF"):
        try:
            df = fetch_ohlcv(t, start, end)
            n = save_ohlcv(t, df)
            log_ingestion(t, start, end, n, "ok")
            if n == 0:
                empty += 1
            else:
                ok += 1
            if n < MIN_ROWS_3Y:
                tqdm.write(f"  {t}: {n} rows ({'<3y' if n > 0 else 'EMPTY'})")
        except Exception as e:  # noqa: BLE001
            log_ingestion(t, start, end, 0, "error", str(e))
            err += 1
            tqdm.write(f"  {t}: ERROR — {e}")
        time.sleep(sleep_sec)

    print(f"[SUMMARY] ok={ok}, empty={empty}, error={err}")


def filter_under_3y(tickers: list[str]) -> tuple[int, list[str]]:
    """3년 미만 데이터인 ETF 제거. 남은 티커 리스트 반환."""
    conn = get_conn()
    try:
        # 이 작업의 대상 티커만 체크 (기존 005930 등은 보존)
        placeholder = "%s" if is_pg() else "?"
        qmarks = ",".join([placeholder] * len(tickers))

        rows = conn.execute(
            f"""SELECT ticker, COUNT(*) AS n
                FROM daily_prices
                WHERE ticker IN ({qmarks})
                GROUP BY ticker""",
            tickers,
        ).fetchall()
        count_map = {r[0]: r[1] for r in rows}

        # 0행(아예 수집 실패) 또는 <750행인 티커 식별
        to_drop = [
            t for t in tickers
            if count_map.get(t, 0) < MIN_ROWS_3Y
        ]
        kept = [t for t in tickers if t not in to_drop]

        if to_drop:
            print(f"[CLEAN] 3년 미만 ETF {len(to_drop)}개 제거")
            qmarks_drop = ",".join([placeholder] * len(to_drop))
            with conn:
                conn.execute(
                    f"DELETE FROM daily_prices WHERE ticker IN ({qmarks_drop})",
                    to_drop,
                )
                conn.execute(
                    f"DELETE FROM tickers WHERE ticker IN ({qmarks_drop})",
                    to_drop,
                )
        else:
            print("[CLEAN] 3년 미만 ETF 없음")

        # 유지된 ETF 티커 market='ETF' 로 태그
        if kept:
            qmarks_kept = ",".join([placeholder] * len(kept))
            with conn:
                conn.execute(
                    f"UPDATE tickers SET market='ETF' WHERE ticker IN ({qmarks_kept})",
                    kept,
                )
            print(f"[TAG] {len(kept)}개 ETF market='ETF'로 설정")

        return len(to_drop), kept
    finally:
        conn.close()


def print_summary() -> None:
    conn = get_conn()
    try:
        print("\n[STATE]")
        for t, label in [
            ("tickers", "tickers"),
            ("daily_prices", "daily_prices"),
        ]:
            n = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {label:<20} {n:>10,}")
        rows = conn.execute(
            "SELECT market, COUNT(*) FROM tickers GROUP BY market ORDER BY market"
        ).fetchall()
        print("  by market:")
        for m, n in rows:
            print(f"    {m:<10} {n:>6}")
    finally:
        conn.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="ETF 225종목 시드 + 3년 미만 정리")
    p.add_argument("--years", type=int, default=10)
    p.add_argument("--sleep", type=float, default=0.2)
    p.add_argument("--skip-backfill", action="store_true",
                   help="백필 건너뛰고 정리/태깅만")
    p.add_argument("--review-only", action="store_true",
                   help="현재 DB에 없거나 3년 미만인 ETF만 재백필 "
                        "(매월 cron으로 3년 경과한 ETF 자동 포함용)")
    return p.parse_args()


def select_review_candidates(all_tickers: list[str]) -> list[str]:
    """
    재백필 후보 선별:
      - daily_prices 에 아예 없는 티커 (과거 3년 미만으로 제거됐거나 신규)
      - daily_prices 에 있지만 row 수가 MIN_ROWS_3Y 미만 (경계선 종목)

    3년 이상 데이터가 있는 ETF는 이미 매일 incremental.py 로 갱신되므로
    이 스크립트에서 다시 건드리지 않는다 (cron 비용 절감).
    """
    conn = get_conn()
    try:
        placeholder = "%s" if is_pg() else "?"
        qmarks = ",".join([placeholder] * len(all_tickers))
        rows = conn.execute(
            f"""SELECT ticker, COUNT(*) AS n
                FROM daily_prices
                WHERE ticker IN ({qmarks})
                GROUP BY ticker""",
            all_tickers,
        ).fetchall()
        count_map = {r[0]: r[1] for r in rows}

        candidates = [
            t for t in all_tickers
            if count_map.get(t, 0) < MIN_ROWS_3Y
        ]
        return candidates
    finally:
        conn.close()


def main() -> None:
    args = parse_args()
    init_db()

    name_map = load_ticker_map()
    all_tickers = list(name_map.keys())
    print(f"[INFO] 로드된 티커: {len(all_tickers)}개 (TSV: {TSV_FILE.exists()})")

    if args.review_only:
        candidates = select_review_candidates(all_tickers)
        if not candidates:
            print("[REVIEW] 재백필 대상 없음 — 모든 ETF가 이미 3년 이상 데이터 보유")
        else:
            print(f"[REVIEW] 재백필 대상 {len(candidates)}개 "
                  f"(DB에 없거나 <{MIN_ROWS_3Y}행)")
            review_map = {t: name_map[t] for t in candidates}
            backfill_etf(review_map, args.years, args.sleep)
    elif not args.skip_backfill:
        backfill_etf(name_map, args.years, args.sleep)
    else:
        print("[INFO] 백필 skip — 이름만 동기화")
        upsert_with_names(name_map)

    # 필터/태깅은 항상 실행: 이번에 3년 충족한 종목이 있으면 자동으로 market='ETF' 설정됨
    dropped, kept = filter_under_3y(all_tickers)
    print_summary()
    print(f"\n[OK] ETF 시드 완료: {len(kept)}개 유지, {dropped}개 제거")


if __name__ == "__main__":
    main()
