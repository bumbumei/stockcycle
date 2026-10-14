import Link from "next/link";
import { notFound } from "next/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import Heatmap from "@/components/Heatmap";
import { getTicker, monthlyReturns, monthlyStats, pingDb } from "@/lib/queries";

export const dynamic = "force-dynamic";

// 서버 함수 인스턴스가 뜬 시각 — 요청 시점과의 차이가 작으면 콜드 스타트 직후.
const BOOTED_AT = Date.now();

type Timings = {
  pingMs: number;      // DB 연결 수립 + 왕복 1회
  tickerMs: number;    // 종목 메타 조회
  monthlyMs: number;   // 월별 통계 + 월별 수익률 (병렬)
  totalMs: number;
  region: string;
  uptimeS: number;     // 함수 기동 후 경과 초
};

export default async function StockPage({
  params,
  searchParams,
}: {
  params: Promise<{ ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker);
  const sp = await searchParams;
  const debug = sp.debug !== undefined;

  const t0 = performance.now();
  await pingDb();
  const t1 = performance.now();
  const meta = await getTicker(decoded);
  if (!meta) notFound();
  const t2 = performance.now();

  const [stats, returns] = await Promise.all([
    monthlyStats(decoded),
    monthlyReturns(decoded),
  ]);
  const t3 = performance.now();

  const timings: Timings = {
    pingMs: Math.round(t1 - t0),
    tickerMs: Math.round(t2 - t1),
    monthlyMs: Math.round(t3 - t2),
    totalMs: Math.round(t3 - t0),
    region: process.env.VERCEL_REGION ?? "local",
    uptimeS: Math.round((Date.now() - BOOTED_AT) / 1000),
  };
  console.log(
    `[stocks/${decoded}] ping ${timings.pingMs}ms, ticker ${timings.tickerMs}ms, monthly ${timings.monthlyMs}ms, ` +
      `total ${timings.totalMs}ms (region ${timings.region}, uptime ${timings.uptimeS}s)`
  );

  // 요약 통계
  const bestMonth = [...stats].sort((a, b) => b.up_probability - a.up_probability)[0];
  const worstMonth = [...stats].sort((a, b) => a.up_probability - b.up_probability)[0];
  const overallUpProb =
    stats.reduce((sum, s) => sum + s.up_probability, 0) / (stats.length || 1);
  const totalMonths = returns.length;
  const dataFrom = returns[0]?.ym ?? "-";
  const dataTo = returns[returns.length - 1]?.ym ?? "-";

  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-400">
        <Link href="/" className="hover:text-white">← 전체 종목</Link>
      </nav>

      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <FavoriteButton ticker={meta.ticker} size="md" />
          <div>
            <div className="font-mono text-gray-500 text-sm">{meta.ticker}</div>
            <h1 className="text-2xl font-bold text-white">{meta.name}</h1>
          </div>
        </div>
        <span className="text-xs uppercase tracking-wide text-gray-400 border border-gray-700 rounded px-2 py-0.5">
          {meta.market}
        </span>
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="데이터 기간" value={`${dataFrom} ~ ${dataTo}`} sub={`${totalMonths}개월`} />
        <Card
          label="평균 상승 확률"
          value={`${overallUpProb.toFixed(1)}%`}
          sub="12개월 평균"
        />
        <Card
          label="최강 월"
          value={bestMonth ? `${bestMonth.month}월` : "-"}
          sub={bestMonth ? `${bestMonth.up_probability.toFixed(0)}% 상승` : ""}
          tone="up"
        />
        <Card
          label="최약 월"
          value={worstMonth ? `${worstMonth.month}월` : "-"}
          sub={worstMonth ? `${worstMonth.up_probability.toFixed(0)}% 상승` : ""}
          tone="down"
        />
      </section>

      <Heatmap returns={returns} stats={stats} />

      {debug && <DebugTimings t={timings} />}
    </div>
  );
}

/** `?debug=1` 일 때만 표시 — 이 요청의 서버 처리 시간 분해. 브라우저가 보는 총 시간은 여기에 네트워크 왕복 + 함수 콜드 스타트가 더해진다. */
function DebugTimings({ t }: { t: Timings }) {
  const cold = t.uptimeS < 5;
  return (
    <section className="bg-gray-900 border border-sky-900/60 rounded p-3 text-xs">
      <div className="text-sm font-semibold text-sky-200 mb-2">서버 처리 시간 (이 요청)</div>
      <table className="text-left">
        <tbody className="text-gray-300">
          <tr><td className="pr-4 py-0.5 text-gray-500">DB 연결 + 왕복 1회</td><td className="tabular-nums">{t.pingMs} ms</td></tr>
          <tr><td className="pr-4 py-0.5 text-gray-500">종목 메타 조회</td><td className="tabular-nums">{t.tickerMs} ms</td></tr>
          <tr><td className="pr-4 py-0.5 text-gray-500">월별 통계 + 수익률 (병렬)</td><td className="tabular-nums">{t.monthlyMs} ms</td></tr>
          <tr className="font-semibold text-white"><td className="pr-4 py-0.5">서버 합계</td><td className="tabular-nums">{t.totalMs} ms</td></tr>
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-gray-500">
        리전 {t.region} · 함수 기동 후 {t.uptimeS}초{cold ? " (콜드 스타트 직후 — 첫 연결 비용 포함)" : " (웜)"}.
        브라우저 DevTools → Network → 이 문서의 &ldquo;Waiting (TTFB)&rdquo;에서 서버 합계를 빼면 함수 기동 + 네트워크 시간입니다.
      </p>
    </section>
  );
}

function Card({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-green-400" : tone === "down" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-3">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}
