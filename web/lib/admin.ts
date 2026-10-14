/**
 * 관리자 키 검증 (서버 전용).
 *
 * 환경변수 ADMIN_SECRET 을 쓰고, 없으면 ISR 무효화에 쓰는 REVALIDATE_SECRET 을 대신 쓴다
 * (Vercel 에 이미 등록돼 있다면 추가 설정 없이 동작). 둘 다 없으면 쓰기 API 는 500 으로 거부.
 *
 * 클라이언트는 `Authorization: Bearer <키>` 헤더로 보낸다 (lib/adminKey.ts).
 */
import { NextResponse } from "next/server";

export function adminSecret(): string | undefined {
  const s = process.env.ADMIN_SECRET || process.env.REVALIDATE_SECRET;
  return s && s.length > 0 ? s : undefined;
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export type AdminCheck =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function checkAdmin(req: Request): AdminCheck {
  const expected = adminSecret();
  if (!expected) {
    return {
      ok: false,
      status: 500,
      error: "서버에 ADMIN_SECRET(또는 REVALIDATE_SECRET) 환경변수가 설정되지 않았습니다.",
    };
  }
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || !safeEqual(provided, expected)) {
    return { ok: false, status: 401, error: "관리자 키가 올바르지 않습니다." };
  }
  return { ok: true };
}

export function adminError(check: Exclude<AdminCheck, { ok: true }>) {
  return NextResponse.json({ error: check.error }, { status: check.status });
}
