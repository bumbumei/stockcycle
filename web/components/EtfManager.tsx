"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AdminKeyPanel, { useAdminKey } from "@/components/AdminKeyPanel";
import { DIVIDEND_FREQS, ETF_CATEGORY_ORDER, EtfUniverseRow } from "@/lib/etf";

type Props = {
  initial: EtfUniverseRow[];
  secretConfigured: boolean;
  loadError?: string;
};

type Draft = {
  ticker: string;
  name: string;
  category: string;
  label: string;
  issuer: string;
  expensePct: string;   // 화면은 % 단위 문자열 (0.09)
  dividendFreq: string;
  description: string;
};

const EMPTY_DRAFT: Draft = {
  ticker: "",
  name: "",
  category: "",
  label: "",
  issuer: "",
  expensePct: "",
  dividendFreq: "",
  description: "",
};

function draftFromRow(r: EtfUniverseRow): Draft {
  return {
    ticker: r.ticker,
    name: r.name,
    category: r.category ?? "",
    label: r.label ?? "",
    issuer: r.issuer ?? "",
    expensePct: r.expenseRatio === null ? "" : (r.expenseRatio * 100).toFixed(2).replace(/\.?0+$/, ""),
    dividendFreq: r.dividendFreq ?? "",
    description: r.description ?? "",
  };
}

function draftToBody(d: Draft) {
  return {
    name: d.name,
    category: d.category,
    label: d.label,
    issuer: d.issuer,
    // 서버는 문자열을 % 로 해석한다 ("0.09" → 0.0009)
    expenseRatio: d.expensePct.trim() ? `${d.expensePct.trim()}%` : null,
    dividendFreq: d.dividendFreq,
    description: d.description,
  };
}

function statusOf(r: EtfUniverseRow): { label: string; cls: string; title?: string } {
  if (r.hidden) return { label: "숨김", cls: "text-gray-400 border-gray-700 bg-gray-800/60", title: "ETF 트렌드 집계에서 제외됨 (데이터는 유지)" };
  if (r.pendingStatus === "error") return { label: "수집 오류", cls: "text-red-300 border-red-700/60 bg-red-500/10", title: r.pendingError ?? undefined };
  if (r.pendingStatus === "pending" || r.pendingStatus === "processing") return { label: "수집 대기", cls: "text-amber-300 border-amber-700/60 bg-amber-500/10", title: "다음 데이터 동기화(KST 07:30 / 18:30) 때 백필" };
  if (r.priceRows === 0) return { label: "데이터 없음", cls: "text-red-300 border-red-700/60 bg-red-500/10" };
  return { label: "정상", cls: "text-green-300 border-green-700/60 bg-green-500/10" };
}

