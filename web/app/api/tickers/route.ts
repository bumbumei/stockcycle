import { NextResponse } from "next/server";
import { listTickers, searchTickers } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q");
  const rows = q ? await searchTickers(q) : await listTickers();
  return NextResponse.json({ tickers: rows });
}
