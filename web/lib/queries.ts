import {
  backend,
  getPgPool,
  getSqliteDb,
  MonthlyReturn,
  MonthlyStat,
  TickerRow,
  TickerWithMetrics,
} from "./db";

/**
 * 양쪽 백엔드가 공유하는 SQL.
 * - 날짜는 두 DB 모두 TEXT 'YYYY-MM-DD' → substr(date, ...)로 통일 가능.
 * - FIRST_VALUE / LAST_VALUE window 함수 양쪽 지원.
 * - 다른 것은 **파라미터 바인딩 스타일**뿐:
 *     SQLite: ?   Postgres: $1, $2, ...
 */
function paramStyle(sql: string, nParams: number): string {
  if (backend === "pg") {
    let i = 0;
    return sql.replace(/\?/g, () => `$${++i}`);
  }
  return sql; // SQLite는 ? 그대로
}

// node:sqlite의 prepared statement 형태를 얇게 타이핑 (의존성 없이).
type SqliteStmt = {
  all: (...p: unknown[]) => unknown[];
  get: (...p: unknown[]) => unknown;
};
type SqliteLike = { prepare: (sql: string) => SqliteStmt };

async function selectAll<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (backend === "pg") {
    const r = await getPgPool().query(paramStyle(sql, params.length), params);
    return r.rows as T[];
  }
  const db = getSqliteDb() as SqliteLike;
  return db.prepare(sql).all(...params) as unknown as T[];
}

async function selectOne<T>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  if (backend === "pg") {
    const r = await getPgPool().query(paramStyle(sql, params.length), params);
    return (r.rows[0] as T) ?? undefined;
  }
  const db = getSqliteDb() as SqliteLike;
  const row = db.prepare(sql).get(...params);
  return (row as T) ?? undefined;
}

// ── 공개 쿼리 API ───────────────────────────────────────────────

export async function listTickers(): Promise<TickerRow[]> {
  return selectAll<TickerRow>(
    "SELECT ticker, name, market FROM tickers ORDER BY ticker"
  );
}

export async function searchTickers(q: string, limit = 20): Promise<TickerRow[]> {
  const like = `%${q}%`;
  return selectAll<TickerRow>(
    `SELECT ticker, name, market FROM tickers
     WHERE ticker ILIKE ? OR name ILIKE ?
     ORDER BY ticker LIMIT ?`.replace(/ILIKE/g, backend === "pg" ? "ILIKE" : "LIKE"),
    [like, like, limit]
  );
}

export async function getTicker(ticker: string): Promise<TickerRow | undefined> {
  return selectOne<TickerRow>(
    "SELECT ticker, name, market FROM tickers WHERE ticker = ?",
    [ticker]
  );
}

/**
 * 월별 집계 — 평균 수익률, 상승확률, 최소/최대 수익률.
 * 양쪽 DB에서 동일하게 동작하는 표준 SQL (substr + window + GROUP BY).
 */
const QUERY_MONTH_STATS = `
WITH monthly AS (
    SELECT
        substr(date, 1, 7) AS ym,
        CAST(substr(date, 6, 2) AS INTEGER) AS month,
        FIRST_VALUE(close) OVER (
            PARTITION BY substr(date, 1, 7) ORDER BY date ASC
        ) AS first_close,
        LAST_VALUE(close) OVER (
            PARTITION BY substr(date, 1, 7) ORDER BY date ASC
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
    COUNT(*) AS years_count,
    AVG(return_pct) AS avg_return,
    AVG(CASE WHEN return_pct > 0 THEN 1.0 ELSE 0.0 END) * 100 AS up_probability,
    MIN(return_pct) AS min_return,
    MAX(return_pct) AS max_return
FROM distinct_monthly
GROUP BY month
ORDER BY month
`;

export async function monthlyStats(ticker: string): Promise<MonthlyStat[]> {
  const rows = await selectAll<Record<string, unknown>>(QUERY_MONTH_STATS, [ticker]);
  // Postgres의 NUMERIC은 string으로 반환되므로 정규화
  return rows.map((r) => ({
    month: Number(r.month),
    years_count: Number(r.years_count),
    avg_return: Number(r.avg_return),
    up_probability: Number(r.up_probability),
    min_return: Number(r.min_return),
    max_return: Number(r.max_return),
  }));
}

const QUERY_MONTHLY_RETURNS = `
WITH monthly AS (
    SELECT
        substr(date, 1, 7) AS ym,
        CAST(substr(date, 1, 4) AS INTEGER) AS year,
        CAST(substr(date, 6, 2) AS INTEGER) AS month,
        FIRST_VALUE(close) OVER (
            PARTITION BY substr(date, 1, 7) ORDER BY date ASC
        ) AS first_close,
        LAST_VALUE(close) OVER (
            PARTITION BY substr(date, 1, 7) ORDER BY date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS last_close
    FROM daily_prices
    WHERE ticker = ?
)
SELECT DISTINCT ym, year, month,
    (last_close - first_close) / first_close * 100.0 AS return_pct
FROM monthly
ORDER BY ym
`;

