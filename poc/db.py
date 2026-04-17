"""
DB 어댑터 — DATABASE_URL 환경변수에 따라 SQLite/Postgres 자동 분기.

설계 원칙:
  - 기존 sqlite3.Connection API (execute, executemany, cursor, __enter__/__exit__,
    commit, close)를 그대로 노출하는 얇은 PgConnWrapper 제공
  - 호출 코드(backfill.py / incremental.py / backfill_macro.py)는 무수정
  - ? 파라미터 플레이스홀더를 Postgres용 %s로 자동 치환
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any, Iterable

DB_PATH = Path(__file__).parent / "stock.db"
SCHEMA_PG_FILE = Path(__file__).parent / "schema_postgres.sql"

# ── SQLite 스키마 (기존과 동일) ────────────────────────────────
SCHEMA = """
CREATE TABLE IF NOT EXISTS tickers (
    ticker      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    market      TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_prices (
    ticker      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    open        REAL    NOT NULL,
    high        REAL    NOT NULL,
    low         REAL    NOT NULL,
    close       REAL    NOT NULL,
    volume      INTEGER NOT NULL,
    change_pct  REAL,
    PRIMARY KEY (ticker, date),
    FOREIGN KEY (ticker) REFERENCES tickers(ticker)
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_date
    ON daily_prices(date);

CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date
    ON daily_prices(ticker, date DESC);

CREATE TABLE IF NOT EXISTS macro_indicators (
    indicator   TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    value       REAL    NOT NULL,
    PRIMARY KEY (indicator, date)
);

CREATE INDEX IF NOT EXISTS idx_macro_date
    ON macro_indicators(date);

CREATE TABLE IF NOT EXISTS pending_tickers (
    ticker         TEXT PRIMARY KEY,
    requested_name TEXT,
    market_hint    TEXT,
    status         TEXT    NOT NULL DEFAULT 'pending',
    error_msg      TEXT,
    requested_at   TEXT    NOT NULL,
    processed_at   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_status
    ON pending_tickers(status);

CREATE TABLE IF NOT EXISTS ingestion_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker      TEXT    NOT NULL,
    from_date   TEXT    NOT NULL,
    to_date     TEXT    NOT NULL,
    rows        INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    error_msg   TEXT,
    created_at  TEXT    NOT NULL
);
"""


def is_pg() -> bool:
    """DATABASE_URL 이 postgres 로 시작하면 True."""
    url = os.environ.get("DATABASE_URL", "")
    return url.startswith(("postgres://", "postgresql://"))


# ─────────────────────────────────────────────────────────────
# Postgres 어댑터 — sqlite3 API를 흉내내는 얇은 래퍼
# ─────────────────────────────────────────────────────────────

def _pg_sql(sql: str) -> str:
    """SQLite '?' 플레이스홀더를 Postgres '%s'로 치환."""
    return sql.replace("?", "%s")


class _PgCursorResult:
    """conn.execute(...).fetchone() 패턴을 지원하기 위한 결과 래퍼."""

    def __init__(self, cur) -> None:
        self._cur = cur

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    def __iter__(self):
        return iter(self._cur)


class PgConnWrapper:
    """psycopg3 Connection을 sqlite3.Connection 처럼 사용하기 위한 래퍼."""

    def __init__(self, raw) -> None:  # raw: psycopg.Connection
        self._raw = raw

    # ── sqlite3.Connection과 동일한 시그니처 ───────────────────
    def execute(self, sql: str, params: Iterable[Any] = ()) -> _PgCursorResult:
        cur = self._raw.cursor()
        cur.execute(_pg_sql(sql), tuple(params))
        return _PgCursorResult(cur)

    def executemany(self, sql: str, rows: Iterable[Any]) -> None:
        with self._raw.cursor() as cur:
            cur.executemany(_pg_sql(sql), list(rows))

    def executescript(self, sql: str) -> None:
        """여러 문장을 한 번에 실행 (스키마 로드용)."""
        with self._raw.cursor() as cur:
            cur.execute(sql)

    def cursor(self):
        return self._raw.cursor()

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        self._raw.close()

    # sqlite3 호환 동작: `with conn:` 은 commit/rollback만 하고 연결은 유지.
    # psycopg3 기본은 연결까지 닫으므로 수동으로 구현.
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is None:
            self._raw.commit()
        else:
            self._raw.rollback()
        return False  # 예외 억제하지 않음


# ─────────────────────────────────────────────────────────────
# 공개 API
# ─────────────────────────────────────────────────────────────

def get_conn():
    """SQLite 또는 Postgres 커넥션 반환 (호출 코드는 무수정)."""
    if is_pg():
        import psycopg  # lazy import
        conn = psycopg.connect(os.environ["DATABASE_URL"])
        return PgConnWrapper(conn)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """스키마 초기화. 백엔드에 맞는 DDL을 실행."""
    conn = get_conn()
    try:
        if is_pg():
            ddl = SCHEMA_PG_FILE.read_text(encoding="utf-8")
            conn.executescript(ddl)
            target = os.environ["DATABASE_URL"].split("@")[-1]
            conn.commit()
            print(f"[OK] Postgres 스키마 초기화 완료 → {target}")
        else:
            conn.executescript(SCHEMA)
            conn.commit()
            print(f"[OK] SQLite 스키마 초기화 완료: {DB_PATH}")
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
