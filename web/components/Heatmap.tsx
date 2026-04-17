import { MonthlyReturn, MonthlyStat } from "@/lib/db";

const MONTHS = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

/** 수익률 → 배경색 (음:빨강, 양:초록, 0:회색). */
function returnColor(r: number | null | undefined): string {
  if (r === null || r === undefined || Number.isNaN(r)) return "#1f2937";
  const clamp = Math.max(-15, Math.min(15, r)) / 15; // -1 ~ 1
  if (clamp >= 0) {
    const a = 0.15 + clamp * 0.7;
    return `rgba(34,197,94,${a.toFixed(3)})`; // green-500
  }
  const a = 0.15 + -clamp * 0.7;
  return `rgba(239,68,68,${a.toFixed(3)})`; // red-500
}

/** 상승확률 → 색 (50% 기준, 50% 이상이면 초록 계열). */
function probColor(p: number): string {
  const delta = (p - 50) / 50; // -1 ~ 1
  if (delta >= 0) {
    const a = 0.2 + delta * 0.75;
    return `rgba(34,197,94,${a.toFixed(3)})`;
  }
  const a = 0.2 + -delta * 0.75;
  return `rgba(239,68,68,${a.toFixed(3)})`;
}

type Props = {
  returns: MonthlyReturn[];
  stats: MonthlyStat[];
};

export default function Heatmap({ returns, stats }: Props) {
  if (returns.length === 0) {
    return (
      <p className="text-gray-400">데이터가 없습니다. 먼저 backfill로 수집하세요.</p>
    );
  }

  // 연도별 그리드로 재구성
  const byYear = new Map<number, Record<number, number>>();
  for (const r of returns) {
    const row = byYear.get(r.year) ?? {};
    row[r.month] = r.return_pct;
    byYear.set(r.year, row);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      {/* 연도 × 월 히트맵 */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">
          연-월별 수익률 (%)
        </h3>
        <div className="overflow-x-auto">
          <table className="text-xs font-mono border-separate border-spacing-0.5">
            <thead>
              <tr>
                <th className="text-right px-2 text-gray-400">연도</th>
                {MONTHS.map((m) => (
                  <th key={m} className="w-14 text-center text-gray-400">{m}</th>
                ))}
                <th className="w-16 text-center text-gray-400 pl-3">연간</th>
              </tr>
            </thead>
            <tbody>
              {years.map((y) => {
                const row = byYear.get(y)!;
                const annual = Object.values(row).reduce((a, b) => a + b, 0);
                return (
                  <tr key={y}>
                    <td className="text-right pr-2 text-gray-300">{y}</td>
                    {MONTHS.map((_, i) => {
                      const m = i + 1;
                      const v = row[m];
                      return (
                        <td
                          key={m}
                          className="w-14 h-8 text-center"
                          style={{
                            backgroundColor: returnColor(v),
                            color: "white",
                          }}
                          title={v !== undefined ? `${y}년 ${m}월: ${v.toFixed(2)}%` : "데이터 없음"}
                        >
                          {v !== undefined ? v.toFixed(1) : "-"}
                        </td>
                      );
                    })}
                    <td
                      className="w-16 text-center pl-3 text-gray-200 font-semibold"
                      style={{ color: annual >= 0 ? "#4ade80" : "#f87171" }}
                    >
                      {annual.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 월별 집계 (상승확률) */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-2">
          월별 상승 확률 (10년 평균)
        </h3>
        <div className="grid grid-cols-12 gap-1">
          {stats.map((s) => (
            <div
              key={s.month}
              className="text-center rounded py-3"
              style={{ backgroundColor: probColor(s.up_probability) }}
              title={`${s.month}월: 상승확률 ${s.up_probability.toFixed(1)}%, 평균수익 ${s.avg_return.toFixed(2)}%`}
            >
              <div className="text-xs text-gray-100">{s.month}월</div>
              <div className="text-lg font-bold text-white">
                {s.up_probability.toFixed(0)}%
              </div>
              <div className="text-[10px] text-gray-100">
                {s.avg_return >= 0 ? "+" : ""}{s.avg_return.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ※ 과거 패턴은 미래 수익을 보장하지 않으며, 본 정보는 투자 권유가 아닙니다.
        </p>
      </div>
    </div>
  );
}
