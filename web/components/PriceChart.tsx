"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { prevYearEnd, shiftDays, sma } from "@/lib/stock";

type Props = {
  ticker: string;
  dates: string[];     // 오름차순
  closes: number[];
  volumes: number[];
  isKr: boolean;       // 가격 표기 (원화 정수 / 달러 소수 2자리)
};

const RANGES = [
  { key: "1M", label: "1개월", days: 30 },
  { key: "3M", label: "3개월", days: 90 },
  { key: "6M", label: "6개월", days: 180 },
  { key: "YTD", label: "연초", days: 0 },
  { key: "1Y", label: "1년", days: 365 },
  { key: "3Y", label: "3년", days: 1095 },
  { key: "5Y", label: "5년", days: 1826 },
  { key: "ALL", label: "전체", days: 0 },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

// 검증된 다크 팔레트 (dataviz 검증기 통과: CVD ΔE 9.4, 대비 3:1 이상 on #111827)
const C = {
  close: "#3987e5",
  sma50: "#d95926",
  sma200: "#199e70",
  volume: "#4b5563",
  volumeHover: "#6b7280",
  grid: "#1f2937",
  surface: "#111827",
  text: "#9ca3af",
  textStrong: "#e5e7eb",
};

const PAD = { l: 8, r: 64, t: 12, b: 22 };
const PRICE_H = 280;
const VOL_H = 64;

export default function PriceChart({ ticker, dates, closes, volumes, isKr }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [range, setRange] = useState<RangeKey>("1Y");
  const [show50, setShow50] = useState(true);
  const [show200, setShow200] = useState(true);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = Math.floor(entries[0].contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const sma50 = useMemo(() => sma(closes, 50), [closes]);
  const sma200 = useMemo(() => sma(closes, 200), [closes]);

  // 보이는 구간의 시작 인덱스
  const start = useMemo(() => {
    const n = dates.length;
    if (n === 0) return 0;
    const last = dates[n - 1];
    const r = RANGES.find((x) => x.key === range)!;
    let cutoff: string;
    if (r.key === "ALL") return 0;
    if (r.key === "YTD") cutoff = prevYearEnd(last);
    else cutoff = shiftDays(last, r.days);
    let i = dates.findIndex((d) => d > cutoff);
    if (i < 0) i = n - 1;
    return Math.max(0, Math.min(i, n - 2));
  }, [dates, range]);

  const vDates = dates.slice(start);
  const vCloses = closes.slice(start);
  const vVol = volumes.slice(start);
  const v50 = sma50.slice(start);
  const v200 = sma200.slice(start);
  const n = vDates.length;

  const fmtPrice = (v: number) => (isKr ? Math.round(v).toLocaleString("ko-KR") : v.toFixed(2));
  const fmtTick = (v: number) =>
    isKr ? Math.round(v).toLocaleString("ko-KR") : v >= 1000 ? v.toFixed(0) : v.toFixed(v >= 100 ? 1 : 2);
  const fmtVol = (v: number) => new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const fmtPct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)}%`;

  // 스케일
  const plotW = Math.max(10, width - PAD.l - PAD.r);
  const plotH = PRICE_H - PAD.t - PAD.b;
  const ys: number[] = [...vCloses];
  if (show50) for (const x of v50) if (x !== null) ys.push(x);
  if (show200) for (const x of v200) if (x !== null) ys.push(x);
  let yMin = Math.min(...ys), yMax = Math.max(...ys);
  if (!(yMax > yMin)) { yMin -= 1; yMax += 1; }
  const padY = (yMax - yMin) * 0.06;
  yMin -= padY; yMax += padY;
  const x = (i: number) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * plotW);
  const y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  const linePath = (arr: (number | null)[]) => {
    let d = "", pen = false;
    arr.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const closePath = linePath(vCloses);
  const areaPath = n > 1
    ? `${closePath}L${x(n - 1).toFixed(1)},${(PAD.t + plotH).toFixed(1)} L${x(0).toFixed(1)},${(PAD.t + plotH).toFixed(1)} Z`
    : "";

  // 눈금
  const yTicks = useMemo(() => {
    const span = yMax - yMin;
    const raw = span / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
    const out: number[] = [];
    for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) out.push(v);
    return out;
  }, [yMin, yMax]);
  const xTickIdx = useMemo(() => {
    const k = Math.min(6, n);
    if (k <= 1) return [0];
    return Array.from({ length: k }, (_, j) => Math.round((j / (k - 1)) * (n - 1)));
  }, [n]);
  const longRange = range === "3Y" || range === "5Y" || range === "ALL";
  const xLabel = (d: string) => (longRange ? d.slice(0, 7) : d.slice(5));

  // 거래량
  const volMax = Math.max(1, ...vVol);
  const barW = Math.min(24, Math.max(1, plotW / Math.max(1, n) - 1));

  // 기간 요약
  const first = vCloses[0], last = vCloses[n - 1];
  const rangeRet = first > 0 ? (last / first - 1) * 100 : null;
  let hiI = 0, loI = 0;
  vCloses.forEach((v, i) => { if (v > vCloses[hiI]) hiI = i; if (v < vCloses[loI]) loI = i; });

  // 호버
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - PAD.l;
    const i = Math.round((px / plotW) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  const hi = hover;
  const tipLeft = hi === null ? 0 : x(hi) > width * 0.6 ? x(hi) - 190 : x(hi) + 12;

  return (
    <section className="bg-gray-900 border border-gray-800 rounded">
      {/* 컨트롤: 기간 (한 줄, 차트 위) */}
      <div className="px-3 py-2 border-b border-gray-800 flex flex-wrap items-center gap-1.5 text-xs">
        <span className="text-gray-500 mr-1">기간</span>
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => { setRange(r.key); setHover(null); }}
            aria-pressed={range === r.key}
            className={`px-2 py-0.5 rounded border transition ${
              range === r.key
                ? "bg-amber-500/20 border-amber-500/60 text-amber-200"
                : "bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-700 hover:text-gray-200"
            }`}
          >
            {r.label}
          </button>
        ))}
        <span className="mx-1 text-gray-700">|</span>
        <LegendToggle color={C.close} label="종가" on disabled />
        <LegendToggle color={C.sma50} label="50일선" on={show50} onClick={() => setShow50((v) => !v)} />
        <LegendToggle color={C.sma200} label="200일선" on={show200} onClick={() => setShow200((v) => !v)} />
        {rangeRet !== null && (
          <span className="ml-auto text-gray-400">
            {vDates[0]} ~ {vDates[n - 1]} ·{" "}
            <span className={rangeRet >= 0 ? "text-green-400" : "text-red-400"}>{fmtPct(rangeRet)}</span>
            {" · 최고 "}<span className="text-gray-200 tabular-nums">{fmtPrice(vCloses[hiI])}</span>
            <span className="text-gray-600"> ({vDates[hiI]})</span>
            {" · 최저 "}<span className="text-gray-200 tabular-nums">{fmtPrice(vCloses[loI])}</span>
            <span className="text-gray-600"> ({vDates[loI]})</span>
          </span>
        )}
      </div>

      <div ref={wrapRef} className="relative">
        <svg
          width={width}
          height={PRICE_H + VOL_H}
          role="img"
          aria-label={`${ticker} 종가 추이 (${vDates[0]} ~ ${vDates[n - 1]})`}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          className="block touch-none select-none"
        >
          {/* 격자 + y 눈금 */}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + plotW} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth={1} />
              <text x={PAD.l + plotW + 6} y={y(t) + 3.5} fontSize={10} fill={C.text}>{fmtTick(t)}</text>
            </g>
          ))}
          {/* x 눈금 */}
          {xTickIdx.map((i) => (
            <text key={i} x={x(i)} y={PRICE_H - 6} fontSize={10} fill={C.text}
              textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>
              {xLabel(vDates[i])}
            </text>
          ))}
          {/* 종가 영역 + 선 */}
          <path d={areaPath} fill={C.close} fillOpacity={0.1} />
          <path d={closePath} fill="none" stroke={C.close} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {show50 && <path d={linePath(v50)} fill="none" stroke={C.sma50} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />}
          {show200 && <path d={linePath(v200)} fill="none" stroke={C.sma200} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />}
          {/* 끝값 직접 라벨 */}
          {n > 0 && (
            <g>
              <circle cx={x(n - 1)} cy={y(last)} r={4} fill={C.close} stroke={C.surface} strokeWidth={2} />
              <rect x={PAD.l + plotW + 2} y={y(last) - 9} width={PAD.r - 4} height={18} rx={3} fill={C.close} fillOpacity={0.18} />
              <text x={PAD.l + plotW + 6} y={y(last) + 3.5} fontSize={10} fontWeight={600} fill={C.textStrong}>{fmtTick(last)}</text>
            </g>
          )}
          {/* 거래량 패널 (별도 축, 같은 x) */}
          <line x1={PAD.l} x2={PAD.l + plotW} y1={PRICE_H + VOL_H - 1} y2={PRICE_H + VOL_H - 1} stroke={C.grid} strokeWidth={1} />
          {vVol.map((v, i) => {
            const h = (v / volMax) * (VOL_H - 8);
            return (
              <rect
                key={i}
                x={x(i) - barW / 2}
                y={PRICE_H + VOL_H - 1 - h}
                width={barW}
                height={h}
                fill={hi === i ? C.volumeHover : C.volume}
                rx={barW >= 4 ? 1.5 : 0}
              />
            );
          })}
          <text x={PAD.l + plotW + 6} y={PRICE_H + 12} fontSize={10} fill={C.text}>거래량</text>
          <text x={PAD.l + plotW + 6} y={PRICE_H + 24} fontSize={10} fill={C.text}>{fmtVol(volMax)}</text>
          {/* 크로스헤어 */}
          {hi !== null && (
            <g pointerEvents="none">
              <line x1={x(hi)} x2={x(hi)} y1={PAD.t} y2={PRICE_H + VOL_H - 1} stroke={C.text} strokeWidth={1} strokeOpacity={0.6} />
              <circle cx={x(hi)} cy={y(vCloses[hi])} r={4} fill={C.close} stroke={C.surface} strokeWidth={2} />
              {show50 && v50[hi] !== null && <circle cx={x(hi)} cy={y(v50[hi] as number)} r={3.5} fill={C.sma50} stroke={C.surface} strokeWidth={2} />}
              {show200 && v200[hi] !== null && <circle cx={x(hi)} cy={y(v200[hi] as number)} r={3.5} fill={C.sma200} stroke={C.surface} strokeWidth={2} />}
            </g>
          )}
        </svg>

        {hi !== null && (
          <div
            className="absolute top-3 pointer-events-none bg-gray-950/95 border border-gray-700 rounded px-2.5 py-2 text-xs shadow-lg"
            style={{ left: tipLeft, width: 178 }}
            role="status"
          >
            <div className="text-gray-400 mb-1">{vDates[hi]}</div>
            <TipRow color={C.close} label="종가" value={fmtPrice(vCloses[hi])} />
            {hi > 0 && (
              <div className="text-[11px] text-gray-500 ml-5 -mt-0.5 mb-0.5">
                전일比{" "}
                <span className={vCloses[hi] >= vCloses[hi - 1] ? "text-green-400" : "text-red-400"}>
                  {fmtPct((vCloses[hi] / vCloses[hi - 1] - 1) * 100)}
                </span>
              </div>
            )}
            {show50 && <TipRow color={C.sma50} label="50일선" value={v50[hi] === null ? "—" : fmtPrice(v50[hi] as number)} />}
            {show200 && <TipRow color={C.sma200} label="200일선" value={v200[hi] === null ? "—" : fmtPrice(v200[hi] as number)} />}
            <TipRow color={C.volume} label="거래량" value={fmtVol(vVol[hi])} />
          </div>
        )}
      </div>

      {/* 표 보기 (접근성·검증용) */}
      <details className="border-t border-gray-800">
        <summary className="px-3 py-1.5 text-[11px] text-gray-500 cursor-pointer hover:text-gray-300">
          데이터 표로 보기 ({n}행)
        </summary>
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="text-gray-500 sticky top-0 bg-gray-900">
              <tr>
                <th className="px-3 py-1 text-left">날짜</th>
                <th className="px-3 py-1 text-right">종가</th>
                <th className="px-3 py-1 text-right">50일선</th>
                <th className="px-3 py-1 text-right">200일선</th>
                <th className="px-3 py-1 text-right">거래량</th>
              </tr>
            </thead>
            <tbody className="text-gray-300">
              {vDates.map((d, i) => (
                <tr key={d} className="border-t border-gray-800/60">
                  <td className="px-3 py-0.5">{d}</td>
                  <td className="px-3 py-0.5 text-right">{fmtPrice(vCloses[i])}</td>
                  <td className="px-3 py-0.5 text-right">{v50[i] === null ? "—" : fmtPrice(v50[i] as number)}</td>
                  <td className="px-3 py-0.5 text-right">{v200[i] === null ? "—" : fmtPrice(v200[i] as number)}</td>
                  <td className="px-3 py-0.5 text-right">{vVol[i].toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}

function LegendToggle({
  color, label, on, onClick, disabled,
}: { color: string; label: string; on: boolean; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border transition ${
        on ? "border-gray-700 text-gray-200" : "border-gray-800 text-gray-500 line-through"
      } ${disabled ? "cursor-default" : "hover:border-gray-500"}`}
    >
      <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: color, opacity: on ? 1 : 0.4 }} />
      {label}
    </button>
  );
}

function TipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="inline-block w-3 h-0.5 rounded" style={{ backgroundColor: color }} />
      <span className="text-gray-400 w-12">{label}</span>
      <span className="text-gray-100 font-semibold tabular-nums ml-auto">{value}</span>
    </div>
  );
}
