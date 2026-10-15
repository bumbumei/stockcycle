/**
 * 접속 주소별 브랜드(회사 로고 · 담당자 사진 · 연락처) — 순수 타입·검증 (서버/클라이언트 공용, DB 의존 없음).
 *
 * 쓰는 법
 *   - 아무 페이지나 `?brand=<slug>` 를 붙여 열면 상단에 그 브랜드의 로고·사진·연락처 띠가 뜬다.
 *   - 그 브라우저에서는 이후 페이지 이동에도 유지된다 (localStorage). `?brand=off` 로 해제.
 *   - 짧은 주소 `/b/<slug>` 는 `/etf?brand=<slug>` 로 넘어간다.
 *   - 브랜드는 `/brands/manage` 에서 관리자 키로 추가·수정·삭제. 이미지는 DB 에 base64 로 저장.
 */

export const BRAND_PARAM = "brand";
export const BRAND_STORAGE_KEY = "stockcycle.brand.v1";
export const BRAND_SLUG_RE = /^[a-z0-9][a-z0-9-]{1,31}$/;
/** `?brand=` 에 이 값이 오면 브랜드 해제. */
export const BRAND_OFF_VALUES = new Set(["", "off", "none", "default", "0"]);
const RESERVED_SLUGS = new Set(["off", "none", "default", "manage", "api", "b", "etf", "stocks", "new", "admin"]);

export const BRAND_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"] as const;
/** 디코딩 후 바이트 상한. 로고·사진 각각. */
export const BRAND_IMAGE_MAX_BYTES = 600 * 1024;
export const BRAND_IMAGE_KINDS = ["logo", "photo"] as const;
export type BrandImageKind = (typeof BRAND_IMAGE_KINDS)[number];

export type BrandImagePayload = { type: string; base64: string };

export type BrandFields = {
  slug: string;
  company: string;
  person: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
  tagline: string | null;
  /** 로고 뒤에 흰 배경판을 깔지 (어두운 로고가 다크 테마에서 안 보이는 것 방지). */
  logoPlate: boolean;
  enabled: boolean;
};

/** 공개 API(`/api/brands/[slug]`)가 주는 형태. 이미지는 URL 로만. */
export type BrandPublic = Omit<BrandFields, "enabled"> & {
  logoUrl: string | null;
  photoUrl: string | null;
  updatedAt: string;
};

export type BrandAdminRow = BrandPublic & {
  enabled: boolean;
  createdAt: string;
  logoBytes: number;
  photoBytes: number;
};

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

export function normalizeBrandSlug(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  if (!BRAND_SLUG_RE.test(s) || RESERVED_SLUGS.has(s)) return null;
  return s;
}

export function isBrandOffValue(v: string): boolean {
  return BRAND_OFF_VALUES.has(v.trim().toLowerCase());
}

const TEXT_LIMITS = {
  company: { label: "회사명", max: 60 },
  person: { label: "담당자 이름", max: 40 },
  title: { label: "직함", max: 40 },
  phone: { label: "전화", max: 40 },
  email: { label: "이메일", max: 80 },
  tagline: { label: "한 줄 문구", max: 120 },
} as const;
type TextKey = keyof typeof TEXT_LIMITS;

function cleanText(v: unknown, key: TextKey): ParseResult<string | null> {
  const { label, max } = TEXT_LIMITS[key];
  if (v === null || v === undefined) return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} 형식이 올바르지 않습니다.` };
  const s = v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return { ok: true, value: null };
  if (s.length > max) return { ok: false, error: `${label}: ${max}자 이하여야 합니다.` };
  return { ok: true, value: s };
}

/**
 * 생성/수정 본문 → BrandFields. `opts.slug` 를 주면 본문의 slug 는 무시하고 그 값을 쓴다 (수정).
 */
export function parseBrandFields(body: unknown, opts: { slug?: string } = {}): ParseResult<BrandFields> {
  if (!body || typeof body !== "object") return { ok: false, error: "본문이 올바르지 않습니다." };
  const b = body as Record<string, unknown>;
  const slug = opts.slug ?? normalizeBrandSlug(b.slug);
  if (!slug) {
    return {
      ok: false,
      error: "주소 이름(slug)은 영문 소문자·숫자·하이픈 2~32자여야 합니다 (예: kbsec, abc-1). off/manage 같은 예약어는 쓸 수 없습니다.",
    };
  }
  const texts = {} as Record<TextKey, string | null>;
  for (const key of Object.keys(TEXT_LIMITS) as TextKey[]) {
    const r = cleanText(b[key], key);
    if (!r.ok) return r;
    texts[key] = r.value;
  }
  if (!texts.company) return { ok: false, error: "회사명은 필수입니다." };
  if (texts.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texts.email)) {
    return { ok: false, error: "이메일 형식이 올바르지 않습니다." };
  }
  return {
    ok: true,
    value: {
      slug,
      company: texts.company,
      person: texts.person,
      title: texts.title,
      phone: texts.phone,
      email: texts.email,
      tagline: texts.tagline,
      logoPlate: b.logoPlate === undefined ? true : Boolean(b.logoPlate),
      enabled: b.enabled === undefined ? true : Boolean(b.enabled),
    },
  };
}

/** base64 문자열의 디코딩 후 바이트 수. */
export function base64Bytes(b64: string): number {
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * 이미지 필드 해석.
 *   undefined → 그대로 유지,  null → 삭제,  { type, base64 } → 교체
 */
export function parseBrandImage(v: unknown, kind: BrandImageKind): ParseResult<BrandImagePayload | null | undefined> {
  const label = kind === "logo" ? "로고" : "사진";
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null) return { ok: true, value: null };
  if (!v || typeof v !== "object") return { ok: false, error: `${label} 형식이 올바르지 않습니다.` };
  const { type, base64 } = v as { type?: unknown; base64?: unknown };
  if (typeof type !== "string" || !(BRAND_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `${label}: PNG·JPEG·WebP·GIF·SVG 만 가능합니다.` };
  }
  if (typeof base64 !== "string" || base64.length === 0 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    return { ok: false, error: `${label} 데이터(base64)가 올바르지 않습니다.` };
  }
  const bytes = base64Bytes(base64);
  if (bytes > BRAND_IMAGE_MAX_BYTES) {
    return {
      ok: false,
      error: `${label}: ${Math.round(BRAND_IMAGE_MAX_BYTES / 1024)}KB 이하여야 합니다 (현재 약 ${Math.round(bytes / 1024)}KB).`,
    };
  }
  return { ok: true, value: { type, base64 } };
}

/** 이미지 URL. updatedAt 을 쿼리로 붙여 수정 즉시 캐시가 갈리게 한다. */
export function brandImageUrl(slug: string, kind: BrandImageKind, updatedAt: string): string {
  return `/api/brands/${encodeURIComponent(slug)}/${kind}?v=${encodeURIComponent(updatedAt)}`;
}

export function brandShareUrl(origin: string, slug: string): string {
  return `${origin}/etf?${BRAND_PARAM}=${encodeURIComponent(slug)}`;
}

export function brandShortUrl(origin: string, slug: string): string {
  return `${origin}/b/${encodeURIComponent(slug)}`;
}
