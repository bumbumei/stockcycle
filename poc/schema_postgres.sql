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

-- 미국 ETF 트렌드 뷰어용 메타 (분류/한글 라벨). tickers.market='US_ETF' 와 짝.
CREATE TABLE IF NOT EXISTS etf_meta (
    ticker      TEXT PRIMARY KEY,
    category    TEXT,                 -- '시장대표' | '섹터' | '테마' | '국가' | '원자재' | '리츠'
    label       TEXT,                 -- 벤치마크/테마 한글 라벨 (예: '브라질', '반도체')
    issuer      TEXT,
    expense_ratio DOUBLE PRECISION,   -- 총보수 (소수: 0.0009 = 0.09%)
    dividend_freq TEXT,               -- '월' | '분기' | '반기' | '연'
    description TEXT,
    sort_order  INTEGER,
    hidden      INTEGER NOT NULL DEFAULT 0,  -- 1 이면 ETF 트렌드 집계에서 제외 (목록 편집기의 '숨김')
    updated_at  TEXT NOT NULL,
    FOREIGN KEY (ticker) REFERENCES tickers(ticker)
);

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

-- 접속 주소별 브랜드 (회사 로고 · 담당자 사진). 웹의 /brands/manage 에서 관리.
-- 웹 쪽도 처음 쓸 때 CREATE TABLE IF NOT EXISTS 로 만들어 두므로 양쪽 정의를 같게 유지할 것.
CREATE TABLE IF NOT EXISTS brands (
    slug        TEXT PRIMARY KEY,          -- ?brand=<slug> / /b/<slug>
    company     TEXT NOT NULL,
    person      TEXT,
    title       TEXT,
    phone       TEXT,
    email       TEXT,
    tagline     TEXT,
    logo_type   TEXT,                      -- image/png 등
    logo_data   TEXT,                      -- base64
    photo_type  TEXT,
    photo_data  TEXT,
    logo_plate  INTEGER NOT NULL DEFAULT 1, -- 1 이면 로고 뒤에 흰 배경판
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL
);
