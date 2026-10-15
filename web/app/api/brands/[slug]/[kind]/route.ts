import { NextResponse } from "next/server";
import { BRAND_IMAGE_KINDS, BrandImageKind, normalizeBrandSlug } from "@/lib/brand";
import { getBrandImage } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; kind: string }> };

/**
 * GET /api/brands/[slug]/logo | photo — 이미지 본문. 공개.
 * URL 에 ?v=<updated_at> 이 붙어 오므로 길게 캐시해도 수정이 바로 보인다.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug: rawSlug, kind: rawKind } = await ctx.params;
  const slug = normalizeBrandSlug(decodeURIComponent(rawSlug));
  const kind = rawKind as BrandImageKind;
  if (!slug || !(BRAND_IMAGE_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }
  try {
    const img = await getBrandImage(slug, kind);
    if (!img) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const bytes = Buffer.from(img.base64, "base64");
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": img.type,
        "Content-Length": String(bytes.length),
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        // SVG 를 주소창에 직접 열어도 스크립트가 돌지 않게
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
