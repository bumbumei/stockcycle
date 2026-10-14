import { NextResponse } from "next/server";
import { adminError, checkAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** POST /api/admin/verify — Authorization: Bearer <키> 가 맞는지 확인. */
export async function POST(req: Request) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  return NextResponse.json({ ok: true });
}
