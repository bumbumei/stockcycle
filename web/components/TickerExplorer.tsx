"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TickerWithMetrics } from "@/lib/db";
import { useFavorites } from "@/lib/favorites";
import FavoriteButton from "./FavoriteButton";

type Props = {
  tickers: TickerWithMetrics[];
};

const MARKET_LABEL: Record<string, string> = {
  KOSPI: "코스피",
  KOSDAQ: "코스닥",
  ETF: "ETF",
  NASDAQ: "나스닥",
  NYSE: "NYSE",
  US_OTHER: "미국",
};

function marketOrder(m: string): number {
  const order: Record<string, number> = {
    KOSPI: 0, KOSDAQ: 1, ETF: 2, NASDAQ: 3, NYSE: 4, US_OTHER: 5,
  };
  return order[m] ?? 99;
}

function formatPrice(v: number | null, market: string): string {
  if (v === null) return "—";
  // 한국 종목(코드가 숫자)은 원 단위, 그 외는 소수점 2자리
  if (/^\d{6}$/.test(market === "ETF" || market === "KOSPI" || market === "KOSDAQ" ? "000000" : "")) {
    return v.toLocaleString("ko-KR");
  }
  return v >= 100
    ? Math.round(v).toLocaleString("ko-KR")
    : v.toFixed(2);
}

function pctColor(v: number | null): string {
  if (v === null || v === undefined) return "text-gray-500";
  if (v > 0.3) return "text-green-400";
  if (v < -0.3) return "text-red-400";
  return "text-gray-300";
}

function formatPct(v: number | null, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  const sign = v >= 0 ? "+" : "";
  return `${sign}${v.toFixed(digits)}%`;
}

export default function TickerExplorer({ tickers }: Props) {
  const { favorites } = useFavorites();
  const [q, setQ] = useState("");
  const [market, setMarket] = useState<string>("all");

  const markets = useMemo(() => {
    const set = new Set(tickers.map((t) => t.market));
    return Array.from(set).sort((a, b) => marketOrder(a) - marketOrder(b));
  }, [tickers]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: tickers.length };
    for (const t of tickers) map[t.market] = (map[t.market] ?? 0) + 1;
    return map;
  }, [tickers]);

  const filtered = useMemo(() => {
    const qLow = q.trim().toLowerCase();
    return tickers.filter((t) => {
      if (market !== "all" && t.market !== market) return false;
      if (!qLow) return true;
      return (
        t.ticker.toLowerCase().includes(qLow) ||
        t.name.toLowerCase().includes(qLow)
      );
    });
  }, [tickers, q, market]);

  const favoriteTickers = useMemo(
    () => tickers.filter((t) => favorites.includes(t.ticker)),
    [tickers, favorites]
  );

  return (
    <div className="space-y-6">
      {/* 관심종목 */}
      {favoriteTickers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <span className="text-yellow-400">★</span>
            <span>관심 종목 ({favoriteTickers.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {favoriteTickers.map((t) => (
              <TickerCard key={t.ticker} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* 검색 + 필터 */}
      <section className="space-y-3">
        <div className="relative">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="종목명 또는 코드 검색 (예: 삼성전자, 005930, AAPL, KODEX)"
            className="w-full bg-gray-900 border border-gray-800 rounded px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-gray-600"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
              aria-label="검색어 지우기"
            >
              ✕
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-1.5 text-xs">
          <FilterChip
            label={`전체 ${counts.all}`}
            active={market === "all"}
            onClick={() => setMarket("all")}
          />
          {markets.map((m) => (
            <FilterChip
              key={m}
              label={`${MARKET_LABEL[m] ?? m} ${counts[m] ?? 0}`}
              active={market === m}
              onClick={() => setMarket(m)}
            />
          ))}
        </div>
      </section>

      {/* 리스트 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">
          {q || market !== "all"
            ? `검색 결과 (${filtered.length})`
            : `전체 종목 (${filtered.length})`}
        </h2>
        {filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded p-6 text-center text-gray-400 text-sm">
            일치하는 종목이 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {filtered.map((t) => (
              <TickerCard key={t.ticker} t={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TickerCard({ t }: { t: TickerWithMetrics }) {
  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded transition">
      <div className="flex items-start justify-between pr-1">
        <Link
          href={`/stocks/${encodeURIComponent(t.ticker)}`}
          className="flex-1 min-w-0 p-3"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-mono text-xs text-gray-400 shrink-0">
              {t.ticker}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-gray-500 shrink-0">
              {MARKET_LABEL[t.market] ?? t.market}
            </span>
          </div>
          <div className="text-white text-sm font-medium mt-0.5 truncate">
            {t.name}
          </div>

          {/* 현재가 + MTD */}
          <div className="mt-2 flex items-baseline justify-between gap-2">
            <div>
              <span className="text-[10px] text-gray-500">현재가</span>
              <div className="text-sm font-semibold text-gray-100 tabular-nums">
                {formatPrice(t.currentPrice, t.market)}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[10px] text-gray-500">이번달 실제</span>
              <div
                className={`text-sm font-semibold tabular-nums ${pctColor(
                  t.thisMonthActual
                )}`}
              >
                {formatPct(t.thisMonthActual, 2)}
              </div>
            </div>
          </div>

          {/* 이번달 예상 vs 다음달 예상 */}
          <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
            <Metric
              label="이번달 예상"
              value={t.thisMonthExpected}
              tooltip={`과거 ${getMonthLabel(t.asOf)} 평균`}
            />
            <Metric
              label="다음달 예상"
              value={t.nextMonthExpected}
              tooltip={`과거 ${getNextMonthLabel(t.asOf)} 평균`}
            />
          </div>
        </Link>
        <div className="pt-2">
          <FavoriteButton ticker={t.ticker} />
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tooltip,
}: {
  label: string;
  value: number | null;
  tooltip: string;
}) {
  return (
    <div
      className="bg-gray-950/50 border border-gray-800 rounded px-2 py-1"
      title={tooltip}
    >
      <div className="text-[10px] text-gray-500 leading-tight">{label}</div>
      <div className={`text-sm font-semibold tabular-nums ${pctColor(value)}`}>
        {formatPct(value, 2)}
      </div>
    </div>
  );
}

function getMonthLabel(asOf: string | null): string {
  if (!asOf) return "—";
  const m = parseInt(asOf.slice(5, 7), 10);
  return `${m}월`;
}

function getNextMonthLabel(asOf: string | null): string {
  if (!asOf) return "—";
  const m = parseInt(asOf.slice(5, 7), 10);
  return `${m === 12 ? 1 : m + 1}월`;
}

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded border transition ${
        active
          ? "bg-gray-700 border-gray-600 text-white"
          : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
      }`}
    >
      {label}
    </button>
  );
}
