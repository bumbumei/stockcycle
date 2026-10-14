"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildShareText,
  displayLabel,
  ETF_CATEGORY_ORDER,
  ETF_PERIODS,
  EtfPeriodKey,
  EtfTrendData,
  EtfTrendRow,
  fromHigh1y,
  isoWeek,
  periodLabel,
  position3y,
  rankRows,
  topAndWorst,
} from "@/lib/etf";
import { useFavorites } from "@/lib/favorites";
import FavoriteButton from "./FavoriteButton";

type Props = { data: EtfTrendData };

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

export default function EtfTrend({ data }: Props) {
  const { favorites } = useFavorites();
  const [period, setPeriod] = useState<EtfPeriodKey>("1M");
  const [category, setCategory] = useState<string>("all");
  const [onlyFav, setOnlyFav] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [groupByCategory, setGroupByCategory] = useState(false);
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

  const { top, worst } = useMemo(() => topAndWorst(scoped, period, 10), [scoped, period]);
  const ranked = useMemo(() => rankRows(scoped, period), [scoped, period]);
  const excluded = useMemo(
    () => scoped.filter((r) => r.stale || r.returns[period] === null),
    [scoped, period]
  );

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
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => copy("current")}
              disabled={ranked.length === 0}
              className="px-3 py-1.5 rounded border border-gray-700 bg-gray-900 hover:border-gray-500 hover:text-white transition disabled:opacity-40"
              title={`${periodLabel(period)} Top/Worst 10 텍스트 복사`}
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
            title={`${periodLabel(period)} TOP ${top.length}`}
            rows={top}
            period={period}
            tone="up"
          />
          <RankList
            title={`${periodLabel(period)} Worst ${worst.length}`}
            rows={worst}
            period={period}
            tone="down"
          />
        </section>
      )}

      {/* 전체 표 */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-sm font-semibold text-gray-300 hover:text-white flex items-center gap-2"
          >
            <span className="text-gray-500">{showAll ? "▾" : "▸"}</span>
            전체 목록 ({scoped.length}) — 기간별 수익률 · 52주/3년 위치 · 총보수 · 배당
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
            onPeriod={setPeriod}
            grouped={groupByCategory}
          />
        )}
      </section>
    </div>
  );
}

function RankList({
  title,
  rows,
  period,
  tone,
}: {
  title: string;
  rows: EtfTrendRow[];
  period: EtfPeriodKey;
  tone: "up" | "down";
}) {
  const maxAbs = Math.max(1e-9, ...rows.map((r) => Math.abs(r.returns[period] ?? 0)));
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
            const v = r.returns[period] as number;
            const w = Math.min(100, (Math.abs(v) / maxAbs) * 100);
            return (
              <li key={r.ticker} className="relative">
                <div
                  className={`absolute inset-y-0 left-0 ${bar}`}
                  style={{ width: `${w}%` }}
                  aria-hidden
                />
                <div className="relative flex items-center gap-2 px-3 py-2">
                  <span className="w-5 text-right text-[11px] text-gray-500 tabular-nums shrink-0">
                    {i + 1}
                  </span>
                  <Link
                    href={`/stocks/${encodeURIComponent(r.ticker)}`}
                    className="font-mono text-xs text-gray-300 hover:text-white w-14 shrink-0"
                    title="월별 패턴 보기"
                  >
                    {r.ticker}
                  </Link>
                  <div className="min-w-0 flex-1" title={r.description ?? undefined}>
                    <div className="text-sm text-white truncate">{displayLabel(r)}</div>
                    <div className="text-[10px] text-gray-500 truncate">
                      {r.category ? `${r.category} · ` : ""}
                      {r.name}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-semibold tabular-nums ${pctColor(v)}`}>
                      {formatPct(v)}
                    </div>
                    <div className="text-[10px] text-gray-500 tabular-nums">
                      {formatPrice(r.close)}{" "}
                      <span className={pctColor(r.dayChangePct)}>
                        {formatPct(r.dayChangePct)}
                      </span>
                    </div>
                  </div>
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

function FullTable({
  rows,
  period,
  onPeriod,
  grouped,
}: {
  rows: EtfTrendRow[];
  period: EtfPeriodKey;
  onPeriod: (p: EtfPeriodKey) => void;
  grouped: boolean;
}) {
  const sortByPeriod = (list: EtfTrendRow[]) => {
    const withVal = list.filter((r) => !r.stale && r.returns[period] !== null);
    const without = list.filter((r) => r.stale || r.returns[period] === null);
    withVal.sort((a, b) => (b.returns[period] as number) - (a.returns[period] as number));
    return [...withVal, ...without];
  };

  const sections = useMemo(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, period, grouped]);

  const colCount = 7 + ETF_PERIODS.length + 4;

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
            <th className="px-2 py-2 text-right" title="최근 365일 최고 종가 대비">
              52주고점比
            </th>
            <th className="px-2 py-2 text-left" title="최근 3년 최저~최고 종가 범위 내 현재 위치">
              3년 위치
            </th>
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
              <div className="text-white">
                {displayLabel(r)}
                {r.description && <span className="ml-1 text-gray-500" aria-hidden>ⓘ</span>}
              </div>
              <div className="text-[10px] text-gray-500 truncate max-w-[16rem]">
                {r.name}
                {r.stale && r.asOf ? ` · ${r.asOf} 까지` : ""}
              </div>
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
            <td className={`px-2 py-1 text-right tabular-nums ${pctColor(fromHigh)}`}>
              {formatPct(fromHigh, 1)}
            </td>
            <td className="px-2 py-1">
              {pos === null ? (
                <span className="text-gray-600">—</span>
              ) : (
                <div className="flex items-center gap-1.5" title={`3년 저점 ${formatPrice(r.low3y)} ~ 고점 ${formatPrice(r.high3y)}`}>
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
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "gray" | "amber" | "yellow";
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
