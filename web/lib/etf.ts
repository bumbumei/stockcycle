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
export type PeriodMap = Record<EtfPeriodKey, number | null>;

/** 분류 칩/그룹 표시 순서. 목록에 없는 분류는 뒤에 붙는다. */
export const ETF_CATEGORY_ORDER = ["시장대표", "섹터", "테마", "국가", "원자재", "리츠"];

/** 순위 변동 비교 기준: 며칠 전 스냅샷과 비교하는가. */
export const RANK_COMPARE_DAYS = 7;

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
  sma50: number | null;      // 50거래일 단순이동평균 (데이터 50일 미만이면 null)
  sma200: number | null;     // 200거래일 단순이동평균 (데이터 200일 미만이면 null)
  mdd1y: number | null;      // 최근 1년 최대 낙폭 % (음수)
  stale: boolean;            // 전체 기준일보다 7일 이상 뒤처진 데이터 → 랭킹에서 제외
  returns: PeriodMap;        // % (기간 시작 종가 → 최신 종가)
  vol: PeriodMap;            // 기간 내 일간 수익률 표준편차의 연율화 % (√252)
  riskAdj: PeriodMap;        // 수익률 ÷ 기간 변동성 (수익률/(σ_daily·√n)) — 클수록 안정적 상승
  prevReturns: PeriodMap;    // RANK_COMPARE_DAYS 일 전 기준으로 계산한 같은 기간 수익률 (순위 변동용)
};

export type EtfTrendData = {
  asOf: string | null;       // 유니버스 전체의 최신 거래일
  prevAsOf: string | null;   // 순위 변동 비교 스냅샷의 기준일
  count: number;             // 유니버스 크기 (market='US_ETF' 티커 수)
  rows: EtfTrendRow[];
  error?: string;            // 조회 실패 시 (테이블 미생성 등) 사유
};

// ── 유니버스 목록 편집 (/etf/manage) ──────────────────────────

export const DIVIDEND_FREQS = ["월", "분기", "반기", "연"] as const;
export const US_TICKER_RE = /^[A-Z][-.A-Z0-9]{0,9}$/;

/** 편집기/API 가 주고받는 메타 입력. 빈 문자열은 null 로 정규화된다. */
export type EtfMetaInput = {
  name: string | null;
  category: string | null;
  label: string | null;
  issuer: string | null;
  expenseRatio: number | null;   // 소수 (0.0009 = 0.09%)
  dividendFreq: string | null;
  description: string | null;
};

/** 편집기 목록 행 (숨김·대기열 상태 포함). */
export type EtfUniverseRow = {
  ticker: string;
  name: string;
  category: string | null;
  label: string | null;
  issuer: string | null;
  expenseRatio: number | null;
  dividendFreq: string | null;
  description: string | null;
  sortOrder: number | null;
  hidden: boolean;
  priceRows: number;            // daily_prices 행 수 (0 = 아직 수집 전)
  lastDate: string | null;      // 최신 종가 날짜
  pendingStatus: string | null; // 'pending' | 'processing' | 'error' | null
  pendingError: string | null;
};

const LIMITS = { name: 100, category: 20, label: 50, issuer: 50, description: 500 } as const;

