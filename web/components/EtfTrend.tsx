"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  breadthOf,
  buildShareText,
  categoryStats,
  displayLabel,
  ETF_CATEGORY_ORDER,
  ETF_PERIODS,
  EtfPeriodKey,
  EtfTrendData,
  EtfTrendRow,
  fromHigh1y,
  fromLow1y,
  isNearHigh,
  isNearLow,
  isoWeek,
  MacroItem,
  periodLabel,
  position3y,
  prevRankMap,
  RANK_COMPARE_DAYS,
  RankMode,
  rankMap,
  rankRows,
  rankValue,
  SIGNAL_MDD_PCT,
  SIGNAL_NEAR_PCT,
  signalsOf,
  topAndWorst,
  trendOf,
  vsSma,
} from "@/lib/etf";
import { useFavorites } from "@/lib/favorites";
import FavoriteButton from "./FavoriteButton";

type Props = { data: EtfTrendData; macro: MacroItem[] };

const UNCATEGORIZED = "기타";
/** 기존 주간알람 시트와 같은 구성: 1개월 + 3개월. */
const WEEKLY_REPORT_PERIODS: EtfPeriodKey[] = ["1M", "3M"];

function pctColor(v: number | null): string {
  if (v === null) return "text-gray-500";
  if (v > 0) return "text-green-400";
  if (v < 0) return "text-red-400";
  return "text-gray-300";
}

