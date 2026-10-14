import { NextResponse } from "next/server";
import { pingDb, stockDetail } from "@/lib/queries";

export const dynamic = "force-dynamic";

// 서버 함수 인스턴스가 뜬 시각 — 요청 시점과의 차이가 작으면 콜드 스타트 직후.
const BOOTED_AT = Date.now();

/**
 * GET /api/stocks/[ticker]/monthly — 종목 메타 + 월별 통계 + 월별 수익률 (DB 왕복 1회).
 * `?debug=1` 을 붙이면 이 요청의 서버 처리 시간 분해(`timings`)를 함께 돌려준다:
 *   pingMs   DB 연결 수립 + 왕복 1회 (콜드 함수에서는 TLS 연결 비용 포함)
 *   detailMs 상세 쿼리 1회
 *   region / uptimeS  Vercel 리전, 함수 기동 후 경과 초 (5초 미만이면 콜드 스타트 직후)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const debug = new URL(req.url).searchParams.has("debug");

  let pingMs: number | null = null;
  if (debug) {
    const t = performance.now();
    await pingDb();
    pingMs = Math.round(performance.now() - t);
  }

  const t0 = performance.now();
  const detail = await stockDetail(ticker);
  const detailMs = Math.round(performance.now() - t0);
  if (!detail) {
    return NextResponse.json(
      { error: `Ticker ${ticker} not found` },
      { status: 404 }
    );
  }

  const timings = {
    pingMs,
    detailMs,
    region: process.env.VERCEL_REGION ?? "local",
    uptimeS: Math.round((Date.now() - BOOTED_AT) / 1000),
  };
  console.log(
    `[api/stocks/${ticker}] ping ${pingMs ?? "-"}ms, detail ${detailMs}ms (region ${timings.region}, uptime ${timings.uptimeS}s)`
  );

  return NextResponse.json(debug ? { ...detail, timings } : detail);
}
