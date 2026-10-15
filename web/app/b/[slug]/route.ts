import { BRAND_PARAM, normalizeBrandSlug } from "@/lib/brand";

export const dynamic = "force-dynamic";

/**
 * GET /b/<slug> — 짧은 공유 주소. /etf?brand=<slug> 로 보낸다.
 * Location 을 상대 경로로 주어 프록시 뒤(Vercel)나 로컬 어디서든 같은 호스트로 간다.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug: raw } = await ctx.params;
  const slug = normalizeBrandSlug(decodeURIComponent(raw));
  const to = slug ? `/etf?${BRAND_PARAM}=${encodeURIComponent(slug)}` : "/etf";
  return new Response(null, { status: 302, headers: { Location: to, "Cache-Control": "no-store" } });
}
