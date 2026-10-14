# StockCycle Web — Next.js 15 + App Router

월별 주식 상승/하락 패턴을 시각화하는 웹서비스 프로토타입.

## 아키텍처

```
┌──────────────────────────────────────────────────┐
│  Next.js 15 (App Router, TypeScript, Tailwind)   │
│  ├─ Server Components → DB 직접 조회              │
│  ├─ API Routes       → /api/tickers, /api/stocks │
│  └─ node:sqlite      → ../poc/stock.db 읽기       │
└──────────────────────────────────────────────────┘
                        ↓ (read-only)
┌──────────────────────────────────────────────────┐
│  poc/stock.db (SQLite)                           │
│  ← Python 파이프라인 (pykrx + yfinance)           │
└──────────────────────────────────────────────────┘
```

**기술 선택 근거**: ML 실험(Δ = -9.09%p)에서 XGBoost가 베이스라인 대비 우위
없음이 확인되어, Python 백엔드 없이 **Next.js 풀스택으로 단순화**. 데이터 수집만
Python 배치로 유지.

## 디렉토리

```
web/
├── app/
│   ├── layout.tsx              # 공통 레이아웃
│   ├── page.tsx                # 홈 — 종목 목록
│   ├── globals.css             # Tailwind + 다크 테마
│   ├── stocks/[ticker]/
│   │   └── page.tsx            # 종목 상세 + 히트맵
│   └── api/
│       ├── tickers/route.ts    # GET /api/tickers?q=
│       └── stocks/[ticker]/monthly/route.ts
├── components/
│   └── Heatmap.tsx             # 연×월 히트맵 + 상승확률 바
├── lib/
│   ├── db.ts                   # node:sqlite 커넥션 (싱글턴)
│   └── queries.ts              # SQL 쿼리 모음
├── package.json
├── tsconfig.json
├── next.config.js
├── tailwind.config.ts
└── postcss.config.js
```

## 실행

**전제**: `poc/stock.db`가 있어야 함. 없다면 먼저:

```bash
cd ../poc
python db.py
python backfill.py --years 10 --tickers 005930 000660 035420
python backfill_us.py --years 10 --tickers AAPL MSFT NVDA
```

**Web 실행:**

```bash
cd web
npm install
npm run dev
# http://localhost:3000
```

## 주요 기능

- **홈 `/`** — 등록된 종목 카드 그리드 (한국/미국 혼합)
- **미국 ETF 트렌드 `/etf`** — `market='US_ETF'` 유니버스(기본 100개, `poc/tickers_etf_us.tsv`)의
  기간별(1주·1개월·2개월·3개월·6개월·1년·2년·3년) 수익률 **Top 10 / Worst 10**
  - 분류(시장대표/섹터/테마/국가/원자재/리츠) 필터, ★ 관심 ETF만 보기
  - 전체 표: 전일 대비 · 추세(50/200일선) · 변동성 · 위험조정 수익률 · 1년 최대낙폭 ·
    52주 고점 대비 · 3년 가격 위치 · 총보수 · 배당 주기, 분류별 묶기
  - 분석: 매크로 환경(VIX/미 10년물/달러인덱스/WTI/원달러 + 1주·1개월 변동), 시장 폭(이평선 위 비율),
    분류별 동일가중 평균 수익률(로테이션), 시그널(52주 신고가·신저가 근접, 저점 반등, 추세 전환 초기),
    순위 변동(▲▼, 7일 전 스냅샷 대비), 위험조정(수익률 ÷ 기간 변동성) 랭킹 모드
  - "주간 리포트 복사": 기존 주간알람 시트 포맷(1개월 + 3개월 Top/Worst 10) 텍스트
  - 로직: `lib/etf.ts`(순수 헬퍼·분석) + `lib/queries.ts#etfTrend / #macroSnapshot`(SQL) +
    `components/EtfTrend.tsx`
- **ETF 목록 편집 `/etf/manage`** — 유니버스 ETF 추가·수정(이름/분류/라벨/운용사/수수료/배당/설명)·
  숨김/복구·완전 삭제. 읽기는 공개, 쓰기는 `ADMIN_SECRET`(없으면 `REVALIDATE_SECRET`) 키를
  `Authorization: Bearer` 로 보내야 한다. 키는 브라우저 localStorage 에만 저장.
  - API: `GET/POST /api/etf/universe`, `PUT/PATCH/DELETE /api/etf/universe/[ticker]`,
    `POST /api/admin/verify`
  - 숨김 = `etf_meta.hidden=1` → `/etf` 집계에서만 제외(수집·홈 표시 유지). 삭제 = 가격·메타·대기열·티커 제거.
  - 시드 스크립트(`poc/seed_etf_us.py`)는 기본적으로 없는 티커만 추가하므로 편집 내용이 보존됨.
- **종목 상세 `/stocks/[ticker]`**
  - 4 요약 카드: 데이터 기간 / 평균 상승확률 / 최강 월 / 최약 월
  - **연×월 히트맵**: 색상으로 수익률 시각화 (녹색=상승, 빨강=하락)
  - **월별 상승확률 바**: 12개월 각각의 10년 평균 상승 확률
- **API**
  - `GET /api/tickers` — 전체 종목
  - `GET /api/tickers?q=삼성` — 검색
  - `GET /api/stocks/005930/monthly` — 월별 집계 + 원시 수익률
  - `GET /api/etf/trend` — 미국 ETF 기간별 수익률 (`/etf` 페이지와 동일 데이터)

## 핵심 결정

| 결정 | 이유 |
|------|------|
| Next.js 풀스택 | ML 불필요 (Δ=-9.09%p) → Python API 분리 불필요 |
| `node:sqlite` (내장) | Windows에서 `better-sqlite3` 네이티브 컴파일 불가 (VS 미설치) |
| 읽기 전용 SQLite 공유 | PoC 단계에서 Python/Node 별도 커넥션 간섭 없음 |
| Server Components | DB 쿼리를 서버에서 실행, 클라이언트 번들 최소화 |
| "투자 권유 아님" 푸터/푸테이지 | 규제(B1) 리스크 관리 |

## 확장 방향

1. **검색바 컴포넌트** — 자동완성 (DS1, Designer 제안)
2. **종목 비교 뷰** — 두 종목 월별 패턴 나란히 (아이디어 6)
3. **데이터 품질 배지** — 결측/휴장 시각 표시 (DS5)
4. **Postgres 이관** — SQLite → Neon/Supabase (프로덕션 대응)
5. **증분 수집 결과 표시** — 마지막 업데이트 시각, ingestion_log 노출
6. **캐싱** — Next.js `unstable_cache` 또는 ISR로 1일 TTL
