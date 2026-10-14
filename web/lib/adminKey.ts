"use client";

/** 관리자 키를 브라우저(localStorage)에 보관. 서버로는 Authorization 헤더로만 보낸다. */
const KEY = "stockcycle.adminKey.v1";

export function readAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeAdminKey(key: string): void {
  if (typeof window === "undefined") return;
  try {
    if (key) window.localStorage.setItem(KEY, key);
    else window.localStorage.removeItem(KEY);
  } catch {
    /* 사생활 보호 모드 등 — 세션 동안만 메모리에 유지 */
  }
}

/**
 * HTTP 헤더에는 Latin-1 범위 밖 문자(한글 등)를 넣을 수 없어서 (브라우저 fetch 가 TypeError)
 * 키를 URL 인코딩해 보낸다. 서버(lib/admin.ts)가 다시 디코딩해 비교한다.
 * ASCII 키는 인코딩해도 거의 그대로이므로 기존 키와 호환된다.
 */
export function adminHeaders(key: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${encodeURIComponent(key.normalize("NFC"))}`,
  };
}
