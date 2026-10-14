import {
  backend,
  getPgPool,
  getSqliteDb,
  MonthlyReturn,
  MonthlyStat,
  PendingTicker,
  TickerRow,
  TickerWithMetrics,
} from "./db";
import { ETF_PERIODS, EtfPeriodKey, EtfTrendData, EtfTrendRow } from "./etf";

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

async function runWrite(sql: string, params: unknown[] = []): Promise<number> {
  if (backend === "pg") {
    const r = await getPgPool().query(paramStyle(sql, params.length), params);
    return r.rowCount ?? 0;
  }
  const db = getSqliteDb() as { prepare: (s: string) => { run: (...p: unknown[]) => { changes: number } } };
  const res = db.prepare(sql).run(...params);
  return res.changes ?? 0;
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

// ── 종목 추가 요청 (pending_tickers) ────────────────────────────

export async function listPending(): Promise<PendingTicker[]> {
  const rows = await selectAll<Record<string, unknown>>(
    `SELECT ticker, requested_name, market_hint, status, error_msg,
            requested_at, processed_at
     FROM pending_tickers
     ORDER BY requested_at DESC`
  );
  return rows.map((r) => ({
    ticker: String(r.ticker),
    requestedName: r.requested_name ? String(r.requested_name) : null,
    marketHint: r.market_hint ? String(r.market_hint) : null,
    status: (String(r.status) as PendingTicker["status"]) || "pending",
    errorMsg: r.error_msg ? String(r.error_msg) : null,
    requestedAt: String(r.requested_at),
    processedAt: r.processed_at ? String(r.processed_at) : null,
  }));
}

export async function existsTicker(ticker: string): Promise<boolean> {
  const row = await selectAll<{ n: number }>(
    "SELECT COUNT(*) AS n FROM tickers WHERE ticker = ?",
    [ticker]
  );
  return Number(row[0]?.n ?? 0) > 0;
}

/** pending_tickers에 INSERT. 이미 있으면 재시도(pending으로 되돌림). */
export async function enqueuePending(input: {
  ticker: string;
  requestedName?: string | null;
  marketHint?: string | null;
}): Promise<{ created: boolean }> {
  const now = new Date().toISOString();
  const changes = await runWrite(
    `INSERT INTO pending_tickers
       (ticker, requested_name, market_hint, status, error_msg, requested_at, processed_at)
     VALUES (?, ?, ?, 'pending', NULL, ?, NULL)
     ON CONFLICT(ticker) DO UPDATE SET
         requested_name = excluded.requested_name,
         market_hint    = excluded.market_hint,
         status         = 'pending',
         error_msg      = NULL,
         requested_at   = excluded.requested_at,
         processed_at   = NULL`,
    [
      input.ticker,
      input.requestedName ?? null,
      input.marketHint ?? null,
      now,
    ]
  );
  return { created: changes > 0 };
}

// ── 미국 ETF 트렌드 (기간별 수익률 랭킹) ─────────────────────────

const ETF_MARKET = "US_ETF";
/** 기간 시작점 탐색 시 허용하는 최대 공백(일). 이보다 오래된 종가는 쓰지 않는다. */
const ETF_LOOKBACK_SLACK_DAYS = 45;
/** 유니버스 기준일보다 이만큼 뒤처진 티커는 랭킹에서 제외. */
const ETF_STALE_DAYS = 7;

const QUERY_ETF_AS_OF = `
SELECT MAX(dp.date) AS as_of
FROM daily_prices dp
WHERE dp.ticker IN (SELECT ticker FROM tickers WHERE market = '${ETF_MARKET}')
`;

/**
 * 티커당 1행으로 (최신 종가, 전일 종가, 기간별 시작 종가, 1년/3년 고저) 를 뽑는다.
 *
 *   1. w     : 유니버스 티커의 최근 (가장 긴 기간 + slack) 일치 종가 + LAG 로 전일 종가
 *   2. marks : 티커별 GROUP BY 한 번으로 "cutoff 이하 가장 최근 거래일" 과 1년/3년 고저를 집계
 *   3. 각 기간의 날짜로 daily_prices 를 (ticker, date) PK 로 되찾아 종가를 붙인다
 *
 * 파라미터 순서: [lower, cutoff×기간수, cutoff_1Y, cutoff_1Y, cutoff_3Y, cutoff_3Y]
 * SQLite / Postgres 양쪽에서 동일하게 동작하는 표준 SQL (window + CASE 집계 + PK 조인).
 */
const QUERY_ETF_TREND = `
WITH universe AS (
    SELECT t.ticker, t.name,
           em.category, em.label, em.issuer,
           em.expense_ratio, em.dividend_freq, em.description,
           em.sort_order
    FROM tickers t
    LEFT JOIN etf_meta em ON em.ticker = t.ticker
    WHERE t.market = '${ETF_MARKET}'
),
w AS (
    SELECT dp.ticker, dp.date, dp.close,
           LAG(dp.close) OVER (PARTITION BY dp.ticker ORDER BY dp.date) AS prev_close
    FROM daily_prices dp
    WHERE dp.ticker IN (SELECT ticker FROM universe)
      AND dp.date >= CAST(? AS TEXT)
),
marks AS (
    SELECT w.ticker,
           MAX(w.date) AS d_latest${ETF_PERIODS.map(
             (p) =>
               `,\n           MAX(CASE WHEN w.date <= CAST(? AS TEXT) THEN w.date END) AS d_${p.key}`
           ).join("")},
           MIN(CASE WHEN w.date > CAST(? AS TEXT) THEN w.close END) AS low_1y,
           MAX(CASE WHEN w.date > CAST(? AS TEXT) THEN w.close END) AS high_1y,
           MIN(CASE WHEN w.date > CAST(? AS TEXT) THEN w.close END) AS low_3y,
           MAX(CASE WHEN w.date > CAST(? AS TEXT) THEN w.close END) AS high_3y
    FROM w
    GROUP BY w.ticker
)
SELECT u.ticker, u.name, u.category, u.label, u.issuer,
       u.expense_ratio, u.dividend_freq, u.description, u.sort_order,
       m.d_latest, l.close AS c_latest, l.prev_close,
       m.low_1y, m.high_1y, m.low_3y, m.high_3y${ETF_PERIODS.map(
         (p) => `,\n       p_${p.key}.close AS c_${p.key}`
       ).join("")}
FROM universe u
LEFT JOIN marks m ON m.ticker = u.ticker
LEFT JOIN w l ON l.ticker = u.ticker AND l.date = m.d_latest${ETF_PERIODS.map(
  (p) =>
    `\nLEFT JOIN daily_prices p_${p.key} ON p_${p.key}.ticker = u.ticker AND p_${p.key}.date = m.d_${p.key}`
).join("")}
ORDER BY u.sort_order, u.ticker
`;

function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
    - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round(ms / 86_400_000);
}

