import Link from "next/link";
import BrandManager from "@/components/BrandManager";
import { adminSecret } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default function BrandsManagePage() {
  const secretConfigured = Boolean(adminSecret());
  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-400 flex items-center gap-3">
        <Link href="/etf" className="hover:text-white">← ETF 트렌드</Link>
        <Link href="/etf/manage" className="hover:text-white">ETF 목록 편집</Link>
      </nav>
      <section>
        <h1 className="text-2xl font-bold mb-1">브랜드 설정 — 접속 주소별 로고·사진</h1>
        <p className="text-gray-400 text-sm">
          회사명·로고·담당자 사진·연락처를 등록하면 공유 주소가 생깁니다. 그 주소로 들어온 사람에게는
          모든 페이지 맨 위에 그 회사의 로고와 담당자 정보가 띠로 표시됩니다. 예:{" "}
          <code className="text-gray-300">/etf?brand=kbsec</code> 또는 짧게{" "}
          <code className="text-gray-300">/b/kbsec</code>. 바꾸려면 관리자 키가 필요합니다.
        </p>
      </section>
      <BrandManager secretConfigured={secretConfigured} />
    </div>
  );
}
