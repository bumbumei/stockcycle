import { NextResponse } from "next/server";
import { etfTrend } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * GET /api/etf/trend
 * 미국 ETF 유니버스의 기간별 수익률 (1W/1M/2M/3M/6M/1Y) — /etf 페이지와 동일 데이터.
 */
export async function GET() {
  const data = await etfTrend();
  return NextResponse.json(data, { status: data.error ? 500 : 200 });
}
