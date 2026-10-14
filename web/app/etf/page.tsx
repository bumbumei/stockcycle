import Link from "next/link";
import EtfTrend from "@/components/EtfTrend";
import { etfTrend, macroSnapshot } from "@/lib/queries";

// 하루 두 번 수집(KST 07:30 미국 마감분) 직후 /api/revalidate 로 즉시 갱신되므로
// 평상시엔 1시간 캐시로 충분.
export const revalidate = 3600;

export default async function EtfPage() {
  const [data, macro] = await Promise.all([etfTrend(), macroSnapshot()]);

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="text-2xl font-bold">미국 ETF 트렌드</h1>
          <Link
            href="/etf/manage"
            className="text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-400 hover:text-white hover:border-gray-500 transition shrink-0"
            title="유니버스 ETF 추가·수정·숨김·삭제 (관리자 키 필요)"
          >
            목록 편집
          </Link>
        </div>
        <p className="text-gray-400 text-sm">
          관심 미국 ETF를 모아 1주·1개월·2개월·3개월·6개월·1년·2년·3년 기간별 수익률 Top 10 /
          Worst 10을 봅니다. 수익률은 기준일에서 N일 전(달력일) 종가 대비 최신 종가이며 배당은
          반영하지 않습니다. 순위 옆 ▲▼는 1주 전 순위와의 변동입니다. 아래 분석 섹션에서 시장
          환경(VIX·금리·달러·유가·환율), 이평선 위 비율, 분류별 평균 수익률, 신고가·신저가·반등
          시그널을 함께 보고, 전체 목록에서는 추세·변동성·위험조정 수익률·최대낙폭·총보수까지
          확인할 수 있습니다.
        </p>
      </section>

      {data.rows.length === 0 ? (
        <EmptyState error={data.error} />
      ) : (
        <EtfTrend data={data} macro={macro} />
      )}
    </div>
  );
}

function EmptyState({ error }: { error?: string }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded p-4 text-gray-400 text-sm space-y-3">
      <p>
        아직 미국 ETF 유니버스가 등록되지 않았습니다. GitHub Actions의{" "}
        <code className="text-gray-200">Daily Data Ingest</code> 워크플로우를{" "}
        <code className="text-gray-200">seed-etf-us</code> 모드로 수동 실행하면{" "}
        <code className="text-gray-200">poc/tickers_etf_us.tsv</code>의 ETF 100개가 수집됩니다.
        로컬에서는:
      </p>
      <pre className="text-xs bg-gray-800 p-2 rounded overflow-x-auto">
        cd poc && python seed_etf_us.py --years 10
      </pre>
      <p>
        개별 ETF는 홈의 &ldquo;종목 추가&rdquo;에서 시장을 <strong>ETF (미국)</strong>으로 선택해
        등록할 수 있습니다.
      </p>
      {error && (
        <p className="text-[11px] text-red-300/80 break-words">
          조회 오류: {error}
        </p>
      )}
    </div>
  );
}
