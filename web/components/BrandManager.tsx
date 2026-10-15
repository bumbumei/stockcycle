"use client";

/**
 * 브랜드(접속 주소별 회사 로고·담당자 사진) 편집기 — /brands/manage
 * 목록은 관리자 키가 맞을 때만 불러온다 (거래처 목록은 공개하지 않음).
 */
import { useCallback, useEffect, useState } from "react";
import AdminKeyPanel, { useAdminKey } from "@/components/AdminKeyPanel";
import {
  BRAND_IMAGE_MAX_BYTES,
  BrandAdminRow,
  BrandImageKind,
  BrandImagePayload,
  brandShareUrl,
  brandShortUrl,
  normalizeBrandSlug,
} from "@/lib/brand";
import { fileToBrandImage, payloadToDataUrl } from "@/lib/brandImage";

type ImgDraft =
  | { state: "keep"; preview: string | null }
  | { state: "remove"; preview: null }
  | { state: "new"; preview: string; payload: BrandImagePayload };

type Draft = {
  slug: string;
  company: string;
  person: string;
  title: string;
  phone: string;
  email: string;
  tagline: string;
  logoPlate: boolean;
  enabled: boolean;
  logo: ImgDraft;
  photo: ImgDraft;
};

const EMPTY: Draft = {
  slug: "",
  company: "",
  person: "",
  title: "",
  phone: "",
  email: "",
  tagline: "",
  logoPlate: true,
  enabled: true,
  logo: { state: "keep", preview: null },
  photo: { state: "keep", preview: null },
};

function draftFromRow(b: BrandAdminRow): Draft {
  return {
    slug: b.slug,
    company: b.company,
    person: b.person ?? "",
    title: b.title ?? "",
    phone: b.phone ?? "",
    email: b.email ?? "",
    tagline: b.tagline ?? "",
    logoPlate: b.logoPlate,
    enabled: b.enabled,
    logo: { state: "keep", preview: b.logoUrl },
    photo: { state: "keep", preview: b.photoUrl },
  };
}

function imgToBody(d: ImgDraft): BrandImagePayload | null | undefined {
  if (d.state === "new") return d.payload;
  if (d.state === "remove") return null;
  return undefined;
}

function draftToBody(d: Draft, isNew: boolean) {
  return {
    ...(isNew ? { slug: d.slug.trim().toLowerCase() } : {}),
    company: d.company,
    person: d.person,
    title: d.title,
    phone: d.phone,
    email: d.email,
    tagline: d.tagline,
    logoPlate: d.logoPlate,
    enabled: d.enabled,
    logo: imgToBody(d.logo),
    photo: imgToBody(d.photo),
  };
}

function kb(n: number): string {
  return n >= 1024 ? `${Math.round(n / 1024)}KB` : `${n}B`;
}

