import { NextResponse } from "next/server";
import { adminError, checkAdmin } from "@/lib/admin";
import { normalizeBrandSlug, parseBrandFields, parseBrandImage } from "@/lib/brand";
import { deleteBrand, getBrand, getBrandPublic, updateBrand } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function resolveSlug(ctx: Ctx): Promise<string | NextResponse> {
  const { slug: raw } = await ctx.params;
  const slug = normalizeBrandSlug(decodeURIComponent(raw));
  if (!slug) return NextResponse.json({ error: "주소 이름 형식 오류" }, { status: 400 });
  return slug;
}

/** GET — 공개. 상단 브랜드 띠가 부른다. 사용 중인 브랜드만, 이미지는 URL 로. */
export async function GET(_req: Request, ctx: Ctx) {
  const slug = await resolveSlug(ctx);
  if (slug instanceof NextResponse) return slug;
  try {
    const b = await getBrandPublic(slug);
    if (!b) {
      return NextResponse.json({ error: "없는 브랜드입니다." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json(b, {
      headers: { "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=600" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** PUT — 수정 (관리자). body 는 POST 와 같고, logo/photo 는 생략=유지, null=삭제, 객체=교체. */
export async function PUT(req: Request, ctx: Ctx) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  const slug = await resolveSlug(ctx);
  if (slug instanceof NextResponse) return slug;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const fields = parseBrandFields(body, { slug });
  if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
  const logo = parseBrandImage(body.logo, "logo");
  if (!logo.ok) return NextResponse.json({ error: logo.error }, { status: 400 });
  const photo = parseBrandImage(body.photo, "photo");
  if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: 400 });

  try {
    const updated = await updateBrand(fields.value, logo.value, photo.value);
    if (!updated) return NextResponse.json({ error: `'${slug}' 브랜드가 없습니다.` }, { status: 404 });
    return NextResponse.json({ ok: true, brand: await getBrand(slug) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** DELETE — 삭제 (관리자). 이미지까지 지워진다. */
export async function DELETE(req: Request, ctx: Ctx) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  const slug = await resolveSlug(ctx);
  if (slug instanceof NextResponse) return slug;
  try {
    const deleted = await deleteBrand(slug);
    if (!deleted) return NextResponse.json({ error: `'${slug}' 브랜드가 없습니다.` }, { status: 404 });
    return NextResponse.json({ ok: true, slug });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
