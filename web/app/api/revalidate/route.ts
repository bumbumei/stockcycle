import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * ISR 캐시 무효화 엔드포인트.
 *
 * GitHub Actions(process_pending.py, incremental.py)가 데이터 갱신 후
 * 이 엔드포인트를 호출하면 홈 페이지가 즉시 재생성된다.
 *
 * 인증: 환경변수 REVALIDATE_SECRET 과 일치하는 토큰 필수.
 *  - 헤더: `Authorization: Bearer <secret>` 또는
 *  - 쿼리: `?secret=<secret>`
 *
 * body (optional): {"paths": ["/", "/stocks/..."]} — 기본값은 "/".
 */
export async function POST(req: Request) {
  const expected = process.env.REVALIDATE_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "서버 REVALIDATE_SECRET 미설정" },
      { status: 500 }
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const url = new URL(req.url);
  const qsSecret = url.searchParams.get("secret") ?? "";
  const provided = bearer || qsSecret;

  // timing-safe compare
  if (!provided || !safeEqual(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let paths: string[] = ["/"];
  try {
    const body = await req.json();
    if (Array.isArray(body?.paths) && body.paths.every((p: unknown) => typeof p === "string")) {
      paths = body.paths.length > 0 ? body.paths : paths;
    }
  } catch {
    // 본문 없어도 괜찮음 — 기본 경로 사용
  }

  for (const p of paths) {
    revalidatePath(p);
  }

  return NextResponse.json({
    ok: true,
    revalidated: paths,
    at: new Date().toISOString(),
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
