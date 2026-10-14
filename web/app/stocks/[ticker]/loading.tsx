/**
 * 종목 상세 로딩 스켈레톤.
 * 이 파일이 있으면 목록에서 링크를 미리 가져오고(prefetch), 클릭 즉시 화면이 바뀐 뒤
 * 서버 렌더 결과가 스트리밍으로 채워진다 — 캐시가 비어 있는 첫 방문에도 "멈춘 느낌"이 없다.
 */
export default function StockLoading() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="종목 데이터를 불러오는 중">
      <div className="h-3 w-20 bg-gray-800 rounded" />

      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 bg-gray-800 rounded" />
          <div className="space-y-2">
            <div className="h-3 w-16 bg-gray-800 rounded" />
            <div className="h-6 w-56 bg-gray-800 rounded" />
          </div>
        </div>
        <div className="h-5 w-14 bg-gray-800 rounded" />
      </header>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-gray-900 border border-gray-800 rounded p-3 space-y-2">
            <div className="h-2.5 w-16 bg-gray-800 rounded" />
            <div className="h-5 w-24 bg-gray-800 rounded" />
            <div className="h-2.5 w-12 bg-gray-800 rounded" />
          </div>
        ))}
      </section>

      <div className="bg-gray-900 border border-gray-800 rounded p-4 space-y-2">
        <div className="h-3 w-40 bg-gray-800 rounded" />
        <div className="grid grid-cols-12 gap-1 mt-3">
          {Array.from({ length: 12 * 8 }).map((_, i) => (
            <div key={i} className="h-5 bg-gray-800 rounded-sm" />
          ))}
        </div>
      </div>
    </div>
  );
}
