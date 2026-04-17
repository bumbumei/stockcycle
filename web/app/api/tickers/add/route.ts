import { NextResponse } from "next/server";
import { enqueuePending, existsTicker } from "@/lib/queries";

export const dynamic = "force-dynamic";

const KR_RE = /^\d{6}$/;
const US_RE = /^[A-Z][-.A-Z0-9]{0,9}$/;
const ALLOWED_MARKETS = new Set([
  "KOSPI",
  "KOSDAQ",
  "ETF",
  "NASDAQ",
  "NYSE",
  "US_OTHER",
]);

type Body = {
  ticker?: unknown;
  name?: unknown;
  market?: unknown;
};

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const rawTicker = typeof body.ticker === "string" ? body.ticker.trim() : "";
  if (!rawTicker) {
    return NextResponse.json(
      { error: "ticker는 필수입니다." },
      { status: 400 }
    );
  }

  // 입력 정규화: 6자리 숫자면 그대로, 알파벳이면 대문자
  const ticker = /^\d+$/.test(rawTicker)
    ? rawTicker
    : rawTicker.toUpperCase();

  if (!KR_RE.test(ticker) && !US_RE.test(ticker)) {
    return NextResponse.json(
      {
        error:
          "형식이 올바르지 않습니다. 한국은 6자리 숫자(예: 005380), 미국은 영문 티커(예: TSLA).",
      },
      { status: 400 }
    );
  }

  const requestedName =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim().slice(0, 100)
      : null;

  const rawMarket = typeof body.market === "string" ? body.market.trim() : "";
  const marketHint = rawMarket && ALLOWED_MARKETS.has(rawMarket) ? rawMarket : null;

  // 이미 등록된 종목인지 체크
  if (await existsTicker(ticker)) {
    return NextResponse.json(
      { error: "이미 등록된 종목입니다.", ticker },
      { status: 409 }
    );
  }

  await enqueuePending({ ticker, requestedName, marketHint });

  return NextResponse.json(
    {
      ok: true,
      ticker,
      message:
        "대기열에 추가됐습니다. 다음 데이터 동기화 시(최대 12시간 내) 자동 처리됩니다.",
    },
    { status: 202 }
  );
}
