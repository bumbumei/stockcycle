"use client";

/**
 * 접속 주소별 브랜드 띠 — 레이아웃 최상단.
 *
 * `?brand=<slug>` 가 붙은 주소로 들어오면 그 slug 를 localStorage 에 기억하고 /api/brands/<slug> 를
 * 불러 로고·사진·연락처를 띄운다. 이후 페이지 이동에도 유지. `?brand=off` 면 해제.
 * 서버 컴포넌트(ISR 페이지)는 건드리지 않고 브라우저에서만 동작하므로 캐시 성능에 영향이 없다.
 */
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BRAND_PARAM, BRAND_STORAGE_KEY, BrandPublic, isBrandOffValue, normalizeBrandSlug } from "@/lib/brand";

function readStored(): string | null {
  try {
    return window.localStorage.getItem(BRAND_STORAGE_KEY);
  } catch {
    return null;
  }
}
function writeStored(slug: string | null) {
  try {
    if (slug) window.localStorage.setItem(BRAND_STORAGE_KEY, slug);
    else window.localStorage.removeItem(BRAND_STORAGE_KEY);
  } catch {
    /* 사생활 보호 모드 등 */
  }
}

/** 현재 주소와 저장값으로 보여줄 slug 결정. 주소의 파라미터가 저장값보다 우선. */
export function resolveBrandSlug(search: string, stored: string | null): string | null {
  const p = new URLSearchParams(search).get(BRAND_PARAM);
  if (p === null) return stored;
  if (isBrandOffValue(p)) return null;
  return normalizeBrandSlug(p) ?? stored;
}

export default function BrandBar() {
  const pathname = usePathname();
  const [brand, setBrand] = useState<BrandPublic | null>(null);

  useEffect(() => {
    const slug = resolveBrandSlug(window.location.search, readStored());
    writeStored(slug);
    if (!slug) {
      setBrand(null);
      return;
    }
    if (brand && brand.slug === slug) return; // 같은 브랜드면 다시 안 부름
    let cancelled = false;
    fetch(`/api/brands/${encodeURIComponent(slug)}`)
      .then(async (r) => (r.ok ? ((await r.json()) as BrandPublic) : null))
      .then((b) => {
        if (cancelled) return;
        if (!b) writeStored(null); // 없어진 브랜드면 기억도 지움
        setBrand(b);
      })
      .catch(() => {
        /* 네트워크 오류 — 띠만 안 보임 */
      });
    return () => {
      cancelled = true;
    };
    // pathname 이 바뀔 때마다 주소의 ?brand= 를 다시 본다 (클라이언트 내비게이션 포함)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  if (!brand) return null;

  const contact = [brand.phone, brand.email].filter(Boolean).join(" · ");
  const who = [brand.person, brand.title].filter(Boolean).join(" ");

  return (
    <div className="border-b border-gray-800 bg-gray-950/80" data-brand={brand.slug}>
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {brand.logoUrl && (
            <span
              className={`inline-flex items-center justify-center rounded shrink-0 ${
                brand.logoPlate ? "bg-white px-2 py-1" : ""
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={brand.logoUrl} alt={brand.company} className="h-8 w-auto max-w-[160px] object-contain" />
            </span>
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white truncate">{brand.company}</div>
            {brand.tagline && <div className="text-[11px] text-gray-400 truncate">{brand.tagline}</div>}
          </div>
        </div>
        {(brand.photoUrl || who || contact) && (
          <div className="flex items-center gap-2 shrink-0">
            {(who || contact) && (
              /* 좁은 화면에서는 사진만 남기고 회사명 자리를 확보 */
              <div className="hidden sm:block text-right leading-tight">
                {who && <div className="text-xs font-medium text-white">{who}</div>}
                {contact && <div className="text-[11px] text-gray-400">{contact}</div>}
              </div>
            )}
            {brand.photoUrl && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={brand.photoUrl}
                alt={brand.person ?? "담당자"}
                className="h-10 w-10 rounded-full object-cover border border-gray-700 bg-gray-800"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
