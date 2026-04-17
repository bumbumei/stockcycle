import { NextResponse } from "next/server";
import { listPending } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const pending = await listPending();
  return NextResponse.json({ pending });
}