export default function EtfManager({ initial, secretConfigured, loadError }: Props) {
  const [rows, setRows] = useState<EtfUniverseRow[]>(initial);
  const admin = useAdminKey(secretConfigured);
  const { keyState, setKeyState } = admin;
  const [message, setMessage] = useState<{ kind: "ok" | "err" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // 작업 중인 티커 또는 'add'
  const [editing, setEditing] = useState<Draft | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addDraft, setAddDraft] = useState<Draft>(EMPTY_DRAFT);
  const [q, setQ] = useState("");
  const [showHidden, setShowHidden] = useState(true);

  const canWrite = keyState === "ok";

  const categories = useMemo(() => {
    const present = new Set(rows.map((r) => r.category).filter((c): c is string => Boolean(c)));
    return [
      ...ETF_CATEGORY_ORDER.filter((c) => present.has(c) || true),
      ...Array.from(present).filter((c) => !ETF_CATEGORY_ORDER.includes(c)).sort(),
    ];
  }, [rows]);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/etf/universe", { cache: "no-store" });
      const j = (await r.json()) as { rows?: EtfUniverseRow[]; error?: string };
      if (Array.isArray(j.rows)) setRows(j.rows);
      if (j.error) setMessage({ kind: "err", text: j.error });
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    }
  }, []);

  const call = async (
    label: string,
    url: string,
    init: RequestInit
  ): Promise<Record<string, unknown> | null> => {
    setBusy(label);
    setMessage(null);
    try {
      const r = await fetch(url, { ...init, headers: admin.headers() });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        if (r.status === 401) setKeyState("bad");
        setMessage({ kind: "err", text: String(j.error ?? `요청 실패 (${r.status})`) });
        return null;
      }
      await refresh();
      return j;
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
      return null;
    } finally {
      setBusy(null);
    }
  };

  const submitAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const j = await call("add", "/api/etf/universe", {
      method: "POST",
      body: JSON.stringify({ ticker: addDraft.ticker.trim(), ...draftToBody(addDraft) }),
    });
    if (j) {
      setMessage({ kind: "ok", text: String(j.message ?? "추가했습니다.") });
      setAddDraft(EMPTY_DRAFT);
      setAddOpen(false);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    const t = editing.ticker;
    const j = await call(t, `/api/etf/universe/${encodeURIComponent(t)}`, {
      method: "PUT",
      body: JSON.stringify(draftToBody(editing)),
    });
    if (j) {
      setMessage({ kind: "ok", text: `${t} 저장했습니다.` });
      setEditing(null);
    }
  };

  const toggleHidden = async (r: EtfUniverseRow) => {
    const j = await call(r.ticker, `/api/etf/universe/${encodeURIComponent(r.ticker)}`, {
      method: "PATCH",
      body: JSON.stringify({ hidden: !r.hidden }),
    });
    if (j) {
      setMessage({
        kind: "ok",
        text: r.hidden ? `${r.ticker} 를 다시 집계에 포함했습니다.` : `${r.ticker} 를 숨겼습니다 (데이터는 유지).`,
      });
    }
  };

  const purge = async (r: EtfUniverseRow) => {
    const ok = window.confirm(
      `${r.ticker} (${r.name}) 를 완전히 삭제합니다.\n가격 데이터 ${r.priceRows.toLocaleString()}행과 메타가 모두 지워지며 되돌릴 수 없습니다.\n집계에서만 빼려면 '숨김'을 쓰세요.\n\n정말 삭제할까요?`
    );
    if (!ok) return;
    const j = await call(r.ticker, `/api/etf/universe/${encodeURIComponent(r.ticker)}`, {
      method: "DELETE",
    });
    if (j) setMessage({ kind: "ok", text: `${r.ticker} 를 완전히 삭제했습니다.` });
  };

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!showHidden && r.hidden) return false;
      if (!ql) return true;
      return (
        r.ticker.toLowerCase().includes(ql) ||
        r.name.toLowerCase().includes(ql) ||
        (r.label ?? "").toLowerCase().includes(ql) ||
        (r.category ?? "").toLowerCase().includes(ql)
      );
    });
  }, [rows, q, showHidden]);

  const hiddenCount = rows.filter((r) => r.hidden).length;

  return (
    <div className="space-y-5">
      <AdminKeyPanel admin={admin} />

      {loadError && (
        <div className="text-sm rounded px-3 py-2 bg-red-500/10 border border-red-600/60 text-red-300 break-words">
          목록 조회 오류: {loadError}
        </div>
      )}
      {message && (
        <div
          className={`text-sm rounded px-3 py-2 ${
            message.kind === "ok"
              ? "bg-green-500/10 border border-green-600/60 text-green-300"
              : message.kind === "err"
              ? "bg-red-500/10 border border-red-600/60 text-red-300"
              : "bg-gray-800 border border-gray-700 text-gray-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {/* 추가 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-300">
            유니버스 ({rows.length - hiddenCount}개 집계 중{hiddenCount > 0 ? ` · 숨김 ${hiddenCount}` : ""})
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="티커·이름·라벨·분류 검색"
              className="bg-gray-900 border border-gray-800 rounded px-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-gray-600 w-48"
            />
            <label className="text-xs text-gray-400 flex items-center gap-1 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={showHidden}
                onChange={(e) => setShowHidden(e.target.checked)}
                className="accent-amber-500"
              />
              숨김 표시
            </label>
            <button
              type="button"
              onClick={() => setAddOpen((v) => !v)}
              disabled={!canWrite}
              className="text-xs px-3 py-1.5 rounded bg-amber-500/10 border border-amber-600/60 text-amber-300 hover:bg-amber-500/20 transition disabled:opacity-40"
              title={canWrite ? "" : "관리자 키를 먼저 확인하세요"}
            >
              {addOpen ? "닫기" : "＋ ETF 추가"}
            </button>
          </div>
        </div>

        {addOpen && canWrite && (
          <form
            onSubmit={submitAdd}
            className="bg-gray-900 border border-gray-800 rounded p-3 space-y-3"
          >
            <DraftFields
              draft={addDraft}
              onChange={setAddDraft}
              categories={categories}
              tickerEditable
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-gray-500">
                이미 수집된 종목이면 바로 집계에 포함되고, 새 티커는 다음 데이터 동기화 때 10년치가
                백필됩니다. 즉시 반영하려면 GitHub Actions 의 <code>Daily Data Ingest</code> 를
                수동 실행하세요.
              </p>
              <button
                type="submit"
                disabled={busy === "add" || !addDraft.ticker.trim()}
                className="text-sm px-4 py-2 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 hover:bg-amber-400 transition shrink-0"
              >
                {busy === "add" ? "추가 중..." : "추가"}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* 목록 */}
      <section className="overflow-x-auto border border-gray-800 rounded">
        <table className="w-full text-xs whitespace-nowrap">
          <thead className="bg-gray-900 text-gray-400">
            <tr>
              <th className="px-2 py-2 text-left">티커</th>
              <th className="px-2 py-2 text-left">이름</th>
              <th className="px-2 py-2 text-left">분류</th>
              <th className="px-2 py-2 text-left">라벨</th>
              <th className="px-2 py-2 text-left">운용사</th>
              <th className="px-2 py-2 text-right">수수료</th>
              <th className="px-2 py-2 text-left">배당</th>
              <th className="px-2 py-2 text-left">설명</th>
              <th className="px-2 py-2 text-left">데이터</th>
              <th className="px-2 py-2 text-left">상태</th>
              <th className="px-2 py-2 text-right">작업</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/80">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-gray-500">
                  {rows.length === 0
                    ? "유니버스가 비어 있습니다. 위에서 추가하거나 Actions 의 seed-etf-us 를 실행하세요."
                    : "일치하는 ETF가 없습니다."}
                </td>
              </tr>
            )}
            {filtered.map((r) =>
              editing?.ticker === r.ticker ? (
                <tr key={r.ticker} className="bg-amber-500/5">
                  <td colSpan={11} className="px-2 py-2">
                    <div className="space-y-2">
                      <DraftFields
                        draft={editing}
                        onChange={setEditing}
                        categories={categories}
                        tickerEditable={false}
                      />
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => setEditing(null)}
                          className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={busy === r.ticker}
                          className="text-xs px-3 py-1.5 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 hover:bg-amber-400"
                        >
                          {busy === r.ticker ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                <RowView
                  key={r.ticker}
                  r={r}
                  canWrite={canWrite}
                  busy={busy === r.ticker}
                  onEdit={() => setEditing(draftFromRow(r))}
                  onToggleHidden={() => void toggleHidden(r)}
                  onPurge={() => void purge(r)}
                />
              )
            )}
          </tbody>
        </table>
      </section>

      <p className="text-[11px] text-gray-500">
        숨김은 ETF 트렌드 집계에서만 빼고 가격 수집과 홈 표시는 유지합니다. 완전 삭제는 가격·메타까지
        지우며 되돌릴 수 없습니다. 초기 목록은 <code>poc/tickers_etf_us.tsv</code> 에 있고,
        시드 스크립트는 여기서 편집한 내용을 덮어쓰지 않습니다. 월별 패턴은{" "}
        <Link href="/" className="underline hover:text-white">홈</Link>에서 봅니다.
      </p>
    </div>
  );
}

function RowView({
  r,
  canWrite,
  busy,
  onEdit,
  onToggleHidden,
  onPurge,
}: {
  r: EtfUniverseRow;
  canWrite: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggleHidden: () => void;
  onPurge: () => void;
}) {
  const st = statusOf(r);
  const btn =
    "px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <tr className={`hover:bg-gray-900/60 ${r.hidden ? "opacity-60" : ""}`}>
      <td className="px-2 py-1.5 font-mono text-gray-200">
        <Link href={`/stocks/${encodeURIComponent(r.ticker)}`} className="hover:text-white">
          {r.ticker}
        </Link>
      </td>
      <td className="px-2 py-1.5 text-white max-w-[16rem] truncate" title={r.name}>{r.name}</td>
      <td className="px-2 py-1.5 text-gray-300">{r.category ?? "—"}</td>
      <td className="px-2 py-1.5 text-gray-200">{r.label ?? "—"}</td>
      <td className="px-2 py-1.5 text-gray-400">{r.issuer ?? "—"}</td>
      <td className="px-2 py-1.5 text-right text-gray-400 tabular-nums">
        {r.expenseRatio === null ? "—" : `${(r.expenseRatio * 100).toFixed(2)}%`}
      </td>
      <td className="px-2 py-1.5 text-gray-400">{r.dividendFreq ?? "—"}</td>
      <td className="px-2 py-1.5 text-gray-500 max-w-[14rem] truncate" title={r.description ?? undefined}>
        {r.description ?? "—"}
      </td>
      <td className="px-2 py-1.5 text-gray-400 tabular-nums whitespace-nowrap">
        {r.priceRows > 0 ? `${r.priceRows.toLocaleString()}행 · ${r.lastDate ?? ""}` : "—"}
      </td>
      <td className="px-2 py-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${st.cls}`} title={st.title}>
          {st.label}
        </span>
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        <div className="inline-flex gap-1">
          <button type="button" className={btn} disabled={!canWrite || busy} onClick={onEdit}>
            수정
          </button>
          <button type="button" className={btn} disabled={!canWrite || busy} onClick={onToggleHidden}>
            {r.hidden ? "복구" : "숨김"}
          </button>
          <button
            type="button"
            className={`${btn} hover:border-red-600 hover:text-red-300`}
            disabled={!canWrite || busy}
            onClick={onPurge}
          >
            삭제
          </button>
        </div>
      </td>
    </tr>
  );
}

function DraftFields({
  draft,
  onChange,
  categories,
  tickerEditable,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  categories: string[];
  tickerEditable: boolean;
}) {
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    onChange({ ...draft, [k]: e.target.value });
  const input =
    "w-full bg-gray-950 border border-gray-800 rounded px-2 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600";
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <Field label="티커">
        <input
          value={draft.ticker}
          onChange={set("ticker")}
          placeholder="예: SPY"
          disabled={!tickerEditable}
          required={tickerEditable}
          className={`${input} font-mono uppercase disabled:opacity-60`}
          autoFocus={tickerEditable}
        />
      </Field>
      <Field label="이름 (빈 값이면 자동 조회)">
        <input value={draft.name} onChange={set("name")} placeholder="SPDR S&P 500 ETF Trust" className={input} />
      </Field>
      <Field label="분류">
        <input
          value={draft.category}
          onChange={set("category")}
          list="etf-categories"
          placeholder="테마"
          className={input}
        />
        <datalist id="etf-categories">
          {categories.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </Field>
      <Field label="라벨 (한글 짧은 이름)">
        <input value={draft.label} onChange={set("label")} placeholder="SnP 500" className={input} />
      </Field>
      <Field label="운용사">
        <input value={draft.issuer} onChange={set("issuer")} placeholder="State Street" className={input} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="수수료 (%)">
          <input
            value={draft.expensePct}
            onChange={set("expensePct")}
            placeholder="0.09"
            inputMode="decimal"
            className={input}
          />
        </Field>
        <Field label="배당">
          <select value={draft.dividendFreq} onChange={set("dividendFreq")} className={input}>
            <option value="">—</option>
            {DIVIDEND_FREQS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="col-span-2 sm:col-span-3 lg:col-span-6">
        <Field label="설명">
          <textarea
            value={draft.description}
            onChange={set("description")}
            rows={2}
            placeholder="어떤 지수를 추종하는지, 특징 등"
            className={input}
          />
        </Field>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[11px] text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  );
}
