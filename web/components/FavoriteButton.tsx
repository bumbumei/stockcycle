"use client";

import { useFavorites } from "@/lib/favorites";

type Props = {
  ticker: string;
  size?: "sm" | "md";
};

export default function FavoriteButton({ ticker, size = "sm" }: Props) {
  const { isFavorite, toggle } = useFavorites();
  const active = isFavorite(ticker);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault(); // Link 안에서 쓸 때 페이지 이동 방지
    e.stopPropagation();
    toggle(ticker);
  };

  const cls =
    size === "md"
      ? "text-2xl px-2 py-1"
      : "text-lg px-1.5 py-0.5";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={active ? "관심종목에서 제거" : "관심종목에 추가"}
      aria-pressed={active}
      title={active ? "관심종목 해제" : "관심종목 등록"}
      className={`${cls} rounded hover:bg-gray-800 transition leading-none ${
        active ? "text-yellow-400" : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {active ? "★" : "☆"}
    </button>
  );
}
