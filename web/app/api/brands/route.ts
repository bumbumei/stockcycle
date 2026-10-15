import { NextResponse } from "next/server";
import { adminError, checkAdmin } from "@/lib/admin";
import { parseBrandFields, parseBrandImage } from "@/lib/brand";
import { createBrand, getBrand, listBrands } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/brands — 편집기용 전체 목록 (관리자 키 필요: 거래처 목록은 공개하지 않는다). */
export async function GET(req: Request) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  try {
    return NextResponse.json({ rows: await listBrands() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/**
 * POST /api/brands — 브랜드 추가 (관리자 키 필요)
 * body: { slug, company, person?, title?, phone?, email?, tagline?, logoPlate?, enabled?,
 *         logo?: { type, base64 } | null, photo?: { type, base64 } | null }
 */
export async function POST(req: Request) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const fields = parseBrandFields(body);
  if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
  const logo = parseBrandImage(body.logo, "logo");
  if (!logo.ok) return NextResponse.json({ error: logo.error }, { status: 400 });
  const photo = parseBrandImage(body.photo, "photo");
  if (!photo.ok) return NextResponse.json({ error: photo.error }, { status: 400 });

  try {
    const created = await createBrand(fields.value, logo.value, photo.value);
    if (!created) {
      return NextResponse.json({ error: `'${fields.value.slug}' 은(는) 이미 있는 주소 이름입니다.` }, { status: 409 });
    }
    const brand = await getBrand(fields.value.slug);
    return NextResponse.json({ ok: true, brand }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
