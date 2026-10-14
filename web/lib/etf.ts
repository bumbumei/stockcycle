/**
 * 미국 ETF 트렌드 뷰어 — 서버/클라이언트가 공유하는 순수 타입·상수·헬퍼.
 * (DB 의존성 없음: 클라이언트 컴포넌트에서 import 해도 안전)
 *
 * 기간은 기존 구글 시트(수익률 7/30/90/180/365/730/1460일전)와 같은 "달력일 기준"이다:
 *   수익률 = 최신 종가 / (기준일 - N일 이하 가장 최근 거래일 종가) - 1
 */

export const ETF_PERIODS = [
  { key: "1W", label: "1주", days: 7 },
  { key: "1M", label: "1개월", days: 30 },
  { key: "2M", label: "2개월", days: 60 },
  { key: "3M", label: "3개월", days: 90 },
  { key: "6M", label: "6개월", days: 180 },
  { key: "1Y", label: "1년", days: 365 },
  { key: "2Y", label: "2년", days: 730 },
  { key: "3Y", label: "3년", days: 1095 },
] as const;

export type EtfPeriodKey = (typeof ETF_PERIODS)[number]["key"];

/** 분류 칩/그룹 표시 순서. 목록에 없는 분류는 뒤에 붙는다. */
export const ETF_CATEGORY_ORDER = ["시장대표", "섹터", "테마", "국가", "원자재", "리츠"];

export type EtfTrendRow = {
  ticker: string;
  name: string;
  category: string | null;   // '시장대표' | '섹터' | '테마' | '국가' | '원자재' | '리츠' | null
  label: string | null;      // 한글 라벨 (예: '브라질', '반도체') — 없으면 name 사용
  issuer: string | null;
  expenseRatio: number | null;   // 소수 (0.0009 = 0.09%)
  dividendFreq: string | null;   // '월' | '분기' | '반기' | '연' | null
  description: string | null;
  asOf: string | null;       // 이 티커의 최신 종가 날짜
  close: number | null;      // 최신 종가
  dayChangePct: number | null;   // 전일 대비 %
  high1y: number | null;     // 최근 365일 최고 종가
  low1y: number | null;
  high3y: number | null;     // 최근 3년 최고 종가
  low3y: number | null;
  stale: boolean;            // 전체 기준일보다 7일 이상 뒤처진 데이터 → 랭킹에서 제외
  returns: Record<EtfPeriodKey, number | null>; // % (기간 시작 종가 → 최신 종가)
};

export type EtfTrendData = {
  asOf: string | null;       // 유니버스 전체의 최신 거래일
  count: number;             // 유니버스 크기 (market='US_ETF' 티커 수)
  rows: EtfTrendRow[];
  error?: string;            // 조회 실패 시 (테이블 미생성 등) 사유
};

export function periodLabel(key: EtfPeriodKey): string {
  return ETF_PERIODS.find((p) => p.key === key)?.label ?? key;
}

/** 라벨 우선, 없으면 이름. */
export function displayLabel(r: Pick<EtfTrendRow, "label" | "name">): string {
  return r.label?.trim() || r.name;
}

/** 52주 고점 대비 % (음수 = 고점 아래). */
export function fromHigh1y(r: Pick<EtfTrendRow, "close" | "high1y">): number | null {
  if (r.close === null || r.high1y === null || r.high1y <= 0) return null;
  return (r.close / r.high1y - 1) * 100;
}

/** 52주 저점 대비 % (양수 = 저점 위). */
export function fromLow1y(r: Pick<EtfTrendRow, "close" | "low1y">): number | null {
  if (r.close === null || r.low1y === null || r.low1y <= 0) return null;
  return (r.close / r.low1y - 1) * 100;
}

/** 최근 3년 가격대 내 현재가 위치 0~1 (시트의 '3년간현재가백분위'). */
export function position3y(
  r: Pick<EtfTrendRow, "close" | "low3y" | "high3y">
): number | null {
  if (r.close === null || r.low3y === null || r.high3y === null) return null;
  const span = r.high3y - r.low3y;
  if (span <= 0) return null;
  return Math.min(1, Math.max(0, (r.close - r.low3y) / span));
}

/** 선택 기간의 수익률이 있는 행만 내림차순 정렬. */
export function rankRows(rows: EtfTrendRow[], period: EtfPeriodKey): EtfTrendRow[] {
  return rows
    .filter((r) => !r.stale && r.returns[period] !== null)
    .sort((a, b) => (b.returns[period] as number) - (a.returns[period] as number));
}

export function topAndWorst(
  rows: EtfTrendRow[],
  period: EtfPeriodKey,
  n = 10
): { top: EtfTrendRow[]; worst: EtfTrendRow[] } {
  const ranked = rankRows(rows, period);
  const top = ranked.slice(0, n);
  const worst = ranked.slice(Math.max(0, ranked.length - n)).reverse();
  return { top, worst };
}

/**
 * 카카오톡/메모 공유용 텍스트. 기존 주간알람 시트 포맷을 그대로 따른다:
 *
 *   * 1개월 등락 *
 *   ● 미국ETF 100선 1개월 TOP 10
 *    - EWZ(브라질) : 11.86%
 *   ...
 *   ● 미국ETF 100선 1개월 Worst 10
 *    - REMX(희귀광물 채굴) : -17.69%
 */
export function buildShareText(opts: {
  rows: EtfTrendRow[];
  periods: EtfPeriodKey[];
  universeCount: number;
  category?: string | null;
  asOf?: string | null;
  title?: string | null;
  n?: number;
}): string {
  const { rows, periods, universeCount, category, asOf, title, n = 10 } = opts;
  const line = (r: EtfTrendRow, period: EtfPeriodKey) =>
    ` - ${r.ticker}(${displayLabel(r)}) : ${(r.returns[period] as number).toFixed(2)}%`;

  const blocks: string[] = [];
  if (title) blocks.push(title);
  for (const period of periods) {
    const { top, worst } = topAndWorst(rows, period, n);
    const head = `미국ETF ${universeCount}선${category ? ` [${category}]` : ""} ${periodLabel(period)}`;
    const lines: string[] = [];
    lines.push(`* ${periodLabel(period)} 등락 *`);
    lines.push(`● ${head} TOP ${n}`);
    lines.push(...top.map((r) => line(r, period)));
    lines.push("");
    lines.push(`● ${head} Worst ${n}`);
    lines.push(...worst.map((r) => line(r, period)));
    blocks.push(lines.join("\n"));
  }
  if (asOf) blocks.push(`(${asOf} 종가 기준)`);
  return blocks.join("\n\n");
}

/** 'YYYY-MM-DD' → ISO 주차 (주간 리포트 제목용). */
export function isoWeek(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7);
}
