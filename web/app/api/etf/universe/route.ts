import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { adminError, checkAdmin } from "@/lib/admin";
import { normalizeUsTicker, parseEtfMetaInput } from "@/lib/etf";
import { addEtfToUniverse, listEtfUniverse } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** GET /api/etf/universe — 편집기용 전체 목록 (숨김 포함). 읽기는 공개. */
export async function GET() {
  const result = await listEtfUniverse();
  return NextResponse.json(result, { status: result.error ? 500 : 200 });
}

/**
 * POST /api/etf/universe — ETF 추가 (관리자 키 필요)
 * body: { ticker, name?, category?, label?, issuer?, expenseRatio?, dividendFreq?, description? }
 * 데이터가 없는 티커는 대기열에 들어가 다음 수집(KST 07:30/18:30) 때 백필된다 → 202.
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

  const ticker = normalizeUsTicker(body.ticker);
  if (!ticker) {
    return NextResponse.json(
      { error: "티커 형식이 올바르지 않습니다. 미국 ETF 영문 티커를 입력하세요 (예: SPY, BRK-B)." },
      { status: 400 }
    );
  }
  const meta = parseEtfMetaInput(body);
  if (!meta.ok) return NextResponse.json({ error: meta.error }, { status: 400 });

  try {
    const result = await addEtfToUniverse(ticker, meta.value);
    revalidatePath("/etf");
    revalidatePath("/");
    return NextResponse.json(
      {
        ok: true,
        ticker,
        ...result,
        message: result.queued
          ? `${ticker} 를 목록에 넣고 수집 대기열에 추가했습니다. 다음 데이터 동기화 때 10년치가 채워집니다.`
          : `${ticker} 를 ETF 유니버스에 포함했습니다.`,
      },
      { status: result.queued ? 202 : 200 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
