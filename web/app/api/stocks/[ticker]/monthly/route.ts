import { NextResponse } from "next/server";
import { getTicker, monthlyReturns, monthlyStats } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const meta = await getTicker(ticker);
  if (!meta) {
    return NextResponse.json(
      { error: `Ticker ${ticker} not found` },
      { status: 404 }
    );
  }
  const [stats, returns] = await Promise.all([
    monthlyStats(ticker),
    monthlyReturns(ticker),
  ]);
  return NextResponse.json({ meta, stats, returns });
}
