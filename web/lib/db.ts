/**
 * DB 레이어 — DATABASE_URL 환경변수에 따라 자동 분기.
 *   - postgres://... / postgresql://...  →  Postgres (Neon, Supabase 등)
 *   - 설정 없음                           →  로컬 SQLite (poc/stock.db) via node:sqlite (Node 24+)
 *
 * 프로덕션(Vercel)은 반드시 DATABASE_URL을 설정 — Vercel의 Node 22에는
 * node:sqlite 가 실험 플래그 뒤에 있어 로드 시 터진다. 따라서 sqlite 모듈은
 * **실제로 sqlite 백엔드로 갈 때에만** 동적으로 require 한다.
 */
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
  var __stockcycle_sqlite__: unknown | undefined;
}

export function getPgPool(): Pool {
  if (!globalThis.__stockcycle_pg__) {
    globalThis.__stockcycle_pg__ = new Pool({
      connectionString: DATABASE_URL,
      ssl: DATABASE_URL?.includes("sslmode=require")
        ? { rejectUnauthorized: false }
        : undefined,
      max: 5,
    });
  }
  return globalThis.__stockcycle_pg__;
}

// ── SQLite (로컬 개발 전용) ────────────────────────────────────
// 프로덕션 Vercel에서는 이 함수가 호출되지 않도록 backend 분기로 보호됨.
// node:sqlite 는 Node 24+ 에서 stable. Node 22 런타임에서는 require 자체가 실패할 수 있음.
export function getSqliteDb(): unknown {
  if (!globalThis.__stockcycle_sqlite__) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("node:sqlite") as { DatabaseSync: new (p: string, o?: object) => unknown };
    const p =
      process.env.STOCKCYCLE_SQLITE_PATH ??
      path.resolve(process.cwd(), "..", "poc", "stock.db");
    globalThis.__stockcycle_sqlite__ = new mod.DatabaseSync(p, { readOnly: true });
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
