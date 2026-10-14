"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "월별 패턴", match: (p: string) => p === "/" || p.startsWith("/stocks") },
  { href: "/etf", label: "ETF 트렌드", match: (p: string) => p.startsWith("/etf") },
];

export default function NavTabs() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex items-center gap-1 text-xs" aria-label="주요 메뉴">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={`px-2.5 py-1 rounded border transition ${
              active
                ? "bg-gray-800 border-gray-600 text-white"
                : "border-transparent text-gray-400 hover:text-white hover:border-gray-700"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
