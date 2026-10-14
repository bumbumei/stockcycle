import Link from "next/link";
import { notFound } from "next/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import Heatmap from "@/components/Heatmap";
import PriceChart from "@/components/PriceChart";
import { trendOf, vsSma } from "@/lib/etf";
import { dailyBars, dailyCloses, getTickerWithMeta, statsFromReturns } from "@/lib/queries";
import {
  annualReturns,
  annualizedVol,
  average,
  betaAndCorr,
  maxDrawdown,
  monthlyFromDaily,
  periodReturns,
  rangeOf,
  rsiLast,
  shiftDays,
  sma,
  STOCK_PERIODS,
} from "@/lib/stock";

// 종목별로 1시간 ISR 캐시. 일별 수집 직후 /api/revalidate 가 "/stocks/[ticker]" 를 무효화한다.
// 동적 세그먼트 라우트는 generateStaticParams 가 없으면 항상 동적 렌더(캐시 없음)가 되므로 빈 배열이라도 내보낸다.
export const revalidate = 3600;
export const dynamicParams = true;
export function generateStaticParams(): { ticker: string }[] {
  return [];
}

const KR_MARKETS = new Set(["KOSPI", "KOSDAQ", "ETF"]);
const MARKET_LABEL: Record<string, string> = {
  KOSPI: "코스피", KOSDAQ: "코스닥", ETF: "한국 ETF", NASDAQ: "나스닥", NYSE: "NYSE",
  US_ETF: "미국 ETF", PCX: "NYSE Arca", US_OTHER: "미국",
};