export async function monthlyReturns(ticker: string): Promise<MonthlyReturn[]> {
  const rows = await selectAll<Record<string, unknown>>(
    QUERY_MONTHLY_RETURNS,
    [ticker]
  );
  return rows.map((r) => ({
    ym: String(r.ym),
    year: Number(r.year),
    month: Number(r.month),
    return_pct: Number(r.return_pct),
  }));
}

/**
 * 전 종목을 한 번에 읽어 홈 화면용 메트릭을 부착.
 *
 * 계산:
 *   - currentPrice: 최신 daily_prices.close
 *   - asOf: 최신 daily_prices.date
 *   - thisMonthActual: 이번 달(asOf 기준) first_close → 현재 close 수익률
 *   - thisMonthExpected: 과거 같은 달들의 평균 수익률 (이번 달은 제외)
 *   - nextMonthExpected: (asOf 월 + 1)월의 과거 평균 수익률
 *
 * 비용: daily_prices 전체를 한 번 스캔 + 윈도우. Neon에서 1~3초 예상.
 * 홈 페이지에서만 호출하고 ISR(1시간)로 캐싱 권장.
 */
const QUERY_TICKERS_WITH_METRICS = `
WITH latest_per_ticker AS (
    SELECT dp.ticker,
           dp.close       AS current_price,
           dp.date        AS as_of,
           dp.change_pct  AS day_change_pct
    FROM daily_prices dp
    INNER JOIN (
        SELECT ticker, MAX(date) AS max_date
        FROM daily_prices
        GROUP BY ticker
    ) m ON m.ticker = dp.ticker AND m.max_date = dp.date
),
monthly_bounds AS (
    SELECT DISTINCT
        ticker,
        substr(date, 1, 7) AS ym,
        CAST(substr(date, 6, 2) AS INTEGER) AS month,
        FIRST_VALUE(close) OVER (
            PARTITION BY ticker, substr(date, 1, 7) ORDER BY date ASC
        ) AS first_close,
        LAST_VALUE(close) OVER (
            PARTITION BY ticker, substr(date, 1, 7) ORDER BY date ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
        ) AS last_close
    FROM daily_prices
),
monthly_pct AS (
    SELECT ticker, ym, month,
           (last_close - first_close) / first_close * 100.0 AS ret
    FROM monthly_bounds
    WHERE first_close > 0
),
current_month_ret AS (
    SELECT mp.ticker, mp.ret AS this_month_actual
    FROM monthly_pct mp
    INNER JOIN latest_per_ticker l ON l.ticker = mp.ticker
    WHERE mp.ym = substr(l.as_of, 1, 7)
),
this_month_hist AS (
    SELECT mp.ticker, AVG(mp.ret) AS this_month_expected
    FROM monthly_pct mp
    INNER JOIN latest_per_ticker l ON l.ticker = mp.ticker
    WHERE mp.month = CAST(substr(l.as_of, 6, 2) AS INTEGER)
      AND mp.ym  <> substr(l.as_of, 1, 7)
    GROUP BY mp.ticker
),
next_month_hist AS (
    SELECT mp.ticker, AVG(mp.ret) AS next_month_expected
    FROM monthly_pct mp
    INNER JOIN latest_per_ticker l ON l.ticker = mp.ticker
    WHERE mp.month = CASE
        WHEN CAST(substr(l.as_of, 6, 2) AS INTEGER) = 12 THEN 1
        ELSE CAST(substr(l.as_of, 6, 2) AS INTEGER) + 1
    END
    GROUP BY mp.ticker
)
SELECT
    t.ticker, t.name, t.market,
    lpt.current_price, lpt.as_of,
    lpt.day_change_pct,
    -- 절대 등락가: price - price/(1+pct/100) = price * pct / (100+pct)
    CASE WHEN lpt.day_change_pct IS NULL OR (100 + lpt.day_change_pct) = 0
         THEN NULL
         ELSE lpt.current_price * lpt.day_change_pct / (100.0 + lpt.day_change_pct)
    END AS day_change_abs,
    cmr.this_month_actual,
    tmh.this_month_expected,
    nmh.next_month_expected
FROM tickers t
LEFT JOIN latest_per_ticker lpt ON lpt.ticker = t.ticker
LEFT JOIN current_month_ret cmr ON cmr.ticker = t.ticker
LEFT JOIN this_month_hist  tmh ON tmh.ticker = t.ticker
LEFT JOIN next_month_hist  nmh ON nmh.ticker = t.ticker
ORDER BY t.ticker
`;

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function listTickersWithMetrics(): Promise<TickerWithMetrics[]> {
  const rows = await selectAll<Record<string, unknown>>(QUERY_TICKERS_WITH_METRICS);
  return rows.map((r) => ({
    ticker: String(r.ticker),
    name: String(r.name),
    market: String(r.market),
    currentPrice: numOrNull(r.current_price),
    asOf: r.as_of ? String(r.as_of) : null,
    dayChangeAbs: numOrNull(r.day_change_abs),
    dayChangePct: numOrNull(r.day_change_pct),
    thisMonthActual: numOrNull(r.this_month_actual),
    thisMonthExpected: numOrNull(r.this_month_expected),
    nextMonthExpected: numOrNull(r.next_month_expected),
  }));
}
