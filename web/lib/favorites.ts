"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "stockcycle.favorites.v1";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(list: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(list));
  // 같은 탭 내 다른 컴포넌트 동기화
  window.dispatchEvent(new CustomEvent("favorites-changed"));
}

/** 관심종목 리스트 + 토글 훅. 여러 컴포넌트가 실시간 동기화. */
export function useFavorites(): {
  favorites: string[];
  isFavorite: (ticker: string) => boolean;
  toggle: (ticker: string) => void;
  clear: () => void;
} {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(read());
    const sync = () => setFavorites(read());
    window.addEventListener("favorites-changed", sync);
    window.addEventListener("storage", sync); // 다른 탭에서 변경 시
    return () => {
      window.removeEventListener("favorites-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const toggle = useCallback((ticker: string) => {
    const current = read();
    const next = current.includes(ticker)
      ? current.filter((t) => t !== ticker)
      : [...current, ticker];
    write(next);
  }, []);

  const clear = useCallback(() => write([]), []);

  const isFavorite = useCallback(
    (ticker: string) => favorites.includes(ticker),
    [favorites]
  );

  return { favorites, isFavorite, toggle, clear };
}