function formatPct(v: number | null, digits = 2): string {
  if (v === null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

function formatNum(v: number | null, digits = 2): string {
  if (v === null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function formatPrice(v: number | null): string {
  if (v === null) return "—";
  return v >= 100 ? v.toFixed(0) : v.toFixed(2);
}

function formatRatio(v: number | null): string {
  if (v === null) return "—";
  return `${(v * 100).toFixed(2)}%`;
}

function categoryOf(r: EtfTrendRow): string {
  return r.category ?? UNCATEGORIZED;
}

function sortCategories(cats: Iterable<string>): string[] {
  const present = new Set(cats);
  const ordered = ETF_CATEGORY_ORDER.filter((c) => present.has(c));
  const rest = Array.from(present)
    .filter((c) => !ETF_CATEGORY_ORDER.includes(c))
    .sort();
  return [...ordered, ...rest];
}

function trendClass(t: ReturnType<typeof trendOf>): string {
  if (t === "상승") return "text-green-300 border-green-700/60 bg-green-500/10";
  if (t === "하락") return "text-red-300 border-red-700/60 bg-red-500/10";
  if (t === "혼조") return "text-gray-300 border-gray-700 bg-gray-800/60";
  return "text-gray-600 border-gray-800";
}

export default function EtfTrend({ data, macro }: Props) {
  const { favorites } = useFavorites();
  const [period, setPeriod] = useState<EtfPeriodKey>("1M");
  const [mode, setMode] = useState<RankMode>("return");
  const [category, setCategory] = useState<string>("all");
  const [onlyFav, setOnlyFav] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const categories = useMemo(
    () => sortCategories(data.rows.map(categoryOf)),
    [data.rows]
  );

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: data.rows.length };
    for (const r of data.rows) {
      const c = categoryOf(r);
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [data.rows]);

  const favCount = useMemo(
    () => data.rows.filter((r) => favorites.includes(r.ticker)).length,
    [data.rows, favorites]
  );

  // 분류/관심 필터 적용된 유니버스 (stale 포함 — 전체 표에서는 흐리게 표시)
  const scoped = useMemo(
    () =>
      data.rows.filter((r) => {
        if (category !== "all" && categoryOf(r) !== category) return false;
        if (onlyFav && !favorites.includes(r.ticker)) return false;
        return true;
      }),
    [data.rows, category, onlyFav, favorites]
  );

  const ranked = useMemo(() => rankRows(scoped, period, mode), [scoped, period, mode]);
  const { top, worst } = useMemo(
    () => topAndWorst(scoped, period, 10, mode),
    [scoped, period, mode]
  );
  const currentRank = useMemo(() => rankMap(ranked), [ranked]);
  // 순위 변동은 수익률 기준 순위끼리만 비교 (위험조정 모드에서는 표시 안 함)
  const previousRank = useMemo(
    () => (mode === "return" ? prevRankMap(scoped, period) : null),
    [scoped, period, mode]
  );
  const excluded = useMemo(
    () => scoped.filter((r) => r.stale || rankValue(r, period, mode) === null),
    [scoped, period, mode]
  );

  const breadth = useMemo(() => breadthOf(scoped), [scoped]);
  const catStats = useMemo(() => categoryStats(scoped, UNCATEGORIZED), [scoped]);
  const signals = useMemo(() => signalsOf(scoped), [scoped]);

  const copy = async (kind: "current" | "weekly") => {
    const periods = kind === "weekly" ? WEEKLY_REPORT_PERIODS : [period];
    const title =
      kind === "weekly" && data.asOf ? `${isoWeek(data.asOf)}주차 미국 ETF동향` : null;
    const text = buildShareText({
      rows: scoped,
      periods,
      universeCount: data.count,
      category: category === "all" ? null : category,
      asOf: data.asOf,
      title,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(`${kind}:ok`);
    } catch {
      setCopied(`${kind}:err`);
    }
    setTimeout(() => setCopied(null), 2000);
  };

  const copyLabel = (kind: "current" | "weekly", base: string) =>
    copied === `${kind}:ok` ? "복사됨 ✓" : copied === `${kind}:err` ? "복사 실패" : base;

  return (
    <div className="space-y-6">
      {/* 컨트롤 */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500 mr-1">기간</span>
          {ETF_PERIODS.map((p) => (
            <Chip
              key={p.key}
              label={p.label}
              active={period === p.key}
              onClick={() => setPeriod(p.key)}
              tone="amber"
            />
          ))}
          <span className="mx-1 text-gray-700">|</span>
          <span className="text-gray-500 mr-1">기준</span>
          <Chip label="수익률" active={mode === "return"} onClick={() => setMode("return")} />
          <Chip
            label="위험조정"
            active={mode === "riskAdj"}
            onClick={() => setMode("riskAdj")}
            title="수익률 ÷ 기간 변동성. 같은 수익률이면 흔들림이 적었던 ETF가 위"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="text-gray-500 mr-1">분류</span>
          <Chip
            label={`전체 ${counts.all}`}
            active={category === "all"}
            onClick={() => setCategory("all")}
          />
          {categories.map((c) => (
            <Chip
              key={c}
              label={`${c} ${counts[c] ?? 0}`}
              active={category === c}
              onClick={() => setCategory(c)}
            />
          ))}
          <span className="mx-1 text-gray-700">|</span>
          <Chip
            label={`★ 관심만 ${favCount}`}
            active={onlyFav}
            onClick={() => setOnlyFav((v) => !v)}
            tone="yellow"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
          <div>
            기준일 <span className="text-gray-200 tabular-nums">{data.asOf ?? "—"}</span>
            {" · "}
            {ranked.length}개 집계
            {excluded.length > 0 && (
              <span
                className="text-gray-500"
                title={excluded.map((r) => r.ticker).join(", ")}
              >
                {" "}
                (제외 {excluded.length}: 데이터 지연/부족)
              </span>
            )}
            {data.prevAsOf && mode === "return" && (
              <span className="text-gray-500"> · ▲▼ = {data.prevAsOf} 순위 대비</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowGuide((v) => !v)}
              aria-expanded={showGuide}
              className={`px-3 py-1.5 rounded border transition ${
                showGuide
                  ? "border-sky-600/60 bg-sky-500/10 text-sky-200"
                  : "border-gray-700 bg-gray-900 hover:border-gray-500 hover:text-white"
              }`}
              title="각 지표가 무엇이고 어떻게 읽는지"
            >
              ⓘ 읽는 법
            </button>
            <button
              type="button"
              onClick={() => copy("current")}
              disabled={ranked.length === 0}
              className="px-3 py-1.5 rounded border border-gray-700 bg-gray-900 hover:border-gray-500 hover:text-white transition disabled:opacity-40"
              title={`${periodLabel(period)} 수익률 Top/Worst 10 텍스트 복사`}
            >
              {copyLabel("current", `📋 ${periodLabel(period)} 복사`)}
            </button>
            <button
              type="button"
              onClick={() => copy("weekly")}
              disabled={ranked.length === 0}
              className="px-3 py-1.5 rounded border border-amber-700/60 bg-amber-500/10 text-amber-200 hover:bg-amber-500/20 transition disabled:opacity-40"
              title="주간알람 포맷(1개월 + 3개월 Top/Worst 10) 복사"
            >
              {copyLabel("weekly", "📋 주간 리포트 복사")}
            </button>
          </div>
        </div>

        {showGuide && <GuidePanel onClose={() => setShowGuide(false)} />}
      </section>

      {/* Top / Worst */}
      {ranked.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded p-6 text-center text-gray-400 text-sm">
          {onlyFav && favCount === 0
            ? "★ 관심 ETF가 없습니다. 아래 전체 목록이나 종목 카드에서 ★를 눌러 등록하세요."
            : "집계할 수 있는 ETF가 없습니다."}
        </div>
      ) : (
        <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RankList
            title={`${periodLabel(period)} TOP ${top.length}${mode === "riskAdj" ? " (위험조정)" : ""}`}
            rows={top}
            period={period}
            mode={mode}
            tone="up"
            currentRank={currentRank}
            previousRank={previousRank}
          />
          <RankList
            title={`${periodLabel(period)} Worst ${worst.length}${mode === "riskAdj" ? " (위험조정)" : ""}`}
            rows={worst}
            period={period}
            mode={mode}
            tone="down"
            currentRank={currentRank}
            previousRank={previousRank}
          />
        </section>
      )}

      {/* 분석 */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold text-gray-300">
          분석{category !== "all" ? ` — ${category}` : ""}{onlyFav ? " — ★ 관심" : ""}
        </h2>

        {/* 시장 환경 + 시장 폭 */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 xl:grid-cols-8 gap-2">
          {macro.map((m) => (
            <MacroTile key={m.key} m={m} />
          ))}
          <StatTile
            label="200일선 위"
            value={breadth.above200 === null ? "—" : `${breadth.above200.toFixed(0)}%`}
            sub={`50일선 위 ${breadth.above50 === null ? "—" : `${breadth.above50.toFixed(0)}%`}`}
            tone={breadth.above200 === null ? undefined : breadth.above200 >= 50 ? "up" : "down"}
            hint="시장 폭(breadth). 집계 대상 ETF 중 종가가 이평선보다 높은 비율. 50% 아래면 넓게 약한 장"
          />
          <StatTile
            label="상승추세 비율"
            value={breadth.uptrend === null ? "—" : `${breadth.uptrend.toFixed(0)}%`}
            sub={`하락추세 ${breadth.downtrend === null ? "—" : `${breadth.downtrend.toFixed(0)}%`}`}
            tone={breadth.uptrend === null ? undefined : breadth.uptrend >= 50 ? "up" : "down"}
            hint="상승 = 종가 > 200일선 & 50일선 > 200일선 (골든크로스 상태), 하락 = 그 반대"
          />
          <StatTile
            label={`평균 ${periodLabel(period)} 수익률`}
            value={formatPct(catStats[0]?.avg[period] ?? null, 1)}
            sub={`${breadth.n}개 동일가중`}
            tone={
              (catStats[0]?.avg[period] ?? null) === null
                ? undefined
                : (catStats[0].avg[period] as number) >= 0
                ? "up"
                : "down"
            }
            hint="집계 대상 ETF의 단순 평균 수익률"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          {/* 분류별 평균 */}
          <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded overflow-x-auto">
            <div className="px-3 py-2 border-b border-gray-800 text-xs font-semibold text-gray-300 flex items-center justify-between gap-2">
              <span>분류별 평균 수익률 (동일가중) — 어디로 돈이 도는지</span>
              <span className="text-[10px] text-gray-500 font-normal">분류를 누르면 필터</span>
            </div>
            <table className="w-full text-xs whitespace-nowrap">
              <thead className="text-gray-500">
                <tr>
                  <th className="px-2 py-1.5 text-left">분류</th>
                  <th className="px-2 py-1.5 text-right">수</th>
                  {ETF_PERIODS.map((p) => (
                    <th
                      key={p.key}
                      className={`px-2 py-1.5 text-right cursor-pointer hover:text-white ${
                        p.key === period ? "text-amber-300" : ""
                      }`}
                      onClick={() => setPeriod(p.key)}
                    >
                      {p.label}
                    </th>
                  ))}
                  <th className="px-2 py-1.5 text-right" title="분류 내 200일선 위 비율">
                    200일선↑
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80">
                {catStats.map((s) => (
                  <tr
                    key={s.category}
                    className={`${s.category === "전체" ? "bg-gray-950/40 font-semibold" : "hover:bg-gray-800/40"}`}
                  >
                    <td className="px-2 py-1.5">
                      {s.category === "전체" ? (
                        <span className="text-gray-200">전체</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setCategory(category === s.category ? "all" : s.category)}
                          className={`hover:text-white ${category === s.category ? "text-amber-300" : "text-gray-200"}`}
                        >
                          {s.category}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-500 tabular-nums">{s.count}</td>
                    {ETF_PERIODS.map((p) => (
                      <td
                        key={p.key}
                        className={`px-2 py-1.5 text-right tabular-nums ${pctColor(s.avg[p.key])} ${
                          p.key === period ? "bg-amber-500/5" : ""
                        }`}
                      >
                        {formatPct(s.avg[p.key], 1)}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right tabular-nums text-gray-300">
                      {s.above200 === null ? "—" : `${s.above200.toFixed(0)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 시그널 */}
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
            <SignalList
              title="52주 신고가 근접"
              hint={`최근 365일 최고 종가에 가까운 순. ${SIGNAL_NEAR_PCT}% 이내는 강조 — 돌파·추세 지속 후보`}
              rows={signals.nearHigh}
              metric={(r) => `고가 ${formatPrice(r.high1y)} · ${formatPct(fromHigh1y(r), 1)}`}
              highlight={isNearHigh}
              highlightLabel={`${SIGNAL_NEAR_PCT}% 이내`}
              tone="up"
            />
            <SignalList
              title="52주 신저가 근접"
              hint={`최근 365일 최저 종가에 가까운 순. ${SIGNAL_NEAR_PCT}% 이내는 강조 — 약세 지속 또는 과매도`}
              rows={signals.nearLow}
              metric={(r) => `저가 ${formatPrice(r.low1y)} · +${formatNum(fromLow1y(r), 1)}%`}
              highlight={isNearLow}
              highlightLabel={`${SIGNAL_NEAR_PCT}% 이내`}
              tone="down"
            />
            <SignalList
              title="저점 반등 (바닥 탈출 후보)"
              hint={`1년 최대낙폭 ${SIGNAL_MDD_PCT}% 이하였는데 1개월 수익률이 플러스이고 50일선을 회복한 ETF. 1개월 수익률 순`}
              rows={signals.rebound}
              metric={(r) => `${formatPct(r.returns["1M"], 1)} · MDD ${formatPct(r.mdd1y, 0)}`}
              tone="up"
            />
            <SignalList
              title="추세 전환 초기"
              hint="50일선이 200일선 위로 올라섰고 종가가 50일선 위인데 3개월 수익률은 아직 음수. 200일선 대비 순"
              rows={signals.crossUp}
              metric={(r) => `200일선 ${formatPct(vsSma(r.close, r.sma200), 1)}`}
              tone="neutral"
            />
          </div>
        </div>
      </section>

      {/* 전체 표 */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-sm font-semibold text-gray-300 hover:text-white flex items-center gap-2"
          >
            <span className="text-gray-500">{showAll ? "▾" : "▸"}</span>
            전체 목록 ({scoped.length}) — 기간별 수익률 · 추세 · 변동성 · 낙폭 · 총보수 · 배당
          </button>
          {showAll && (
            <label className="text-xs text-gray-400 flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={groupByCategory}
                onChange={(e) => setGroupByCategory(e.target.checked)}
                className="accent-amber-500"
              />
              분류별 묶기
            </label>
          )}
        </div>
        {showAll && (
          <FullTable
            rows={scoped}
            period={period}
            mode={mode}
            onPeriod={setPeriod}
            grouped={groupByCategory}
          />
        )}
      </section>
    </div>
  );
}

function RankDelta({
  ticker,
  currentRank,
  previousRank,
}: {
  ticker: string;
  currentRank: Map<string, number>;
  previousRank: Map<string, number> | null;
}) {
  if (!previousRank) return null;
  const now = currentRank.get(ticker);
  const prev = previousRank.get(ticker);
  if (now === undefined) return null;
  if (prev === undefined) {
    return (
      <span className="text-[10px] text-amber-300" title={`${RANK_COMPARE_DAYS}일 전 집계 없음`}>
        NEW
      </span>
    );
  }
  const d = prev - now;
  if (d === 0) {
    return <span className="text-[10px] text-gray-600" title={`${RANK_COMPARE_DAYS}일 전 ${prev}위`}>–</span>;
  }
  return (
    <span
      className={`text-[10px] tabular-nums ${d > 0 ? "text-green-400" : "text-red-400"}`}
      title={`${RANK_COMPARE_DAYS}일 전 ${prev}위 → 현재 ${now}위`}
    >
      {d > 0 ? `▲${d}` : `▼${-d}`}
    </span>
  );
}

function RankList({
  title,
  rows,
  period,
  mode,
  tone,
  currentRank,
  previousRank,
}: {
  title: string;
  rows: EtfTrendRow[];
  period: EtfPeriodKey;
  mode: RankMode;
  tone: "up" | "down";
  currentRank: Map<string, number>;
  previousRank: Map<string, number> | null;
}) {
  const maxAbs = Math.max(
    1e-9,
    ...rows.map((r) => Math.abs(rankValue(r, period, mode) ?? 0))
  );
  const bar = tone === "up" ? "bg-green-500/25" : "bg-red-500/25";
  const head = tone === "up" ? "text-green-300" : "text-red-300";

  return (
    <div className="bg-gray-900 border border-gray-800 rounded">
      <div className={`px-3 py-2 border-b border-gray-800 text-sm font-semibold ${head}`}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div className="p-4 text-xs text-gray-500">해당 없음</div>
      ) : (
        <ol className="divide-y divide-gray-800/80">
          {rows.map((r, i) => {
            const v = rankValue(r, period, mode) as number;
            const w = Math.min(100, (Math.abs(v) / maxAbs) * 100);
            const t = trendOf(r);
            return (
              <li key={r.ticker} className="relative">
                <div
                  className={`absolute inset-y-0 left-0 ${bar}`}
                  style={{ width: `${w}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-1 pr-1">
                <Link
                  href={`/stocks/${encodeURIComponent(r.ticker)}`}
                  className="flex-1 min-w-0 flex items-center gap-2 pl-3 pr-1 py-2 rounded hover:bg-white/5 transition"
                  title={`${r.ticker} 월별 패턴 보기${r.description ? ` · ${r.description}` : ""}`}
                >
                  <div className="w-9 shrink-0 flex flex-col items-end leading-tight">
                    <span className="text-[11px] text-gray-500 tabular-nums">{i + 1}</span>
                    <RankDelta ticker={r.ticker} currentRank={currentRank} previousRank={previousRank} />
                  </div>
                  <span className="font-mono text-xs text-gray-300 w-14 shrink-0">{r.ticker}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate flex items-center gap-1.5">
                      <span className="truncate">{displayLabel(r)}</span>
                      {t && (
                        <span
                          className={`text-[9px] px-1 rounded border shrink-0 ${trendClass(t)}`}
                          title="50/200일 이동평균 기준 추세"
                        >
                          {t}
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {r.category ? `${r.category} · ` : ""}
                      {r.name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    {mode === "riskAdj" ? (
                      <>
                        <div className={`text-sm font-semibold tabular-nums ${pctColor(v)}`}>
                          {formatNum(v, 2)}
                        </div>
                        <div className="text-[10px] text-gray-500 tabular-nums">
                          <span className={pctColor(r.returns[period])}>{formatPct(r.returns[period], 1)}</span>
                          {" · σ "}
                          {formatNum(r.vol[period], 0)}%
                        </div>
                      </>
                    ) : (
                      <>
                        <div className={`text-sm font-semibold tabular-nums ${pctColor(v)}`}>
                          {formatPct(v)}
                        </div>
                        <div className="text-[10px] text-gray-500 tabular-nums">
                          {formatPrice(r.close)}{" "}
                          <span className={pctColor(r.dayChangePct)}>{formatPct(r.dayChangePct)}</span>
                        </div>
                      </>
                    )}
                  </div>
                </Link>
                  <FavoriteButton ticker={r.ticker} />
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

function MacroTile({ m }: { m: MacroItem }) {
  const fmtChg = (v: number | null) => {
    if (v === null) return "—";
    const sign = v > 0 ? "+" : "";
    return m.kind === "pct" ? `${sign}${v.toFixed(1)}%` : `${sign}${v.toFixed(2)}%p`;
  };
  // VIX·금리·달러·환율은 오르면 위험자산에 부담 → 색을 반대로
  const inverse = m.key === "VIX" || m.key === "US10Y" || m.key === "DXY" || m.key === "USDKRW";
  const color = (v: number | null) => {
    if (v === null) return "text-gray-500";
    const up = inverse ? v < 0 : v > 0;
    return v === 0 ? "text-gray-300" : up ? "text-green-400" : "text-red-400";
  };
  return (
    <div
      className="bg-gray-900 border border-gray-800 rounded px-2.5 py-2"
      title={`${m.hint ? m.hint + " · " : ""}${m.date} 기준`}
    >
      <div className="text-[10px] text-gray-500 leading-tight">{m.label}</div>
      <div className="text-base font-bold text-white tabular-nums leading-tight mt-0.5">
        {m.unit === "$" ? "$" : ""}
        {m.value.toFixed(m.digits)}
        {m.unit && m.unit !== "$" ? m.unit : ""}
      </div>
      <div className="text-[10px] tabular-nums mt-0.5 flex gap-2">
        <span className={color(m.chg1w)} title="1주 전 대비">1W {fmtChg(m.chg1w)}</span>
        <span className={color(m.chg1m)} title="1개월 전 대비">1M {fmtChg(m.chg1m)}</span>
      </div>
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  tone,
  hint,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "up" | "down";
  hint?: string;
}) {
  const color = tone === "up" ? "text-green-400" : tone === "down" ? "text-red-400" : "text-white";
  return (
    <div className="bg-gray-900 border border-gray-800 rounded px-2.5 py-2" title={hint}>
      <div className="text-[10px] text-gray-500 leading-tight">{label}</div>
      <div className={`text-base font-bold tabular-nums leading-tight mt-0.5 ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-500 tabular-nums mt-0.5">{sub}</div>}
    </div>
  );
}

function SignalList({
  title,
  hint,
  rows,
  metric,
  tone,
  highlight,
  highlightLabel,
}: {
  title: string;
  hint: string;
  rows: EtfTrendRow[];
  metric: (r: EtfTrendRow) => string;
  tone: "up" | "down" | "neutral";
  /** 주어지면 조건을 만족하는 행만 밝게, 나머지는 흐리게 표시하고 머리글에 개수를 보여준다. */
  highlight?: (r: EtfTrendRow) => boolean;
  highlightLabel?: string;
}) {
  const head =
    tone === "up" ? "text-green-300" : tone === "down" ? "text-red-300" : "text-amber-200";
  const hits = highlight ? rows.filter(highlight).length : rows.length;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded">
      <div
        className={`px-3 py-1.5 border-b border-gray-800 text-xs font-semibold flex items-center justify-between ${head}`}
        title={hint}
      >
        <span>{title}</span>
        <span className="text-[10px] text-gray-500 font-normal">
          {highlight ? `${highlightLabel ?? "해당"} ${hits}` : rows.length}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-gray-600">해당 없음</div>
      ) : (
        <ul className="divide-y divide-gray-800/80">
          {rows.map((r) => {
            const on = highlight ? highlight(r) : true;
            return (
              <li
                key={r.ticker}
                className={`px-3 py-1 flex items-center gap-2 text-xs ${on ? "" : "opacity-55"}`}
              >
                <Link
                  href={`/stocks/${encodeURIComponent(r.ticker)}`}
                  className="flex-1 min-w-0 flex items-center gap-2 hover:text-white"
                  title={`${r.name} · 월별 패턴 보기`}
                >
                  <span className="font-mono text-gray-300 w-12 shrink-0">{r.ticker}</span>
                  <span className="text-gray-200 truncate flex-1 min-w-0">{displayLabel(r)}</span>
                </Link>
                <span className="text-[11px] text-gray-400 tabular-nums shrink-0">{metric(r)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const GUIDE: { term: string; desc: string }[] = [
  { term: "기간 수익률", desc: "기준일에서 N일 전(달력일) 종가 대비 최신 종가의 변화. 배당은 반영하지 않은 가격 수익률. 시트의 7/30/90/365일 수익률과 같은 방식." },
  { term: "기준: 수익률 / 위험조정", desc: "위험조정 = 수익률 ÷ 기간 변동성(일간 수익률 표준편차 × √거래일수). 같은 수익이면 덜 흔들린 ETF가 위. 2 이상이면 꾸준한 상승, 0~1은 올랐지만 많이 출렁임, 음수는 하락. 1주는 거래일이 5일뿐이라 들쭉날쭉하니 1개월 이상에서 보기." },
  { term: "σ (변동성)", desc: "선택 기간의 일간 수익률 표준편차를 연율화(×√252)한 %. 20% 안팎이 보통, 40% 이상이면 변동이 큰 ETF." },
  { term: "▲▼ 순위 변동", desc: "7일 전 종가로 같은 기간 수익률을 계산해 매긴 순위와 비교. ▲3 = 세 계단 올라옴, NEW = 그때는 집계에 없던 종목. 위험조정 기준에서는 표시하지 않음." },
  { term: "추세 배지", desc: "상승 = 종가가 200일 이동평균 위이고 50일선도 200일선 위(골든크로스 상태). 하락 = 둘 다 반대(데드크로스). 혼조 = 전환 구간." },
  { term: "50일선比 / 200일선比", desc: "종가가 이동평균보다 얼마나 위(+)/아래(−)에 있는지 %. 200일선 위면 중기 추세가 살아 있다고 보는 게 일반적." },
  { term: "1Y MDD", desc: "최근 1년 동안 고점에서 가장 많이 빠졌던 낙폭 %. −30%면 1년 중 어느 시점에 고점 대비 30% 하락이 있었다는 뜻." },
  { term: "52주 고가 / 저가, 고점比 / 저점比", desc: "최근 365일 최고·최저 종가와 현재가의 거리. 고점比 −1%는 신고가 턱밑, 저점比 +3%는 신저가 근처." },
  { term: "3년 위치", desc: "최근 3년 최저~최고 종가 범위에서 현재가가 어디쯤인지 0~100%. 시트의 '3년간 현재가 백분위'와 같은 뜻." },
  { term: "시장 환경 타일", desc: "VIX·미 10년물·달러인덱스·WTI·원달러의 현재값과 1주·1개월 변동. VIX·금리·달러·환율은 오르면 위험자산에 부담이라 상승을 빨강으로 칠함." },
  { term: "200일선 위 / 상승추세 비율", desc: "집계 대상 ETF 중 200일선(50일선) 위에 있는 비율과 추세 배지가 '상승'인 비율. 50% 아래면 넓게 약한 장세." },
  { term: "분류별 평균 수익률", desc: "시장대표·섹터·테마·국가·원자재·리츠 각각의 동일가중 평균. 어느 분류로 돈이 도는지 볼 때. 분류를 누르면 그 분류만 필터." },
  { term: "시그널", desc: "신고가·신저가 근접은 가까운 순 8개(2% 이내는 밝게). 저점 반등 = 1년 낙폭 20% 이상이었는데 1개월 플러스 전환 + 50일선 회복. 추세 전환 초기 = 50일선이 200일선을 넘었지만 3개월 수익률은 아직 음수." },
  { term: "제외 N", desc: "최신 데이터가 기준일보다 7일 이상 오래됐거나(상장폐지·수집 실패) 해당 기간 데이터가 부족한 종목. 랭킹에서 빼고 전체 표에서는 흐리게 표시." },
];

function GuidePanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="bg-gray-900 border border-sky-900/60 rounded p-3 text-xs">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-sky-200">읽는 법</h3>
        <button type="button" onClick={onClose} className="text-gray-500 hover:text-white" aria-label="닫기">
          ✕
        </button>
      </div>
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
        {GUIDE.map((g) => (
          <div key={g.term} className="grid grid-cols-[9rem,1fr] gap-2">
            <dt className="text-gray-200 font-semibold">{g.term}</dt>
            <dd className="text-gray-400 leading-relaxed">{g.desc}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] text-gray-500">
        모든 값은 과거 종가로 계산한 참고 수치이며 투자 권유가 아닙니다. 표의 열 머리글에 마우스를 올리면 짧은 설명이 뜹니다.
      </p>
    </div>
  );
}

function FullTable({
  rows,
  period,
  mode,
  onPeriod,
  grouped,
}: {
  rows: EtfTrendRow[];
  period: EtfPeriodKey;
  mode: RankMode;
  onPeriod: (p: EtfPeriodKey) => void;
  grouped: boolean;
}) {
  const sections = useMemo(() => {
    const sortByPeriod = (list: EtfTrendRow[]) => {
      const withVal = list.filter((r) => !r.stale && rankValue(r, period, mode) !== null);
      const without = list.filter((r) => r.stale || rankValue(r, period, mode) === null);
      withVal.sort(
        (a, b) => (rankValue(b, period, mode) as number) - (rankValue(a, period, mode) as number)
      );
      return [...withVal, ...without];
    };
    if (!grouped) return [{ title: null as string | null, rows: sortByPeriod(rows) }];
    const byCat = new Map<string, EtfTrendRow[]>();
    for (const r of rows) {
      const c = categoryOf(r);
      byCat.set(c, [...(byCat.get(c) ?? []), r]);
    }
    return sortCategories(byCat.keys()).map((c) => ({
      title: c,
      rows: sortByPeriod(byCat.get(c) ?? []),
    }));
  }, [rows, period, mode, grouped]);

  const colCount = 6 + ETF_PERIODS.length + 13;

  return (
    <div className="mt-3 overflow-x-auto border border-gray-800 rounded">
      <table className="w-full text-xs whitespace-nowrap">
        <thead className="bg-gray-900 text-gray-400">
          <tr>
            <th className="px-2 py-2 text-left w-8">★</th>
            <th className="px-2 py-2 text-left">티커</th>
            <th className="px-2 py-2 text-left">ETF</th>
            <th className="px-2 py-2 text-left">분류</th>
            <th className="px-2 py-2 text-right">종가</th>
            <th className="px-2 py-2 text-right">전일</th>
            {ETF_PERIODS.map((p) => (
              <th
                key={p.key}
                className={`px-2 py-2 text-right cursor-pointer hover:text-white ${
                  p.key === period ? "text-amber-300" : ""
                }`}
                onClick={() => onPeriod(p.key)}
                title="이 기간으로 정렬"
              >
                {p.label}
                {p.key === period ? " ▾" : ""}
              </th>
            ))}
            <th className="px-2 py-2 text-left" title="50/200일 이동평균 기준">추세</th>
            <th className="px-2 py-2 text-right" title="종가 ÷ 50일 이동평균 − 1">50일선比</th>
            <th className="px-2 py-2 text-right" title="종가 ÷ 200일 이동평균 − 1">200일선比</th>
            <th className="px-2 py-2 text-right" title={`${periodLabel(period)} 구간 일간 수익률 표준편차 × √252`}>
              σ {periodLabel(period)}
            </th>
            <th className="px-2 py-2 text-right" title={`${periodLabel(period)} 수익률 ÷ 기간 변동성`}>
              위험조정
            </th>
            <th className="px-2 py-2 text-right" title="최근 365일 고점 대비 최대 낙폭">1Y MDD</th>
            <th className="px-2 py-2 text-right" title="최근 365일 최고 종가">52주 고가</th>
            <th className="px-2 py-2 text-right" title="종가 ÷ 52주 고가 − 1">고점比</th>
            <th className="px-2 py-2 text-right" title="최근 365일 최저 종가">52주 저가</th>
            <th className="px-2 py-2 text-right" title="종가 ÷ 52주 저가 − 1">저점比</th>
            <th className="px-2 py-2 text-left" title="최근 3년 최저~최고 종가 범위 내 현재 위치">3년 위치</th>
            <th className="px-2 py-2 text-right">총보수</th>
            <th className="px-2 py-2 text-left">배당</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800/80">
          {sections.map((s) => (
            <SectionRows
              key={s.title ?? "__all"}
              title={s.title}
              rows={s.rows}
              period={period}
              colCount={colCount}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SectionRows({
  title,
  rows,
  period,
  colCount,
}: {
  title: string | null;
  rows: EtfTrendRow[];
  period: EtfPeriodKey;
  colCount: number;
}) {
  return (
    <>
      {title && (
        <tr className="bg-gray-900/80">
          <td colSpan={colCount} className="px-2 py-1.5 text-[11px] font-semibold text-amber-200">
            {title} <span className="text-gray-500 font-normal">({rows.length})</span>
          </td>
        </tr>
      )}
      {rows.map((r) => {
        const pos = position3y(r);
        const fromHigh = fromHigh1y(r);
        const fromLow = fromLow1y(r);
        const t = trendOf(r);
        return (
          <tr key={r.ticker} className={`hover:bg-gray-900/60 ${r.stale ? "opacity-50" : ""}`}>
            <td className="px-1 py-1">
              <FavoriteButton ticker={r.ticker} />
            </td>
            <td className="px-2 py-1 font-mono text-gray-300">
              <Link href={`/stocks/${encodeURIComponent(r.ticker)}`} className="hover:text-white">
                {r.ticker}
              </Link>
            </td>
            <td className="px-2 py-1 min-w-[10rem]" title={r.description ?? undefined}>
              <Link
                href={`/stocks/${encodeURIComponent(r.ticker)}`}
                className="block hover:underline decoration-gray-600"
                title={`${r.ticker} 월별 패턴 보기`}
              >
                <div className="text-white">
                  {displayLabel(r)}
                  {r.description && <span className="ml-1 text-gray-500" aria-hidden>ⓘ</span>}
                </div>
                <div className="text-[10px] text-gray-500 truncate max-w-[16rem]">
                  {r.name}
                  {r.stale && r.asOf ? ` · ${r.asOf} 까지` : ""}
                </div>
              </Link>
            </td>
            <td className="px-2 py-1 text-gray-400">{r.category ?? "—"}</td>
            <td className="px-2 py-1 text-right text-gray-300 tabular-nums">
              {formatPrice(r.close)}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(r.dayChangePct)}`}>
              {formatPct(r.dayChangePct)}
            </td>
            {ETF_PERIODS.map((p) => (
              <td
                key={p.key}
                className={`px-2 py-1 text-right tabular-nums ${pctColor(r.returns[p.key])} ${
                  p.key === period ? "font-semibold bg-amber-500/5" : ""
                }`}
              >
                {formatPct(r.returns[p.key], 1)}
              </td>
            ))}
            <td className="px-2 py-1">
              {t ? (
                <span className={`text-[10px] px-1 rounded border ${trendClass(t)}`}>{t}</span>
              ) : (
                <span className="text-gray-600">—</span>
              )}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(vsSma(r.close, r.sma50))}`}>
              {formatPct(vsSma(r.close, r.sma50), 1)}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(vsSma(r.close, r.sma200))}`}>
              {formatPct(vsSma(r.close, r.sma200), 1)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-gray-300">
              {r.vol[period] === null ? "—" : `${formatNum(r.vol[period], 0)}%`}
            </td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(r.riskAdj[period])}`}>
              {formatNum(r.riskAdj[period], 2)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-red-300/90">
              {formatPct(r.mdd1y, 1)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-gray-300">{formatPrice(r.high1y)}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(fromHigh)}`}>
              {formatPct(fromHigh, 1)}
            </td>
            <td className="px-2 py-1 text-right tabular-nums text-gray-300">{formatPrice(r.low1y)}</td>
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(fromLow)}`}>
              {formatPct(fromLow, 1)}
            </td>
            <td className="px-2 py-1">
              {pos === null ? (
                <span className="text-gray-600">—</span>
              ) : (
                <div
                  className="flex items-center gap-1.5"
                  title={`3년 저점 ${formatPrice(r.low3y)} ~ 고점 ${formatPrice(r.high3y)}`}
                >
                  <div className="relative h-1.5 w-16 rounded bg-gray-800">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-amber-500/60"
                      style={{ width: `${pos * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400 tabular-nums">
                    {(pos * 100).toFixed(0)}%
                  </span>
                </div>
              )}
            </td>
            <td className="px-2 py-1 text-right text-gray-400 tabular-nums">
              {formatRatio(r.expenseRatio)}
            </td>
            <td className="px-2 py-1 text-gray-400">{r.dividendFreq ?? "—"}</td>
          </tr>
        );
      })}
    </>
  );
}

function Chip({
  label,
  active,
  onClick,
  tone = "gray",
  title,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "gray" | "amber" | "yellow";
  title?: string;
}) {
  const activeCls =
    tone === "amber"
      ? "bg-amber-500/20 border-amber-500/60 text-amber-200"
      : tone === "yellow"
      ? "bg-yellow-500/15 border-yellow-500/60 text-yellow-200"
      : "bg-gray-700 border-gray-600 text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`px-2.5 py-1 rounded border transition ${
        active
          ? activeCls
          : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
