import Link from "next/link";
import { notFound } from "next/navigation";
import FavoriteButton from "@/components/FavoriteButton";
import Heatmap from "@/components/Heatmap";
import { getTicker, monthlyReturns, monthlyStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function StockPage({
  params,
}: {
  params: Promise<{ ticker: string }>;
}) {
  const { ticker } = await params;
  const decoded = decodeURIComponent(ticker);
  const meta = await getTicker(decoded);
  if (!meta) notFound();

  const [stats, returns] = await Promise.all([
    monthlyStats(decoded),
    monthlyReturns(decoded),
  ]);

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
    </div>
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