/** 벤치마크: 미국은 SPY, 한국은 KODEX 200(069500). 자기 자신이거나 데이터가 없으면 생략. */
function benchmarkFor(market: string): { ticker: string; label: string } {
  return KR_MARKETS.has(market)
    ? { ticker: "069500", label: "KODEX 200" }
    : { ticker: "SPY", label: "S&P 500 (SPY)" };
}

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker);

  const t0 = performance.now();
  const meta = await getTickerWithMeta(decoded);
  if (!meta) notFound();
  const bars = await dailyBars(decoded);
  const isKr = KR_MARKETS.has(meta.market);
  const bench = benchmarkFor(meta.market);
  const asOf = bars.length ? bars[bars.length - 1].date : null;
  const benchCloses =
    bench.ticker !== decoded && asOf ? await dailyCloses(bench.ticker, shiftDays(asOf, 1130)) : [];
  console.log(
    `[stocks/${decoded}] ${bars.length} bars, ${benchCloses.length} bench rows, ${Math.round(performance.now() - t0)}ms` +
      ` (region ${process.env.VERCEL_REGION ?? "local"})`
  );

  // ── 계산 ──────────────────────────────────────────────────
  const monthly = monthlyFromDaily(bars);
  const stats = statsFromReturns(monthly);
  const closes = bars.map((b) => b.close);
  const last = bars[bars.length - 1] ?? null;
  const prev = bars.length > 1 ? bars[bars.length - 2] : null;
  const dayChange = last && prev ? last.close - prev.close : null;
  const dayChangePct = last && prev && prev.close > 0 ? (last.close / prev.close - 1) * 100 : null;

  const since = (days: number) => (asOf ? bars.filter((b) => b.date > shiftDays(asOf, days)) : []);
  const bars1y = since(365), bars3m = since(90), bars3y = since(1095);
  const r52 = bars1y.length && last
    ? rangeOf(Math.min(...bars1y.map((b) => b.low)), Math.max(...bars1y.map((b) => b.high)), last.close)
    : null;
  const r3y = bars3y.length && last
    ? rangeOf(Math.min(...bars3y.map((b) => b.close)), Math.max(...bars3y.map((b) => b.close)), last.close)
    : null;
  const avgVol3m = average(bars3m.map((b) => b.volume));
  const periods = periodReturns(bars);
  const sma50 = sma(closes, 50), sma200 = sma(closes, 200);
  const s50 = sma50[sma50.length - 1] ?? null, s200 = sma200[sma200.length - 1] ?? null;
  const trend = last ? trendOf({ close: last.close, sma50: s50, sma200: s200 }) : null;
  const rsi = rsiLast(closes, 14);
  const vol1y = annualizedVol(bars1y.map((b) => b.close));
  const mdd1y = maxDrawdown(bars1y), mdd3y = maxDrawdown(bars3y), mddAll = maxDrawdown(bars);
  const riskAdj1y = periods["1Y"] !== null && vol1y ? periods["1Y"] / vol1y : null;
  const beta = benchCloses.length ? betaAndCorr(monthly, monthlyFromDaily(benchCloses), 36, 12) : null;
  const annual = annualReturns(monthly);
  const recent = bars.slice(-10).reverse();

  // 요약 통계 (기존)
  const bestMonth = [...stats].sort((a, b) => b.up_probability - a.up_probability)[0];
  const worstMonth = [...stats].sort((a, b) => a.up_probability - b.up_probability)[0];
  const overallUpProb = stats.reduce((sum, s) => sum + s.up_probability, 0) / (stats.length || 1);

  const fmtPrice = (v: number | null) =>
    v === null ? "—" : isKr ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(2);
  const fmtPct = (v: number | null, d = 2) =>
    v === null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;
  const fmtVol = (v: number | null) =>
    v === null ? "—" : new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const tone = (v: number | null) => (v === null ? "text-gray-500" : v > 0 ? "text-green-400" : v < 0 ? "text-red-400" : "text-gray-300");

  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-400 flex gap-3">
        <Link href="/" className="hover:text-white">← 전체 종목</Link>
        {meta.market === "US_ETF" && <Link href="/etf" className="hover:text-white">← ETF 트렌드</Link>}
      </nav>

      {/* 헤더 */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <FavoriteButton ticker={meta.ticker} size="md" />
          <div className="min-w-0">
            <div className="font-mono text-gray-500 text-sm flex items-center gap-2">
              {meta.ticker}
              <span className="text-[10px] uppercase tracking-wide text-gray-400 border border-gray-700 rounded px-1.5 py-0.5">
                {MARKET_LABEL[meta.market] ?? meta.market}
              </span>
              {trend && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  trend === "상승" ? "text-green-300 border-green-700/60 bg-green-500/10"
                  : trend === "하락" ? "text-red-300 border-red-700/60 bg-red-500/10"
                  : "text-gray-300 border-gray-700 bg-gray-800/60"}`} title="50/200일 이동평균 기준 추세">
                  {trend}추세
                </span>
              )}
            </div>
            <h1 className="text-2xl font-bold text-white truncate">{meta.name}</h1>
            {meta.etf && (
              <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-400">
                {meta.etf.category && <Chip>{meta.etf.category}</Chip>}
                {meta.etf.label && <Chip>{meta.etf.label}</Chip>}
                {meta.etf.issuer && <Chip>{meta.etf.issuer}</Chip>}
                {meta.etf.expenseRatio !== null && <Chip>총보수 {(meta.etf.expenseRatio * 100).toFixed(2)}%</Chip>}
                {meta.etf.dividendFreq && <Chip>배당 {meta.etf.dividendFreq}</Chip>}
              </div>
            )}
          </div>
        </div>

        {/* 현재가 */}
        {last && (
          <div className="text-right">
            <div className="text-3xl font-bold text-white leading-tight">
              {fmtPrice(last.close)}
              <span className="text-sm text-gray-500 font-normal ml-1">{isKr ? "원" : "USD"}</span>
            </div>
            <div className={`text-sm font-semibold tabular-nums ${tone(dayChangePct)}`}>
              {dayChange !== null && (dayChange > 0 ? "+" : "")}{fmtPrice(dayChange)} ({fmtPct(dayChangePct)})
            </div>
            <div className="text-[11px] text-gray-500">{last.date} 종가 기준{prev ? ` · 전일 ${fmtPrice(prev.close)}` : ""}</div>
          </div>
        )}
      </header>

      {bars.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded p-4 text-sm text-gray-400">
          아직 가격 데이터가 없습니다. 다음 데이터 동기화 때 채워집니다.
        </div>
      ) : (
        <>
          {/* 시세 요약 (야후 Summary) */}
          <section className="bg-gray-900 border border-gray-800 rounded p-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-x-4 gap-y-3 text-xs">
            <Kv label="시가" value={fmtPrice(last!.open)} />
            <Kv label="고가" value={fmtPrice(last!.high)} />
            <Kv label="저가" value={fmtPrice(last!.low)} />
            <Kv label="거래량" value={fmtVol(last!.volume)} sub={avgVol3m ? `3개월 평균 ${fmtVol(avgVol3m)}` : undefined} />
            <Kv label="50일 이동평균" value={fmtPrice(s50)} sub={fmtPct(vsSma(last!.close, s50), 1)} subTone={tone(vsSma(last!.close, s50))} />
            <Kv label="200일 이동평균" value={fmtPrice(s200)} sub={fmtPct(vsSma(last!.close, s200), 1)} subTone={tone(vsSma(last!.close, s200))} />
            <div className="col-span-2">
              <div className="text-[10px] text-gray-500">당일 범위</div>
              <RangeBar low={last!.low} high={last!.high} cur={last!.close} fmt={fmtPrice} />
            </div>
            <div className="col-span-2">
              <div className="text-[10px] text-gray-500">52주 범위 (장중 고저)</div>
              {r52 ? <RangeBar low={r52.low} high={r52.high} cur={last!.close} fmt={fmtPrice} /> : <div className="text-gray-500">—</div>}
            </div>
            <div className="col-span-2">
              <div className="text-[10px] text-gray-500">3년 종가 범위</div>
              {r3y ? <RangeBar low={r3y.low} high={r3y.high} cur={last!.close} fmt={fmtPrice} /> : <div className="text-gray-500">—</div>}
            </div>
            <Kv label="데이터" value={`${bars.length.toLocaleString()}일`} sub={`${bars[0].date} ~ ${last!.date}`} />
            <Kv label="RSI (14)" value={rsi === null ? "—" : rsi.toFixed(0)}
              sub={rsi === null ? undefined : rsi >= 70 ? "과매수 구간" : rsi <= 30 ? "과매도 구간" : "중립"}
              subTone={rsi === null ? undefined : rsi >= 70 ? "text-red-400" : rsi <= 30 ? "text-green-400" : "text-gray-400"} />
          </section>

          {/* 가격 차트 */}
          <PriceChart
            ticker={meta.ticker}
            dates={bars.map((b) => b.date)}
            closes={closes}
            volumes={bars.map((b) => b.volume)}
            isKr={isKr}
          />

          {/* 기간별 수익률 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-300 mb-2">기간별 수익률 <span className="text-[11px] text-gray-500 font-normal">달력일 기준 · 배당 미반영</span></h2>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
              {STOCK_PERIODS.map((p) => (
                <div key={p.key} className="bg-gray-900 border border-gray-800 rounded px-2.5 py-2">
                  <div className="text-[10px] text-gray-500">{p.label}</div>
                  <div className={`text-base font-bold tabular-nums ${tone(periods[p.key])}`}>{fmtPct(periods[p.key], 1)}</div>
                </div>
              ))}
            </div>
          </section>

          {/* 위험·추세 지표 */}
          <section>
            <h2 className="text-sm font-semibold text-gray-300 mb-2">위험 · 추세 지표</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
              <Stat label="변동성 (1년, 연율)" value={vol1y === null ? "—" : `${vol1y.toFixed(1)}%`}
                hint="최근 1년 일간 수익률 표준편차 × √252" />
              <Stat label="위험조정 수익 (1년)" value={riskAdj1y === null ? "—" : riskAdj1y.toFixed(2)}
                tone={tone(riskAdj1y)} hint="1년 수익률 ÷ 1년 변동성. 클수록 덜 흔들리며 오른 것" />
              <Stat label="최대낙폭 1년" value={fmtPct(mdd1y?.mddPct ?? null, 1)} tone="text-red-300"
                sub={mdd1y ? `${mdd1y.peakDate} → ${mdd1y.troughDate}${mdd1y.recoveredDate ? " · 회복" : " · 미회복"}` : undefined}
                hint="최근 1년 중 고점 대비 가장 깊었던 하락" />
              <Stat label="최대낙폭 3년" value={fmtPct(mdd3y?.mddPct ?? null, 1)} tone="text-red-300"
                sub={mdd3y ? `${mdd3y.peakDate} → ${mdd3y.troughDate}` : undefined} />
              <Stat label="최대낙폭 전체" value={fmtPct(mddAll?.mddPct ?? null, 1)} tone="text-red-300"
                sub={mddAll ? `${mddAll.peakDate} → ${mddAll.troughDate}${mddAll.recoveredDate ? ` · ${mddAll.recoveredDate} 회복` : " · 미회복"}` : undefined} />
              <Stat label={`베타 · 상관 vs ${bench.label}`}
                value={beta ? `β ${beta.beta.toFixed(2)} · ρ ${beta.corr.toFixed(2)}` : "—"}
                sub={
                  beta
                    ? `최근 ${beta.months}개월 월간 수익률`
                    : bench.ticker === decoded
                    ? "벤치마크 자신"
                    : benchCloses.length === 0
                    ? "벤치마크 데이터 없음"
                    : "겹치는 월 데이터 12개월 미만"
                }
                hint="베타 1 = 벤치마크와 같은 폭으로 움직임, 상관 1 = 방향이 거의 같음" />
            </div>
          </section>

          {/* 연도별 + 월별 */}
          <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded p-3">
              <h2 className="text-sm font-semibold text-gray-300 mb-2">연도별 수익률 <span className="text-[11px] text-gray-500 font-normal">월별 수익률 복리 합성</span></h2>
              <AnnualBars rows={annual} />
            </div>
            <div className="lg:col-span-3 space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Card label="평균 상승 확률" value={`${overallUpProb.toFixed(1)}%`} sub="12개월 평균" />
                <Card label="최강 월" value={bestMonth ? `${bestMonth.month}월` : "-"} sub={bestMonth ? `${bestMonth.up_probability.toFixed(0)}% 상승` : ""} tone="up" />
                <Card label="최약 월" value={worstMonth ? `${worstMonth.month}월` : "-"} sub={worstMonth ? `${worstMonth.up_probability.toFixed(0)}% 상승` : ""} tone="down" />
              </div>
              <div className="overflow-x-auto">
                <Heatmap returns={monthly} stats={stats} />
              </div>
            </div>
          </section>

          {/* 최근 거래 */}
          <section className="bg-gray-900 border border-gray-800 rounded overflow-x-auto">
            <h2 className="text-sm font-semibold text-gray-300 px-3 py-2 border-b border-gray-800">최근 10거래일</h2>
            <table className="w-full text-xs tabular-nums whitespace-nowrap">
              <thead className="text-gray-500">
                <tr>
                  <th className="px-3 py-1.5 text-left">날짜</th>
                  <th className="px-3 py-1.5 text-right">시가</th>
                  <th className="px-3 py-1.5 text-right">고가</th>
                  <th className="px-3 py-1.5 text-right">저가</th>
                  <th className="px-3 py-1.5 text-right">종가</th>
                  <th className="px-3 py-1.5 text-right">전일比</th>
                  <th className="px-3 py-1.5 text-right">거래량</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80 text-gray-300">
                {recent.map((b, i) => {
                  const p = recent[i + 1] ?? bars[bars.length - recent.length - 1];
                  const chg = p && p.close > 0 ? (b.close / p.close - 1) * 100 : null;
                  return (
                    <tr key={b.date}>
                      <td className="px-3 py-1">{b.date}</td>
                      <td className="px-3 py-1 text-right">{fmtPrice(b.open)}</td>
                      <td className="px-3 py-1 text-right">{fmtPrice(b.high)}</td>
                      <td className="px-3 py-1 text-right">{fmtPrice(b.low)}</td>
                      <td className="px-3 py-1 text-right text-white">{fmtPrice(b.close)}</td>
                      <td className={`px-3 py-1 text-right ${tone(chg)}`}>{fmtPct(chg)}</td>
                      <td className="px-3 py-1 text-right">{b.volume.toLocaleString("ko-KR")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>

          {meta.etf?.description && (
            <section className="bg-gray-900 border border-gray-800 rounded p-3 text-sm text-gray-300 leading-relaxed">
              <h2 className="text-sm font-semibold text-gray-300 mb-1">설명</h2>
              {meta.etf.description}
            </section>
          )}

          <p className="text-[11px] text-gray-500">
            모든 값은 일별 종가로 계산한 참고 수치입니다. 배당·분배금은 반영하지 않았고, 52주 범위만 장중 고저를 씁니다. 투자 권유가 아닙니다.
          </p>
        </>
      )}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="px-1.5 py-0.5 rounded border border-gray-800 bg-gray-900">{children}</span>;
}

function Kv({ label, value, sub, subTone }: { label: string; value: string; sub?: string; subTone?: string }) {
  return (
    <div>
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-100 tabular-nums">{value}</div>
      {sub && <div className={`text-[10px] tabular-nums ${subTone ?? "text-gray-500"}`}>{sub}</div>}
    </div>
  );
}

function RangeBar({ low, high, cur, fmt }: { low: number; high: number; cur: number; fmt: (v: number) => string }) {
  const span = high - low;
  const pos = span > 0 ? Math.min(1, Math.max(0, (cur - low) / span)) : 0.5;
  return (
    <div className="mt-1">
      <div className="relative h-1.5 rounded bg-gray-800">
        <div className="absolute inset-y-0 left-0 rounded bg-amber-500/50" style={{ width: `${pos * 100}%` }} />
        <div className="absolute -top-0.5 w-2.5 h-2.5 rounded-full bg-amber-300 border-2 border-gray-900" style={{ left: `calc(${pos * 100}% - 5px)` }} />
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 tabular-nums mt-0.5">
        <span>{fmt(low)}</span>
        <span className="text-gray-500">{(pos * 100).toFixed(0)}% 위치</span>
        <span>{fmt(high)}</span>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone, hint }: { label: string; value: string; sub?: string; tone?: string; hint?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded px-2.5 py-2" title={hint}>
      <div className="text-[10px] text-gray-500 leading-tight">{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight mt-0.5 ${tone ?? "text-white"}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}

function AnnualBars({ rows }: { rows: { year: number; returnPct: number; months: number; partial: boolean }[] }) {
  if (rows.length === 0) return <div className="text-xs text-gray-500">데이터 없음</div>;
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.returnPct)));
  return (
    <ul className="space-y-1 text-xs">
      {rows.map((r) => {
        const w = (Math.abs(r.returnPct) / maxAbs) * 100;
        const up = r.returnPct >= 0;
        return (
          <li key={r.year} className="grid grid-cols-[3.5rem,1fr,4.5rem] items-center gap-2">
            <span className="text-gray-400 tabular-nums">
              {r.year}{r.partial && <span className="text-gray-600" title={`${r.months}개월분`}>*</span>}
            </span>
            <div className="relative h-3 bg-gray-800/60 rounded-sm overflow-hidden">
              <div
                className={`absolute inset-y-0 ${up ? "left-1/2 rounded-r-sm bg-green-500/60" : "right-1/2 rounded-l-sm bg-red-500/60"}`}
                style={{ width: `${w / 2}%` }}
              />
              <div className="absolute inset-y-0 left-1/2 w-px bg-gray-600" />
            </div>
            <span className={`text-right tabular-nums font-semibold ${up ? "text-green-400" : "text-red-400"}`}>
              {r.returnPct > 0 ? "+" : ""}{r.returnPct.toFixed(1)}%
            </span>
          </li>
        );
      })}
      {rows.some((r) => r.partial) && <li className="text-[10px] text-gray-600">* 12개월이 안 되는 해 (상장 첫해 또는 올해)</li>}
    </ul>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-green-400" : tone === "down" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
