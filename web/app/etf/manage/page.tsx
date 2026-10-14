import Link from "next/link";
import EtfManager from "@/components/EtfManager";
import { adminSecret } from "@/lib/admin";
import { listEtfUniverse } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function EtfManagePage() {
  const { rows, error } = await listEtfUniverse();
  const secretConfigured = Boolean(adminSecret());

  return (
    <div className="space-y-6">
      <nav className="text-xs text-gray-400">
        <Link href="/etf" className="hover:text-white">← ETF 트렌드</Link>
      </nav>
      <section>
        <h1 className="text-2xl font-bold mb-1">ETF 목록 편집</h1>
        <p className="text-gray-400 text-sm">
          ETF 트렌드 유니버스에 들어가는 미국 ETF를 추가·수정·숨김·삭제합니다. 읽기는 누구나 할 수
          있고, 바꾸려면 관리자 키가 필요합니다. 여기서 고친 분류·라벨은 시드 스크립트를 다시
          돌려도 유지됩니다.
        </p>
      </section>
      <EtfManager initial={rows} secretConfigured={secretConfigured} loadError={error} />
    </div>
  );
}
