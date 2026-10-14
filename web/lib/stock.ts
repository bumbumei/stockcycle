/**
 * 종목 상세 페이지용 순수 계산 헬퍼 (DB 의존성 없음 — 클라이언트 컴포넌트에서도 import 가능).
 *
 * 입력은 날짜 오름차순의 일봉 배열. 모든 "기간" 은 ETF 트렌드 페이지와 같은 달력일 기준이다.
 */
import type { MonthlyReturn } from "./db";

export type DailyBar = {
  date: string;   // 'YYYY-MM-DD'
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// ── 기간 ───────────────────────────────────────────────────────

export const STOCK_PERIODS = [
  { key: "1W", label: "1주", days: 7 },
  { key: "1M", label: "1개월", days: 30 },
  { key: "3M", label: "3개월", days: 90 },
  { key: "6M", label: "6개월", days: 180 },
  { key: "YTD", label: "연초 대비", days: 0 },
  { key: "1Y", label: "1년", days: 365 },
  { key: "3Y", label: "3년", days: 1095 },
  { key: "5Y", label: "5년", days: 1826 },
  { key: "10Y", label: "10년", days: 3652 },
] as const;
export type StockPeriodKey = (typeof STOCK_PERIODS)[number]["key"];

export function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' → 전년도 12월 31일 (YTD 기준일). */
export function prevYearEnd(iso: string): string {
  return `${Number(iso.slice(0, 4)) - 1}-12-31`;
}

/** date <= cutoff 인 마지막 인덱스 (없으면 -1). bars 는 날짜 오름차순. */
export function lastIndexOnOrBefore(bars: { date: string }[], cutoff: string): number {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].date <= cutoff) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

/** 기간별 수익률 % (최신 종가 / 기간 시작 종가 − 1). YTD 는 전년도 마지막 종가 기준. */
export function periodReturns(bars: DailyBar[]): Record<StockPeriodKey, number | null> {
  const out = {} as Record<StockPeriodKey, number | null>;
  if (bars.length === 0) {
    for (const p of STOCK_PERIODS) out[p.key] = null;
    return out;
  }
  const last = bars[bars.length - 1];
  for (const p of STOCK_PERIODS) {
    const cutoff = p.key === "YTD" ? prevYearEnd(last.date) : shiftDays(last.date, p.days);
    const i = lastIndexOnOrBefore(bars, cutoff);
    const base = i >= 0 ? bars[i].close : null;
    out[p.key] = base !== null && base > 0 && i < bars.length - 1 ? (last.close / base - 1) * 100 : null;
  }
  return out;
}

// ── 이동평균 / RSI ────────────────────────────────────────────

