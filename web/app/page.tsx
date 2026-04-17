import Link from "next/link";
import { listTickers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Home() {
  const tickers = await listTickers();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold mb-1">월별 주식 패턴 분석</h1>
        <p className="text-gray-400 text-sm">
          10년간의 일별 데이터를 월 단위로 집계하여, 각 월의 상승 확률과 평균 수익률을 시각화합니다.
        </p>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-300 mb-3">
          등록된 종목 ({tickers.length}개)
        </h2>
        {tickers.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded p-4 text-gray-400 text-sm">
            아직 등록된 종목이 없습니다.
            <br />
            <code className="text-xs bg-gray-800 px-2 py-1 rounded mt-2 inline-block">
              cd poc && python backfill.py --years 10 --tickers 005930
            </code>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {tickers.map((t) => (
              <Link
                key={t.ticker}
                href={`/stocks/${encodeURIComponent(t.ticker)}`}
                className="block bg-gray-900 border border-gray-800 hover:border-gray-600 rounded p-3 transition"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-sm text-gray-400">{t.ticker}</span>
                  <span className="text-[10px] uppercase tracking-wide text-gray-500">
                    {t.market}
                  </span>
                </div>
                <div className="text-white font-semibold mt-0.5">{t.name}</div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
