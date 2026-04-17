"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { TickerRow } from "@/lib/db";
import { useFavorites } from "@/lib/favorites";
import FavoriteButton from "./FavoriteButton";

type Props = {
  tickers: TickerRow[];
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
      {/* 관심종목 섹션 */}
      {favoriteTickers.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
            <span className="text-yellow-400">★</span>
            <span>관심 종목 ({favoriteTickers.length})</span>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {favoriteTickers.map((t) => (
              <TickerRowCard key={t.ticker} t={t} />
            ))}
          </div>
        </section>
      )}

      {/* 검색 + 필터 바 */}
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

      {/* 결과 리스트 */}
      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-2">
          {q || market !== "all" ? `검색 결과 (${filtered.length})` : `전체 종목 (${filtered.length})`}
        </h2>
        {filtered.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded p-6 text-center text-gray-400 text-sm">
            일치하는 종목이 없습니다.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {filtered.map((t) => (
              <TickerRowCard key={t.ticker} t={t} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function TickerRowCard({ t }: { t: TickerRow }) {
  return (
    <div className="bg-gray-900 border border-gray-800 hover:border-gray-600 rounded transition flex items-center">
      <Link
        href={`/stocks/${encodeURIComponent(t.ticker)}`}
        className="flex-1 min-w-0 p-3"
      >
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-mono text-xs text-gray-400 shrink-0">{t.ticker}</span>
          <span className="text-[10px] uppercase tracking-wide text-gray-500">
            {MARKET_LABEL[t.market] ?? t.market}
          </span>
        </div>
        <div className="text-white text-sm font-medium mt-0.5 truncate">{t.name}</div>
      </Link>
      <div className="pr-2">
        <FavoriteButton ticker={t.ticker} />
      </div>
    </div>
  );
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