function cleanStr(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * 메타 입력 정규화 + 검증. expenseRatio 는 소수(0.0009) 또는 "0.09%" / "0.09"(= %) 문자열을 받는다.
 */
export function parseEtfMetaInput(
  body: unknown
): { ok: true; value: EtfMetaInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;

  let expenseRatio: number | null = null;
  const raw = b.expenseRatio;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    let n: number;
    if (typeof raw === "number") {
      n = raw;
    } else {
      const s = String(raw).trim();
      const pct = s.endsWith("%");
      n = Number(s.replace("%", ""));
      // 문자열은 % 로 해석 (0.09 → 0.0009). 소수 형태로 보내려면 number 로.
      if (Number.isFinite(n)) n = pct || n >= 0.02 ? n / 100 : n;
    }
    if (!Number.isFinite(n) || n < 0 || n > 0.1) {
      return { ok: false, error: "수수료는 0 ~ 10% 사이의 값이어야 합니다 (예: 0.09)." };
    }
    expenseRatio = n;
  }

  const dividendFreq = cleanStr(b.dividendFreq, 10);
  if (dividendFreq && !(DIVIDEND_FREQS as readonly string[]).includes(dividendFreq)) {
    return { ok: false, error: `배당기준은 ${DIVIDEND_FREQS.join("/")} 중 하나여야 합니다.` };
  }

  return {
    ok: true,
    value: {
      name: cleanStr(b.name, LIMITS.name),
      category: cleanStr(b.category, LIMITS.category),
      label: cleanStr(b.label, LIMITS.label),
      issuer: cleanStr(b.issuer, LIMITS.issuer),
      expenseRatio,
      dividendFreq,
      description: cleanStr(b.description, LIMITS.description),
    },
  };
}

export function normalizeUsTicker(raw: unknown): string | null {
  const t = String(raw ?? "").trim().toUpperCase();
  return US_TICKER_RE.test(t) ? t : null;
}

// ── 매크로 환경 ────────────────────────────────────────────────

export const MACRO_DEFS = [
  { key: "VIX", label: "VIX", kind: "pct", digits: 1, unit: "", hint: "변동성 지수 — 높을수록 시장 불안" },
  { key: "US10Y", label: "미 10년물", kind: "diff", digits: 2, unit: "%", hint: "미국 10년 국채 수익률 (변동은 %p)" },
  { key: "DXY", label: "달러인덱스", kind: "pct", digits: 1, unit: "", hint: "강달러일수록 신흥국·원자재에 부담" },
  { key: "WTI", label: "WTI 유가", kind: "pct", digits: 1, unit: "$", hint: "" },
  { key: "USDKRW", label: "원/달러", kind: "pct", digits: 0, unit: "₩", hint: "" },
] as const;

export type MacroKey = (typeof MACRO_DEFS)[number]["key"];

export type MacroItem = {
  key: MacroKey;
  label: string;
  kind: "pct" | "diff";      // 변동 표시: % 변화 | 절대 차이(%p)
  digits: number;
  unit: string;
  hint: string;
  date: string;              // 최신 값 날짜
  value: number;
  chg1w: number | null;      // 1주 전 대비 (kind 에 따라 % 또는 %p)
  chg1m: number | null;      // 1개월 전 대비
};

// ── 기본 헬퍼 ──────────────────────────────────────────────────

export function periodLabel(key: EtfPeriodKey): string {
  return ETF_PERIODS.find((p) => p.key === key)?.label ?? key;
}