/** 단순이동평균. 창이 다 차기 전 구간은 null. */
export function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** Wilder RSI(n). 마지막 값만 반환 (데이터 부족 시 null). */
export function rsiLast(closes: number[], n = 14): number | null {
  if (closes.length < n + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= n; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d; else loss -= d;
  }
  let avgGain = gain / n, avgLoss = loss / n;
  for (let i = n + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (n - 1) + Math.max(d, 0)) / n;
    avgLoss = (avgLoss * (n - 1) + Math.max(-d, 0)) / n;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ── 변동성 / 낙폭 ─────────────────────────────────────────────

/** 구간 일간 수익률 표준편차(모집단) × √252, % 단위. 관측 5개 미만이면 null. */
export function annualizedVol(closes: number[]): number | null {
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0) rets.push(closes[i] / closes[i - 1] - 1);
  if (rets.length < 5) return null;
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const variance = rets.reduce((s, x) => s + (x - mean) * (x - mean), 0) / rets.length;
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

export type Drawdown = { mddPct: number; peakDate: string; troughDate: string; recoveredDate: string | null };

/** 구간 최대 낙폭 (종가 기준). 고점 → 저점 날짜와 회복일(있으면). */
export function maxDrawdown(bars: { date: string; close: number }[]): Drawdown | null {
  if (bars.length < 2) return null;
  let peak = bars[0].close, peakDate = bars[0].date;
  let best: Drawdown | null = null;
  let curPeakDate = peakDate;
  for (const b of bars) {
    if (b.close > peak) { peak = b.close; curPeakDate = b.date; }
    const dd = peak > 0 ? (b.close / peak - 1) * 100 : 0;
    if (!best || dd < best.mddPct) best = { mddPct: dd, peakDate: curPeakDate, troughDate: b.date, recoveredDate: null };
  }
  if (best && best.mddPct < 0) {
    const peakClose = bars.find((b) => b.date === best!.peakDate)!.close;
    const after = bars.find((b) => b.date > best!.troughDate && b.close >= peakClose);
    best.recoveredDate = after ? after.date : null;
  }
  return best;
}

// ── 월별 / 연도별 ─────────────────────────────────────────────

/**
 * 일봉 → 월별 수익률 (각 달 첫 종가 → 마지막 종가). lib/queries.ts 의 SQL(FIRST_VALUE/LAST_VALUE)과 같은 정의.
 */
export function monthlyFromDaily(bars: { date: string; close: number }[]): MonthlyReturn[] {
  const out: MonthlyReturn[] = [];
  let ym = "", first = 0, last = 0;
  const flush = () => {
    if (ym && first > 0) {
      out.push({ ym, year: Number(ym.slice(0, 4)), month: Number(ym.slice(5, 7)), return_pct: (last / first - 1) * 100 });
    }
  };
  for (const b of bars) {
    const m = b.date.slice(0, 7);
    if (m !== ym) { flush(); ym = m; first = b.close; }
    last = b.close;
  }
  flush();
  return out;
}

export type AnnualReturn = { year: number; returnPct: number; months: number; partial: boolean };

/** 월별 수익률을 연도별로 복리 합성. 12개월이 안 되는 해는 partial. */
export function annualReturns(monthly: MonthlyReturn[]): AnnualReturn[] {
  const byYear = new Map<number, number[]>();
  for (const r of monthly) byYear.set(r.year, [...(byYear.get(r.year) ?? []), r.return_pct]);
  return Array.from(byYear.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, xs]) => ({
      year,
      returnPct: (xs.reduce((acc, x) => acc * (1 + x / 100), 1) - 1) * 100,
      months: xs.length,
      partial: xs.length < 12,
    }));
}

// ── 벤치마크 대비 ─────────────────────────────────────────────

export type BetaStat = { beta: number; corr: number; months: number };

/** 최근 maxMonths 개월의 월별 수익률로 베타·상관계수. 겹치는 달이 minMonths 미만이면 null. */
export function betaAndCorr(
  asset: MonthlyReturn[],
  bench: MonthlyReturn[],
  maxMonths = 36,
  minMonths = 12
): BetaStat | null {
  const b = new Map(bench.map((r) => [r.ym, r.return_pct]));
  const pairs: [number, number][] = [];
  for (const r of asset) {
    const v = b.get(r.ym);
    if (v !== undefined) pairs.push([r.return_pct, v]);
  }
  const use = pairs.slice(-maxMonths);
  if (use.length < minMonths) return null;
  const n = use.length;
  const ma = use.reduce((s, p) => s + p[0], 0) / n;
  const mb = use.reduce((s, p) => s + p[1], 0) / n;
  let cov = 0, va = 0, vb = 0;
  for (const [a, bb] of use) { cov += (a - ma) * (bb - mb); va += (a - ma) ** 2; vb += (bb - mb) ** 2; }
  if (vb === 0 || va === 0) return null;
  return { beta: cov / vb, corr: cov / Math.sqrt(va * vb), months: n };
}

// ── 요약 ───────────────────────────────────────────────────────

export type Range = { low: number; high: number; pos: number | null }; // pos: 0~1 현재 위치

export function rangeOf(low: number, high: number, current: number): Range {
  const span = high - low;
  return { low, high, pos: span > 0 ? Math.min(1, Math.max(0, (current - low) / span)) : null };
}

export function average(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}
