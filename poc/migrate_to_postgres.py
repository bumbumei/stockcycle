"""
SQLite (stock.db) → Postgres (Neon/Supabase) 일회성 마이그레이션.

사용법:
    # 1) Neon/Supabase에서 DATABASE_URL 복사 (sslmode=require 포함)
    export DATABASE_URL="postgresql://user:pw@host/db?sslmode=require"
    # Windows PowerShell: $env:DATABASE_URL="..."

    # 2) 스키마 생성 + 데이터 복사
    python migrate_to_postgres.py
    # 또는: 스키마만, 데이터만
    python migrate_to_postgres.py --schema-only
    python migrate_to_postgres.py --data-only
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

import psycopg
from psycopg import sql
from tqdm import tqdm


SQLITE_PATH = Path(__file__).parent / "stock.db"
SCHEMA_FILE = Path(__file__).parent / "schema_postgres.sql"

TABLES_IN_ORDER = [
    # (table, columns, batch_size)
    ("tickers",          ["ticker", "name", "market", "updated_at"], 500),
    ("daily_prices",     ["ticker", "date", "open", "high", "low",
                          "close", "volume", "change_pct"], 2000),
    ("macro_indicators", ["indicator", "date", "value"], 2000),
    ("ingestion_log",    ["ticker", "from_date", "to_date", "rows",
                          "status", "error_msg", "created_at"], 500),
]


def ensure_env() -> str:
    url = os.environ.get("DATABASE_URL")
    if not url:
        print("ERROR: DATABASE_URL 환경변수가 필요합니다.", file=sys.stderr)
        print("예: postgresql://user:pw@host/db?sslmode=require", file=sys.stderr)
        sys.exit(2)
    return url


def create_schema(pg: psycopg.Connection) -> None:
    """schema_postgres.sql 을 그대로 실행. (db.init_db와 동일 로직)"""
    print(f"[1/2] 스키마 생성: {SCHEMA_FILE.name}")
    if not SCHEMA_FILE.exists():
        print(f"ERROR: {SCHEMA_FILE} 없음", file=sys.stderr)
        sys.exit(4)
    ddl = SCHEMA_FILE.read_text(encoding="utf-8")
    with pg.cursor() as cur:
        cur.execute(ddl)
    pg.commit()
    print("      ✓ 테이블 생성 완료")


def copy_table(sq: sqlite3.Connection, pg: psycopg.Connection,
               table: str, columns: list[str], batch_size: int) -> int:
    src_cols = ", ".join(columns)
    total = sq.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    if total == 0:
        print(f"      {table}: 0 rows (skip)")
        return 0

    placeholders = ", ".join(["%s"] * len(columns))
    insert_stmt = sql.SQL(
        "INSERT INTO {tbl} ({cols}) VALUES ({vals}) ON CONFLICT DO NOTHING"
    ).format(
        tbl=sql.Identifier(table),
        cols=sql.SQL(", ").join(map(sql.Identifier, columns)),
        vals=sql.SQL(placeholders),
    )

    cur_sq = sq.execute(f"SELECT {src_cols} FROM {table}")
    moved = 0
    with pg.cursor() as cur_pg, tqdm(total=total, desc=f"  {table}", unit="row") as pbar:
        batch = []
        for row in cur_sq:
            batch.append(row)
            if len(batch) >= batch_size:
                cur_pg.executemany(insert_stmt, batch)
                moved += len(batch)
                pbar.update(len(batch))
                batch = []
        if batch:
            cur_pg.executemany(insert_stmt, batch)
            moved += len(batch)
            pbar.update(len(batch))
    pg.commit()
    return moved


def copy_data(pg: psycopg.Connection) -> None:
    print(f"[2/2] 데이터 복사: {SQLITE_PATH.name}")
    if not SQLITE_PATH.exists():
        print(f"ERROR: {SQLITE_PATH} 없음. poc/ 에서 먼저 백필 실행 필요.",
              file=sys.stderr)
        sys.exit(3)

    sq = sqlite3.connect(SQLITE_PATH)
    try:
        total = 0
        for table, cols, bs in TABLES_IN_ORDER:
            moved = copy_table(sq, pg, table, cols, bs)
            total += moved
        print(f"      ✓ 총 {total:,} rows 이관")
    finally:
        sq.close()


def verify(pg: psycopg.Connection) -> None:
    print("\n[검증] 행 수 비교")
    sq = sqlite3.connect(SQLITE_PATH)
    try:
        with pg.cursor() as cur:
            print(f"  {'table':<20} {'sqlite':>10} {'postgres':>10}  match")
            print(f"  {'-'*20} {'-'*10} {'-'*10}  -----")
            for table, _, _ in TABLES_IN_ORDER:
                n_sq = sq.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                cur.execute(f"SELECT COUNT(*) FROM {table}")
                n_pg = cur.fetchone()[0]
                ok = "✓" if n_sq == n_pg else "✗"
                print(f"  {table:<20} {n_sq:>10,} {n_pg:>10,}  {ok}")
    finally:
        sq.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="SQLite → Postgres 마이그레이션")
    p.add_argument("--schema-only", action="store_true")
    p.add_argument("--data-only", action="store_true")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    url = ensure_env()
    print(f"[INFO] Postgres 연결: {url.split('@')[-1]}")

    with psycopg.connect(url) as pg:
        if not args.data_only:
            create_schema(pg)
        if not args.schema_only:
            copy_data(pg)
            verify(pg)
    print("\n[OK] 마이그레이션 완료")


if __name__ == "__main__":
    main()