export function emptyPeriodMap(): PeriodMap {
  const r = {} as PeriodMap;
  for (const p of ETF_PERIODS) r[p.key] = null;
  return r;
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

/** 이동평균 대비 % (양수 = 이평선 위). */
export function vsSma(close: number | null, sma: number | null): number | null {
  if (close === null || sma === null || sma <= 0) return null;
  return (close / sma - 1) * 100;
}

export type TrendLabel = "상승" | "하락" | "혼조";

/**
 * 추세 판정 (50/200일 이동평균):
 *   상승 = 종가 > 200일선 이고 50일선 > 200일선 (골든크로스 상태)
 *   하락 = 종가 < 200일선 이고 50일선 < 200일선 (데드크로스 상태)
 *   혼조 = 그 외 (전환 구간)
 */
export function trendOf(
  r: Pick<EtfTrendRow, "close" | "sma50" | "sma200">
): TrendLabel | null {
  if (r.close === null || r.sma50 === null || r.sma200 === null) return null;
  if (r.close > r.sma200 && r.sma50 > r.sma200) return "상승";
  if (r.close < r.sma200 && r.sma50 < r.sma200) return "하락";
  return "혼조";
}

// ── 랭킹 ───────────────────────────────────────────────────────

export type RankMode = "return" | "riskAdj";

export function rankValue(r: EtfTrendRow, period: EtfPeriodKey, mode: RankMode): number | null {
  return mode === "riskAdj" ? r.riskAdj[period] : r.returns[period];
}

/** 선택 값이 있는(그리고 stale 아닌) 행만 내림차순 정렬. */
export function rankRows(
  rows: EtfTrendRow[],
  period: EtfPeriodKey,
  mode: RankMode = "return"
): EtfTrendRow[] {
  return rows
    .filter((r) => !r.stale && rankValue(r, period, mode) !== null)
    .sort(
      (a, b) => (rankValue(b, period, mode) as number) - (rankValue(a, period, mode) as number)
    );
}

export function topAndWorst(
  rows: EtfTrendRow[],
  period: EtfPeriodKey,
  n = 10,
  mode: RankMode = "return"
): { top: EtfTrendRow[]; worst: EtfTrendRow[] } {
  const ranked = rankRows(rows, period, mode);
  const top = ranked.slice(0, n);
  const worst = ranked.slice(Math.max(0, ranked.length - n)).reverse();
  return { top, worst };
}

/** 티커 → 1-based 순위 (현재 스코프 기준). */
export function rankMap(ranked: EtfTrendRow[]): Map<string, number> {
  const m = new Map<string, number>();
  ranked.forEach((r, i) => m.set(r.ticker, i + 1));
  return m;
}

/** RANK_COMPARE_DAYS 일 전 스냅샷(prevReturns)으로 같은 스코프의 순위를 매긴다 (수익률 기준만). */
export function prevRankMap(rows: EtfTrendRow[], period: EtfPeriodKey): Map<string, number> {
  const ranked = rows
    .filter((r) => !r.stale && r.prevReturns[period] !== null)
    .sort((a, b) => (b.prevReturns[period] as number) - (a.prevReturns[period] as number));
  return rankMap(ranked);
}

// ── 분석 ───────────────────────────────────────────────────────

export type Breadth = {
  n: number;               // 집계 대상 (stale 제외, 이평 계산 가능)
  above50: number | null;  // 50일선 위 비율 %
  above200: number | null; // 200일선 위 비율 %
  uptrend: number | null;  // 추세=상승 비율 %
  downtrend: number | null;
};

/** 시장 폭(breadth): 유니버스 중 이평선 위 비율. */
export function breadthOf(rows: EtfTrendRow[]): Breadth {
  const live = rows.filter((r) => !r.stale && r.close !== null);
  const with50 = live.filter((r) => r.sma50 !== null);
  const with200 = live.filter((r) => r.sma200 !== null);
  const pct = (num: number, den: number) => (den === 0 ? null : (num / den) * 100);
  return {
    n: live.length,
    above50: pct(with50.filter((r) => (r.close as number) > (r.sma50 as number)).length, with50.length),
    above200: pct(with200.filter((r) => (r.close as number) > (r.sma200 as number)).length, with200.length),
    uptrend: pct(with200.filter((r) => trendOf(r) === "상승").length, with200.length),
    downtrend: pct(with200.filter((r) => trendOf(r) === "하락").length, with200.length),
  };
}

export type CategoryStat = {
  category: string;        // '전체' 포함
  count: number;
  avg: PeriodMap;          // 동일가중 평균 수익률 %
  above200: number | null; // 200일선 위 비율 %
};

function mean(xs: number[]): number | null {
  return xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** 분류별 동일가중 평균 수익률 (로테이션 파악용). 첫 행은 '전체'. */
export function categoryStats(rows: EtfTrendRow[], uncategorized = "기타"): CategoryStat[] {
  const live = rows.filter((r) => !r.stale);
  const groups = new Map<string, EtfTrendRow[]>();
  for (const r of live) {
    const c = r.category ?? uncategorized;
    groups.set(c, [...(groups.get(c) ?? []), r]);
  }
  const order = [
    ...ETF_CATEGORY_ORDER.filter((c) => groups.has(c)),
    ...Array.from(groups.keys()).filter((c) => !ETF_CATEGORY_ORDER.includes(c)).sort(),
  ];
  const stat = (category: string, list: EtfTrendRow[]): CategoryStat => {
    const avg = emptyPeriodMap();
    for (const p of ETF_PERIODS) {
      avg[p.key] = mean(list.map((r) => r.returns[p.key]).filter((v): v is number => v !== null));
    }
    const with200 = list.filter((r) => r.sma200 !== null && r.close !== null);
    return {
      category,
      count: list.length,
      avg,
      above200:
        with200.length === 0
          ? null
          : (with200.filter((r) => (r.close as number) > (r.sma200 as number)).length / with200.length) * 100,
    };
  };
  return [stat("전체", live), ...order.map((c) => stat(c, groups.get(c) ?? []))];
}

export type Signals = {
  nearHigh: EtfTrendRow[];   // 52주 고점에 가까운 순 (2% 이내면 isNearHigh)
  nearLow: EtfTrendRow[];    // 52주 저점에 가까운 순 (2% 이내면 isNearLow)
  rebound: EtfTrendRow[];    // 1년 MDD ≤ -20% 인데 1개월 상승 + 50일선 회복 (바닥 탈출 후보)
  crossUp: EtfTrendRow[];    // 50일선이 200일선 위로 올라선 상태이지만 3개월 수익률은 아직 음수 (초기 추세 전환)
};

export const SIGNAL_NEAR_PCT = 2;
export const SIGNAL_MDD_PCT = -20;

/** 52주 고점의 SIGNAL_NEAR_PCT % 이내인가. */
export function isNearHigh(r: EtfTrendRow): boolean {
  const v = fromHigh1y(r);
  return v !== null && v >= -SIGNAL_NEAR_PCT;
}

/** 52주 저점의 SIGNAL_NEAR_PCT % 이내인가. */
export function isNearLow(r: EtfTrendRow): boolean {
  const v = fromLow1y(r);
  return v !== null && v <= SIGNAL_NEAR_PCT;
}

/**
 * 시그널 목록. 신고가/신저가는 임계값으로 자르지 않고 "가까운 순" 상위 limit 개를 돌려준다
 * (어떤 날은 2% 이내가 하나도 없을 수 있어서 — 화면에서 isNearHigh/isNearLow 로 강조만 한다).
 */
export function signalsOf(rows: EtfTrendRow[], limit = 8): Signals {
  const live = rows.filter((r) => !r.stale && r.close !== null);
  const nearHigh = live
    .filter((r) => fromHigh1y(r) !== null)
    .sort((a, b) => (fromHigh1y(b) as number) - (fromHigh1y(a) as number));
  const nearLow = live
    .filter((r) => fromLow1y(r) !== null)
    .sort((a, b) => (fromLow1y(a) as number) - (fromLow1y(b) as number));
  const rebound = live
    .filter(
      (r) =>
        r.mdd1y !== null &&
        r.mdd1y <= SIGNAL_MDD_PCT &&
        (r.returns["1M"] ?? 0) > 0 &&
        r.sma50 !== null &&
        (r.close as number) > r.sma50
    )
    .sort((a, b) => (b.returns["1M"] as number) - (a.returns["1M"] as number));
  const crossUp = live
    .filter(
      (r) =>
        r.sma50 !== null &&
        r.sma200 !== null &&
        r.sma50 > r.sma200 &&
        (r.close as number) > r.sma50 &&
        (r.returns["3M"] ?? 1) < 0
    )
    .sort((a, b) => (vsSma(b.close, b.sma200) as number) - (vsSma(a.close, a.sma200) as number));
  return {
    nearHigh: nearHigh.slice(0, limit),
    nearLow: nearLow.slice(0, limit),
    rebound: rebound.slice(0, limit),
    crossUp: crossUp.slice(0, limit),
  };
}

// ── 공유 텍스트 ────────────────────────────────────────────────

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
