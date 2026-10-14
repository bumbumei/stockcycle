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

export function adminHeaders(key: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
}
