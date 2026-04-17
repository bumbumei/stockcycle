import AddTickerForm from "@/components/AddTickerForm";
import TickerExplorer from "@/components/TickerExplorer";
import { listTickersWithMetrics } from "@/lib/queries";

export const revalidate = 3600;

export default async function Home() {
  const tickers = await listTickersWithMetrics();

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-2xl font-bold mb-1">월별 주식 패턴 분석</h1>
        <p className="text-gray-400 text-sm">
          10년간의 일별 데이터를 월 단위로 집계하여, 각 월의 상승 확률과 평균 수익률을 시각화합니다.
          관심 종목은 ★ 버튼으로 등록하면 다음 방문 시 상단에 고정됩니다.
        </p>
      </section>

      <AddTickerForm />

      {tickers.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded p-4 text-gray-400 text-sm">
          아직 등록된 종목이 없습니다. 위 &ldquo;종목 추가&rdquo; 버튼으로 종목을 요청하거나,
          로컬에서 다음 명령을 실행하세요:
          <pre className="text-xs bg-gray-800 p-2 rounded mt-2 overflow-x-auto">
            python backfill.py --years 10 --tickers 005930
          </pre>
        </div>
      ) : (
        <TickerExplorer tickers={tickers} />
      )}
    </div>
  );
}