function emptyReturns(): Record<EtfPeriodKey, number | null> {
  const r = {} as Record<EtfPeriodKey, number | null>;
  for (const p of ETF_PERIODS) r[p.key] = null;
  return r;
}

/**
 * 미국 ETF 유니버스(market='US_ETF') 전 종목의 기간별 수익률.
 * 테이블이 아직 없거나 DB 오류 시에는 throw 하지 않고 error 필드로 돌려준다
 * (빌드 타임 프리렌더가 깨지지 않도록).
 */
export async function etfTrend(): Promise<EtfTrendData> {
  try {
    const asOfRow = await selectOne<{ as_of: string | null }>(QUERY_ETF_AS_OF);
    const asOf = asOfRow?.as_of ? String(asOfRow.as_of) : null;

    // 가격이 전혀 없어도 유니버스는 보여줄 수 있도록 기준일이 없으면 오늘 날짜 사용
    const base = asOf ?? new Date().toISOString().slice(0, 10);
    const maxDays = Math.max(...ETF_PERIODS.map((p) => p.days));
    const cutoff1y = shiftDays(base, 365);
    const cutoff3y = shiftDays(base, 1095);
    const params: unknown[] = [
      shiftDays(base, maxDays + ETF_LOOKBACK_SLACK_DAYS),
      ...ETF_PERIODS.map((p) => shiftDays(base, p.days)),
      cutoff1y, cutoff1y, cutoff3y, cutoff3y,
    ];

    const raw = await selectAll<Record<string, unknown>>(QUERY_ETF_TREND, params);

    const rows: EtfTrendRow[] = raw.map((r) => {
      const close = numOrNull(r.c_latest);
      const prev = numOrNull(r.prev_close);
      const returns = emptyReturns();
      if (close !== null) {
        for (const p of ETF_PERIODS) {
          const b = numOrNull(r[`c_${p.key}`]);
          returns[p.key] = b !== null && b > 0 ? (close / b - 1) * 100 : null;
        }
      }
      const rowAsOf = r.d_latest ? String(r.d_latest) : null;
      return {
        ticker: String(r.ticker),
        name: String(r.name),
        category: r.category ? String(r.category) : null,
        label: r.label ? String(r.label) : null,
        issuer: r.issuer ? String(r.issuer) : null,
        expenseRatio: numOrNull(r.expense_ratio),
        dividendFreq: r.dividend_freq ? String(r.dividend_freq) : null,
        description: r.description ? String(r.description) : null,
        asOf: rowAsOf,
        close,
        dayChangePct:
          close !== null && prev !== null && prev > 0 ? (close / prev - 1) * 100 : null,
        high1y: numOrNull(r.high_1y),
        low1y: numOrNull(r.low_1y),
        high3y: numOrNull(r.high_3y),
        low3y: numOrNull(r.low_3y),
        stale:
          !rowAsOf || (asOf !== null && daysBetween(asOf, rowAsOf) > ETF_STALE_DAYS),
        returns,
      };
    });

    return { asOf, count: rows.length, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[etfTrend] query failed:", msg);
    return { asOf: null, count: 0, rows: [], error: msg };
  }
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
