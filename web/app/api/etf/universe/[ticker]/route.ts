import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { adminError, checkAdmin } from "@/lib/admin";
import { normalizeUsTicker, parseEtfMetaInput } from "@/lib/etf";
import {
  isEtfUniverseTicker,
  purgeEtf,
  setEtfHidden,
  upsertEtfMeta,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ticker: string }> };

async function resolveTicker(ctx: Ctx): Promise<string | NextResponse> {
  const { ticker: raw } = await ctx.params;
  const ticker = normalizeUsTicker(decodeURIComponent(raw));
  if (!ticker) return NextResponse.json({ error: "티커 형식 오류" }, { status: 400 });
  if (!(await isEtfUniverseTicker(ticker))) {
    return NextResponse.json({ error: `${ticker} 는 ETF 유니버스에 없습니다.` }, { status: 404 });
  }
  return ticker;
}

function afterWrite() {
  revalidatePath("/etf");
  revalidatePath("/");
}

/** PUT — 메타(이름/분류/라벨/운용사/수수료/배당기준/설명) 수정. */
export async function PUT(req: Request, ctx: Ctx) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  const ticker = await resolveTicker(ctx);
  if (ticker instanceof NextResponse) return ticker;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const meta = parseEtfMetaInput(body);
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 400 });

  try {
    await upsertEtfMeta(ticker, meta.value);
    afterWrite();
    return NextResponse.json({ ok: true, ticker });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** PATCH — { hidden: boolean } 숨김/복구. 숨기면 ETF 트렌드 집계에서만 빠지고 데이터는 유지. */
export async function PATCH(req: Request, ctx: Ctx) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  const ticker = await resolveTicker(ctx);
  if (ticker instanceof NextResponse) return ticker;

  let body: { hidden?: unknown };
  try {
    body = (await req.json()) as { hidden?: unknown };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (typeof body.hidden !== "boolean") {
    return NextResponse.json({ error: "hidden(boolean) 이 필요합니다." }, { status: 400 });
  }
  try {
    await setEtfHidden(ticker, body.hidden);
    afterWrite();
    return NextResponse.json({ ok: true, ticker, hidden: body.hidden });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** DELETE — 완전 삭제 (가격·메타·대기열·티커). 되돌릴 수 없음. */
export async function DELETE(req: Request, ctx: Ctx) {
  const check = checkAdmin(req);
  if (!check.ok) return adminError(check);
  const ticker = await resolveTicker(ctx);
  if (ticker instanceof NextResponse) return ticker;

  try {
    await purgeEtf(ticker);
    afterWrite();
    return NextResponse.json({ ok: true, ticker, purged: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
