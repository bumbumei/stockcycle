import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "StockCycle — 월별 주식 패턴",
  description: "10년 데이터 기반 월별 상승/하락 확률 분석",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <header className="border-b border-gray-800 bg-gray-900/60 backdrop-blur">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-bold text-lg text-white">
              📈 StockCycle
            </Link>
            <div className="text-xs text-gray-400">
              과거 패턴 참고용 · 투자 권유 아님
            </div>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-6">{children}</main>
        <footer className="max-w-6xl mx-auto px-4 py-6 text-xs text-gray-500">
          데이터: pykrx (한국) · yfinance (미국) · 일별 기준
        </footer>
      </body>
    </html>
  );
}
