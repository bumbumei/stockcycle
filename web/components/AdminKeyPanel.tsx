"use client";

/**
 * 관리자 키 입력·확인 패널 + 상태 훅. ETF 목록 편집기와 브랜드 편집기가 같이 쓴다.
 * 키는 브라우저 localStorage 에만 저장하고 요청 헤더로만 보낸다 (lib/adminKey.ts).
 */
import { useCallback, useEffect, useState } from "react";
import { adminHeaders, readAdminKey, writeAdminKey } from "@/lib/adminKey";

export type KeyState = "none" | "checking" | "ok" | "bad" | "server";

export type AdminKey = {
  key: string;
  setKey: (k: string) => void;
  keyState: KeyState;
  setKeyState: (s: KeyState) => void;
  verify: (k: string) => Promise<boolean>;
  clear: () => void;
  canWrite: boolean;
  headers: () => HeadersInit;
};

export function useAdminKey(secretConfigured: boolean): AdminKey {
  const [key, setKey] = useState("");
  const [keyState, setKeyState] = useState<KeyState>(secretConfigured ? "none" : "server");

  const verify = useCallback(async (k: string): Promise<boolean> => {
    if (!k) {
      setKeyState("none");
      return false;
    }
    setKeyState("checking");
    try {
      const r = await fetch("/api/admin/verify", { method: "POST", headers: adminHeaders(k) });
      if (r.ok) {
        setKeyState("ok");
        writeAdminKey(k);
        return true;
      }
      setKeyState(r.status === 500 ? "server" : "bad");
      return false;
    } catch {
      setKeyState("bad");
      return false;
    }
  }, []);

  useEffect(() => {
    const saved = readAdminKey();
    if (saved) {
      setKey(saved);
      void verify(saved);
    }
  }, [verify]);

  const clear = useCallback(() => {
    writeAdminKey("");
    setKey("");
    setKeyState("none");
  }, []);

  return {
    key,
    setKey,
    keyState,
    setKeyState,
    verify,
    clear,
    canWrite: keyState === "ok",
    headers: () => adminHeaders(key),
  };
}

export function KeyBadge({ state }: { state: KeyState }) {
  const map: Record<KeyState, { text: string; cls: string }> = {
    none: { text: "읽기 전용", cls: "text-gray-400 border-gray-700" },
    checking: { text: "확인 중", cls: "text-gray-300 border-gray-600" },
    ok: { text: "편집 가능", cls: "text-green-300 border-green-700/60 bg-green-500/10" },
    bad: { text: "키 불일치", cls: "text-red-300 border-red-700/60 bg-red-500/10" },
    server: { text: "서버에 키 미설정", cls: "text-red-300 border-red-700/60 bg-red-500/10" },
  };
  const m = map[state];
  return <span className={`text-[11px] px-2 py-0.5 rounded-full border ${m.cls}`}>{m.text}</span>;
}

export default function AdminKeyPanel({ admin }: { admin: AdminKey }) {
  const { key, setKey, keyState, verify, clear } = admin;
  return (
    <section className="bg-gray-900 border border-gray-800 rounded p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-gray-400 shrink-0">관리자 키</label>
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void verify(key);
          }}
          placeholder="ADMIN_SECRET 값"
          autoComplete="off"
          className="flex-1 min-w-[12rem] bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600"
        />
        <button
          type="button"
          onClick={() => void verify(key)}
          disabled={keyState === "checking" || !key}
          className="text-xs px-3 py-1.5 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 hover:bg-amber-400 transition"
        >
          {keyState === "checking" ? "확인 중..." : "확인 · 이 브라우저에 저장"}
        </button>
        {keyState === "ok" && (
          <button
            type="button"
            onClick={clear}
            className="text-xs px-2 py-1.5 rounded border border-gray-700 text-gray-400 hover:text-white"
          >
            키 지우기
          </button>
        )}
        <KeyBadge state={keyState} />
      </div>
      <p className="text-[11px] text-gray-500">
        키는 Vercel 환경변수 <code className="text-gray-300">ADMIN_SECRET</code>(없으면{" "}
        <code className="text-gray-300">REVALIDATE_SECRET</code>)과 같아야 합니다. 비밀번호 칸이라 한글은
        타이핑이 안 되고 붙여넣기만 됩니다. 브라우저 로컬 저장소에만 보관되고 요청 헤더로만 전송됩니다.
      </p>
    </section>
  );
}