export default function BrandManager({ secretConfigured }: { secretConfigured: boolean }) {
  const admin = useAdminKey(secretConfigured);
  const [rows, setRows] = useState<BrandAdminRow[] | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ draft: Draft; isNew: boolean } | null>(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => setOrigin(window.location.origin), []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/brands", { cache: "no-store", headers: admin.headers() });
      const j = (await r.json().catch(() => ({}))) as { rows?: BrandAdminRow[]; error?: string };
      if (!r.ok) {
        if (r.status === 401) admin.setKeyState("bad");
        setMessage({ kind: "err", text: j.error ?? `목록 조회 실패 (${r.status})` });
        return;
      }
      setRows(j.rows ?? []);
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin.key]);

  useEffect(() => {
    if (admin.canWrite) void refresh();
    else setRows(null);
  }, [admin.canWrite, refresh]);

  const call = async (url: string, init: RequestInit): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch(url, { ...init, headers: admin.headers() });
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) {
        if (r.status === 401) admin.setKeyState("bad");
        setMessage({ kind: "err", text: String(j.error ?? `요청 실패 (${r.status})`) });
        return null;
      }
      await refresh();
      return j;
    } catch (e) {
      setMessage({ kind: "err", text: String(e) });
      return null;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!editing) return;
    const { draft, isNew } = editing;
    if (isNew && !normalizeBrandSlug(draft.slug)) {
      setMessage({ kind: "err", text: "주소 이름은 영문 소문자·숫자·하이픈 2~32자 (예: kbsec)." });
      return;
    }
    if (!draft.company.trim()) {
      setMessage({ kind: "err", text: "회사명을 입력하세요." });
      return;
    }
    const url = isNew ? "/api/brands" : `/api/brands/${encodeURIComponent(draft.slug)}`;
    const j = await call(url, { method: isNew ? "POST" : "PUT", body: JSON.stringify(draftToBody(draft, isNew)) });
    if (j) {
      setMessage({ kind: "ok", text: isNew ? `'${draft.slug}' 브랜드를 만들었습니다.` : `'${draft.slug}' 저장했습니다.` });
      setEditing(null);
    }
  };

  const remove = async (b: BrandAdminRow) => {
    if (!window.confirm(`'${b.company}' (${b.slug}) 브랜드를 삭제합니다. 로고·사진도 함께 지워지며 되돌릴 수 없습니다.\n\n정말 삭제할까요?`)) return;
    const j = await call(`/api/brands/${encodeURIComponent(b.slug)}`, { method: "DELETE" });
    if (j) setMessage({ kind: "ok", text: `'${b.slug}' 삭제했습니다.` });
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setMessage({ kind: "ok", text: "주소를 복사했습니다." });
    } catch {
      window.prompt("복사할 주소", text);
    }
  };

  return (
    <div className="space-y-5">
      <AdminKeyPanel admin={admin} />

      {message && (
        <div
          className={`text-sm rounded px-3 py-2 border break-words ${
            message.kind === "ok"
              ? "bg-green-500/10 border-green-700/60 text-green-200"
              : "bg-red-500/10 border-red-600/60 text-red-300"
          }`}
        >
          {message.text}
        </div>
      )}

      {!admin.canWrite ? (
        <p className="text-sm text-gray-500">관리자 키를 확인하면 브랜드 목록이 나타납니다.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">브랜드 {rows ? `${rows.length}개` : ""}</h2>
            <button
              type="button"
              onClick={() => setEditing({ draft: EMPTY, isNew: true })}
              disabled={busy || Boolean(editing)}
              className="text-xs px-3 py-1.5 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 hover:bg-amber-400 transition"
            >
              + 브랜드 추가
            </button>
          </div>

          {editing && (
            <BrandForm
              draft={editing.draft}
              isNew={editing.isNew}
              busy={busy}
              onChange={(d) => setEditing({ ...editing, draft: d })}
              onCancel={() => setEditing(null)}
              onSave={() => void save()}
              onError={(t) => setMessage({ kind: "err", text: t })}
            />
          )}

          {rows && rows.length === 0 && !editing && (
            <p className="text-sm text-gray-500">
              아직 브랜드가 없습니다. &ldquo;브랜드 추가&rdquo;로 회사명·로고·담당자 사진을 넣으면 공유 주소가 생깁니다.
            </p>
          )}

          <ul className="space-y-3">
            {(rows ?? []).map((b) => (
              <li key={b.slug} className="bg-gray-900 border border-gray-800 rounded p-3 space-y-2">
                <div className="flex flex-wrap items-center gap-3">
                  {b.logoUrl ? (
                    <span className={`inline-flex items-center rounded ${b.logoPlate ? "bg-white px-2 py-1" : ""}`}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={b.logoUrl} alt={b.company} className="h-8 w-auto max-w-[140px] object-contain" />
                    </span>
                  ) : (
                    <span className="text-[11px] text-gray-600 border border-dashed border-gray-700 rounded px-2 py-1">로고 없음</span>
                  )}
                  {b.photoUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={b.photoUrl} alt={b.person ?? ""} className="h-10 w-10 rounded-full object-cover border border-gray-700" />
                  ) : (
                    <span className="h-10 w-10 rounded-full border border-dashed border-gray-700 inline-flex items-center justify-center text-[10px] text-gray-600">사진</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-white flex items-center gap-2 flex-wrap">
                      {b.company}
                      <code className="text-[11px] text-amber-300">{b.slug}</code>
                      {!b.enabled && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full border border-gray-700 text-gray-400">사용 안 함</span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {[b.person, b.title].filter(Boolean).join(" ")}
                      {(b.phone || b.email) && ` · ${[b.phone, b.email].filter(Boolean).join(" · ")}`}
                      {b.tagline && ` · ${b.tagline}`}
                    </div>
                    <div className="text-[11px] text-gray-600">
                      로고 {b.logoUrl ? kb(b.logoBytes) : "–"} · 사진 {b.photoUrl ? kb(b.photoBytes) : "–"} · 수정{" "}
                      {b.updatedAt.slice(0, 16).replace("T", " ")}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={`/etf?brand=${encodeURIComponent(b.slug)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500"
                    >
                      미리보기
                    </a>
                    <button
                      type="button"
                      onClick={() => setEditing({ draft: draftFromRow(b), isNew: false })}
                      disabled={busy || Boolean(editing)}
                      className="text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-40"
                    >
                      편집
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove(b)}
                      disabled={busy}
                      className="text-xs px-2 py-1 rounded border border-red-900/60 text-red-300 hover:bg-red-500/10 disabled:opacity-40"
                    >
                      삭제
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="text-gray-500">공유 주소</span>
                  {[brandShortUrl(origin, b.slug), brandShareUrl(origin, b.slug)].map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => void copy(u)}
                      title="클릭하면 복사"
                      className="font-mono px-2 py-0.5 rounded bg-gray-950 border border-gray-800 text-gray-300 hover:text-white hover:border-gray-600"
                    >
                      {u.replace(/^https?:\/\//, "")}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>

          <div className="text-[11px] text-gray-500 space-y-1">
            <p>
              공유 주소로 들어온 브라우저는 이후 다른 페이지로 옮겨도 같은 브랜드 띠를 유지합니다.
              띠를 없애려면 아무 페이지에 <code className="text-gray-300">?brand=off</code> 를 붙여 한 번 열면 됩니다.
            </p>
            <p>
              이미지는 서버 DB 에 저장되며 로고·사진 각각 {Math.round(BRAND_IMAGE_MAX_BYTES / 1024)}KB 까지입니다.
              큰 사진은 브라우저에서 자동으로 줄여서 올립니다.
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function BrandForm({
  draft,
  isNew,
  busy,
  onChange,
  onCancel,
  onSave,
  onError,
}: {
  draft: Draft;
  isNew: boolean;
  busy: boolean;
  onChange: (d: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
  onError: (text: string) => void;
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v });
  const field =
    "w-full bg-gray-950 border border-gray-800 rounded px-3 py-1.5 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-gray-600";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
      className="bg-gray-900 border border-amber-700/40 rounded p-4 space-y-3"
    >
      <div className="text-sm font-semibold text-white">{isNew ? "브랜드 추가" : `'${draft.slug}' 편집`}</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-gray-400 space-y-1">
          <span>주소 이름 (slug) {isNew && <span className="text-amber-300">*</span>}</span>
          <input
            value={draft.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
            disabled={!isNew}
            placeholder="예: kbsec (영문 소문자·숫자·하이픈)"
            className={`${field} disabled:opacity-50 font-mono`}
            autoComplete="off"
          />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>회사명 <span className="text-amber-300">*</span></span>
          <input value={draft.company} onChange={(e) => set("company", e.target.value)} placeholder="예: OO증권 강남지점" className={field} />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>담당자 이름</span>
          <input value={draft.person} onChange={(e) => set("person", e.target.value)} placeholder="예: 홍길동" className={field} />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>직함</span>
          <input value={draft.title} onChange={(e) => set("title", e.target.value)} placeholder="예: PB 팀장" className={field} />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>전화</span>
          <input value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="예: 010-1234-5678" className={field} />
        </label>
        <label className="text-xs text-gray-400 space-y-1">
          <span>이메일</span>
          <input value={draft.email} onChange={(e) => set("email", e.target.value)} placeholder="예: hong@example.com" className={field} type="email" />
        </label>
        <label className="text-xs text-gray-400 space-y-1 sm:col-span-2">
          <span>한 줄 문구</span>
          <input value={draft.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="예: 글로벌 ETF 투자 길잡이" className={field} />
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ImagePicker
          kind="logo"
          label="회사 로고"
          hint="PNG·SVG 권장, 가로형. 800px 로 줄여 저장"
          draft={draft.logo}
          plate={draft.logoPlate}
          onChange={(d) => set("logo", d)}
          onError={onError}
        />
        <ImagePicker
          kind="photo"
          label="담당자 사진"
          hint="정사각형에 가까운 사진. 512px 로 줄여 저장"
          draft={draft.photo}
          plate={false}
          onChange={(d) => set("photo", d)}
          onError={onError}
        />
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-gray-400">
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={draft.logoPlate} onChange={(e) => set("logoPlate", e.target.checked)} />
          로고 뒤에 흰 배경판 (어두운 로고용)
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="checkbox" checked={draft.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          사용 (끄면 공유 주소로 들어와도 띠가 안 보임)
        </label>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded bg-amber-500 text-gray-900 font-semibold disabled:opacity-40 hover:bg-amber-400 transition"
        >
          {busy ? "저장 중..." : "저장"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="text-xs px-3 py-1.5 rounded border border-gray-700 text-gray-300 hover:text-white">
          취소
        </button>
      </div>
    </form>
  );
}

function ImagePicker({
  kind,
  label,
  hint,
  draft,
  plate,
  onChange,
  onError,
}: {
  kind: BrandImageKind;
  label: string;
  hint: string;
  draft: ImgDraft;
  plate: boolean;
  onChange: (d: ImgDraft) => void;
  onError: (text: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const inputId = `brand-${kind}-file`;

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setLoading(true);
    try {
      const payload = await fileToBrandImage(file, kind);
      onChange({ state: "new", preview: payloadToDataUrl(payload), payload });
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const round = kind === "photo";
  return (
    <div className="bg-gray-950 border border-gray-800 rounded p-3 space-y-2">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="flex items-center gap-3">
        <div
          className={`shrink-0 inline-flex items-center justify-center overflow-hidden ${
            round ? "h-16 w-16 rounded-full" : "h-12 min-w-[6rem] rounded px-2"
          } ${draft.preview ? (plate && !round ? "bg-white" : "bg-gray-900") : "border border-dashed border-gray-700"}`}
        >
          {draft.preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={draft.preview} alt="" className={round ? "h-full w-full object-cover" : "h-10 w-auto max-w-[140px] object-contain"} />
          ) : (
            <span className="text-[10px] text-gray-600">없음</span>
          )}
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor={inputId}
            className="inline-block text-xs px-2 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 cursor-pointer"
          >
            {loading ? "읽는 중..." : draft.preview ? "다른 파일 선택" : "파일 선택"}
          </label>
          <input
            id={inputId}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="sr-only"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {draft.preview && (
            <button
              type="button"
              onClick={() => onChange({ state: "remove", preview: null })}
              className="block text-[11px] text-red-300 hover:underline"
            >
              이미지 제거
            </button>
          )}
          <div className="text-[10px] text-gray-600">{hint}</div>
        </div>
      </div>
    </div>
  );
}
