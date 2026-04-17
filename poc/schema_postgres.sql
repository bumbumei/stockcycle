-- StockCycle Postgres schema (Neon / Supabase / RDS 호환)
-- SQLite 스키마와 의도적으로 유사하게 유지.
-- 날짜는 TEXT ('YYYY-MM-DD')로 통일하여 양쪽 SQL 호환성 확보.

CREATE TABLE IF NOT EXISTS tickers (
    ticker      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    market      TEXT NOT NULL,
    updated_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_prices (
    ticker      TEXT    NOT NULL,
    date        TEXT    NOT NULL,
    open        DOUBLE PRECISION NOT NULL,
    high        DOUBLE PRECISION NOT NULL,
    low         DOUBLE PRECISION NOT NULL,
    close       DOUBLE PRECISION NOT NULL,
    volume      BIGINT           NOT NULL,
    change_pct  DOUBLE PRECISION,
    PRIMARY KEY (ticker, date),
    FOREIGN KEY (ticker) REFERENCES tickers(ticker)
);

CREATE INDEX IF NOT EXISTS idx_daily_prices_date
    ON daily_prices(date);

CREATE INDEX IF NOT EXISTS idx_daily_prices_ticker_date
    ON daily_prices(ticker, date DESC);

CREATE TABLE IF NOT EXISTS macro_indicators (
    indicator   TEXT NOT NULL,
    date        TEXT NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (indicator, date)
);

CREATE INDEX IF NOT EXISTS idx_macro_date
    ON macro_indicators(date);

CREATE TABLE IF NOT EXISTS pending_tickers (
    ticker        TEXT PRIMARY KEY,
    requested_name TEXT,                  -- 사용자가 입력한 이름(옵션)
    market_hint   TEXT,                   -- 'KOSPI' | 'KOSDAQ' | 'ETF' | 'NASDAQ' | 'NYSE' | NULL (자동)
    status        TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'processing' | 'error'
    error_msg     TEXT,
    requested_at  TEXT NOT NULL,
    processed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_pending_status
    ON pending_tickers(status);

CREATE TABLE IF NOT EXISTS ingestion_log (
    id          BIGSERIAL PRIMARY KEY,
    ticker      TEXT    NOT NULL,
    from_date   TEXT    NOT NULL,
    to_date     TEXT    NOT NULL,
    rows        INTEGER NOT NULL,
    status      TEXT    NOT NULL,
    error_msg   TEXT,
    created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ingestion_created
    ON ingestion_log(created_at DESC);
