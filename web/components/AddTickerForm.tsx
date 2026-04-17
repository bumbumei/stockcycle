"use client";

import { useEffect, useState } from "react";
import { PendingTicker } from "@/lib/db";

type FormState = {
  open: boolean;
  ticker: string;
  name: string;
  market: string;
  submitting: boolean;
  message: { kind: "ok" | "err" | "info"; text: string } | null;
};

const MARKETS = [
  { value: "", label: "자동 판별" },
  { value: "KOSPI", label: "KOSPI" },
  { value: "KOSDAQ", label: "KOSDAQ" },
  { value: "ETF", label: "ETF (한국)" },
  { value: "NASDAQ", label: "NASDAQ" },
  { value: "NYSE", label: "NYSE" },
];

export default function AddTickerForm() {
  const [state, setState] = useState<FormState>({
    open: false,
    ticker: "",
    name: "",
    market: "",
    submitting: false,
    message: null,
  });
  const [pending, setPending] = useState<PendingTicker[]>([]);
  const [loadingPending, setLoadingPending] = useState(true);

  const refreshPending = async () => {
    try {
      const r = await fetch("/api/tickers/pending", { cache: "no-store" });
      const j = await r.json();
      setPending(Array.isArray(j.pending) ? j.pending : []);
    } catch {
      /* noop */
    } finally {
      setLoadingPending(false);
    }
  };

  useEffect(() => {
    refreshPending();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = state.ticker.trim();
    if (!ticker) return;

    setState((s) => ({ ...s, submitting: true, message: null }));
    try {
      const r = await fetch("/api/tickers/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker,
          name: state.name.trim() || undefined,
          market: state.market || undefined,
        }),
      });
      const j = await r.json();
      if (!r.ok) {
        setState((s) => ({
          ...s,
          submitting: false,
          message: { kind: "err", text: j.error ?? "요청 실패" },
        }));
        return;
      }
      setState({
        open: false,
        ticker: "",
        name: "",
        market: "",
        submitting: false,
        message: {
          kind: "ok",
          text: `${j.ticker} 를 대기열에 추가했습니다.`,
        },
      });
      await refreshPending();
    } catch (e) {
      setState((s) => ({
        ...s,
        submitting: false,
        message: { kind: "err", text: String(e) },
      }));
    }
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-300">종목 관리</h2>
        <button
          onClick={() =>
            setState((s) => ({ ...s, open: !s.open, message: null }))
          }
          className="text-xs px-3 py-1.5 rounded bg-amber-500/10 border border-amber-600/60 text-amber-300 hover:bg-amber-500/20 transition"
        >
          {state.open ? "닫기" : "＋ 종목 추가"}
        </button>
      </div>

      {state.open && (
        <form
          onSubmit={submit}
          className="bg-gray-900 border border-gray-800 rounded p-3 space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-[1fr,1fr,140px] gap-2">
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">
                티커 코드 <span className="text-red-400">*</span>
              </label>
              <input
                value={state.ticker}
                onChange={(e) =>
                  setState((s) => ({ ...s, ticker: e.target.value }))
                }
                placeholder="예: 005380, TSLA"
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">
                종목명 (선택)
              </label>
              <input
                value={state.name}
                onChange={(e) =>
                  setState((s) => ({ ...s, name: e.target.value }))
                }
                placeholder="빈 값이면 자동 조회"
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
              />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-1">
                시장
              </label>
              <select
                value={state.market}
                onChange={(e) =>
                  setState((s) => ({ ...s, market: e.target.value }))
                }
                className="w-full bg-gray-950 border border-gray-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-gray-600"
              >
                {MARKETS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-[11px] text-gray-500">
              등록 후 다음 데이터 동기화 시(KST 07:30 / 18:30) 자동 처리됩니다.
              즉시 반영이 필요하면 GitHub Actions 탭에서 <code>Daily Data Ingest</code>{" "}
              워크플로우를 수동 실행하세요.
            </p>
            <button
              type="submit"
              disabled={state.submitting || !state.ticker.trim()}
              className="text-sm px-4 py-2 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-400 transition"
            >
              {state.submitting ? "추가 중..." : "대기열에 추가"}
            </button>
          </div>
        </form>
      )}

      {state.message && (
        <div
          className={`text-sm rounded px-3 py-2 ${
            state.message.kind === "ok"
              ? "bg-green-500/10 border border-green-600/60 text-green-300"
              : state.message.kind === "err"
              ? "bg-red-500/10 border border-red-600/60 text-red-300"
              : "bg-gray-800 border border-gray-700 text-gray-300"
          }`}
        >
          {state.message.text}
        </div>
      )}

      {pending.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-gray-400 mb-2">
            처리 대기 중 ({pending.length})
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
            {pending.map((p) => (
              <PendingCard key={p.ticker} p={p} onChanged={refreshPending} />
            ))}
          </div>
        </div>
      )}
      {!loadingPending && pending.length === 0 && state.open && (
        <p className="text-xs text-gray-500">대기 중인 종목이 없습니다.</p>
      )}
    </section>
  );
}

function PendingCard({
  p,
  onChanged,
}: {
  p: PendingTicker;
  onChanged: () => void;
}) {
  const color =
    p.status === "error"
      ? "border-red-600/40 bg-red-500/5"
      : p.status === "processing"
      ? "border-amber-600/40 bg-amber-500/5"
      : "border-gray-700 bg-gray-900";
  const label =
    p.status === "error"
      ? "오류"
      : p.status === "processing"
      ? "처리 중"
      : "대기";
  const labelColor =
    p.status === "error"
      ? "text-red-300"
      : p.status === "processing"
      ? "text-amber-300"
      : "text-gray-400";

  const retry = async () => {
    await fetch("/api/tickers/add", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ticker: p.ticker,
        name: p.requestedName ?? undefined,
        market: p.marketHint ?? undefined,
      }),
    });
    onChanged();
  };

  return (
    <div className={`${color} border rounded p-3 text-sm`}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-xs text-gray-400">{p.ticker}</span>
            <span className={`text-[10px] uppercase ${labelColor}`}>
              {label}
            </span>
          </div>
          {p.requestedName && (
            <div className="text-gray-200 truncate">{p.requestedName}</div>
          )}
          {p.marketHint && (
            <div className="text-[10px] text-gray-500 mt-0.5">
              {p.marketHint}
            </div>
          )}
          {p.status === "error" && p.errorMsg && (
            <div className="text-[11px] text-red-300 mt-1 break-words">
              {p.errorMsg.length > 120
                ? p.errorMsg.slice(0, 120) + "…"
                : p.errorMsg}
            </div>
          )}
        </div>
        {p.status === "error" && (
          <button
            onClick={retry}
            className="text-[11px] px-2 py-1 rounded bg-gray-800 text-gray-300 hover:bg-gray-700"
            title="다시 대기열에 넣기"
          >
            재시도
          </button>
        )}
      </div>
    </div>
  );
}
