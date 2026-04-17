/**
 * DB 레이어 — DATABASE_URL 환경변수에 따라 자동 분기.
 *   - postgres://... / postgresql://...  →  Postgres (Neon, Supabase 등)
 *   - 설정 없음                           →  로컬 SQLite (poc/stock.db)
 *
 * 프로덕션(Vercel): DATABASE_URL을 Neon Postgres로 지정
 * 로컬 개발       : DATABASE_URL 비워두면 기존 SQLite 그대로 사용
 */
// @ts-expect-error - node:sqlite 타입은 Node 24에서 내장, @types/node에 미포함
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { Pool } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

export const backend: "pg" | "sqlite" =
  DATABASE_URL?.startsWith("postgres") ? "pg" : "sqlite";

// ── Postgres 풀 (싱글턴) ────────────────────────────────────────
declare global {
  // eslint-disable-next-line no-var
  var __stockcycle_pg__: Pool | undefined;
  // eslint-disable-next-line no-var
  var __stockcycle_sqlite__: DatabaseSync | undefined;
}

export function getPgPool(): Pool {
  if (!globalThis.__stockcycle_pg__) {
    globalThis.__stockcycle_pg__ = new Pool({
      connectionString: DATABASE_URL,
      // Neon/Supabase는 TLS 필수. connection string의 sslmode=require로 처리되지만
      // 일부 클라이언트에선 여기서도 명시 필요.
      ssl: DATABASE_URL?.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
      max: 5,
    });
  }
  return globalThis.__stockcycle_pg__;
}

// ── SQLite (로컬 개발용) ────────────────────────────────────────
export function getSqliteDb(): DatabaseSync {
  if (!globalThis.__stockcycle_sqlite__) {
    const p =
      process.env.STOCKCYCLE_SQLITE_PATH ??
      path.resolve(process.cwd(), "..", "poc", "stock.db");
    globalThis.__stockcycle_sqlite__ = new DatabaseSync(p, { readOnly: true });
  }
  return globalThis.__stockcycle_sqlite__;
}

// ── 타입 ───────────────────────────────────────────────────────
export type TickerRow = {
  ticker: string;
  name: string;
  market: string;
};

export type MonthlyStat = {
  month: number;
  years_count: number;
  avg_return: number;
  up_probability: number;
  min_return: number;
  max_return: number;
};

export type MonthlyReturn = {
  ym: string;
  month: number;
  year: number;
  return_pct: number;
};
