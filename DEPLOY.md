# StockCycle 배포 가이드 — Neon + Vercel + GitHub Actions

전체 흐름:

```
GitHub 리포
  ├─ web/        ──push──►  Vercel (웹 호스팅)
  │                            ↓ read
  ├─ poc/        ──cron──►  GitHub Actions ──write──►  Neon Postgres
  └─ 매크로·가격 수집 (매일 KST 18:30 / 07:30)
```

## 1. Neon Postgres 준비

### 1-1) 프로젝트 생성
1. https://neon.tech 가입 (GitHub 계정 연동 가능)
2. "Create Project" → 리전: **AWS ap-northeast-1 (Tokyo)** 권장 (한국 지연 최소)
3. 생성 직후 나오는 **Connection string** 복사:
   ```
   postgresql://<user>:<pw>@<host>/neondb?sslmode=require
   ```

### 1-2) 스키마 생성 + 데이터 이관 (로컬 PC에서 1회)

```bash
cd poc
# Windows PowerShell
$env:DATABASE_URL="postgresql://user:pw@host/neondb?sslmode=require"
# macOS/Linux
# export DATABASE_URL="postgresql://user:pw@host/neondb?sslmode=require"

./.venv/Scripts/python.exe -m pip install "psycopg[binary]"
./.venv/Scripts/python.exe migrate_to_postgres.py
```

출력 예:
```
[1/2] 스키마 생성: schema_postgres.sql
      ✓ 테이블 생성 완료
[2/2] 데이터 복사: stock.db
  tickers:         6 rows
  daily_prices: 14874 rows
  macro_indicators: 12660 rows
  ingestion_log:   10 rows
[검증] 행 수 비교
  table                    sqlite   postgres  match
  -------------------- ---------- ----------  -----
  tickers                       6          6  ✓
  daily_prices             14,874     14,874  ✓
  macro_indicators         12,660     12,660  ✓
  ingestion_log                10         10  ✓
[OK] 마이그레이션 완료
```

## 2. Vercel 배포

### 2-1) GitHub에 푸시
```bash
cd StockCycle
git init
git add .
git commit -m "initial: stockcycle web + poc"
gh repo create stockcycle --public --source=. --push
```

> 비공개로 하려면 `--private`. Vercel Hobby 플랜은 공개/비공개 둘 다 무료.

### 2-2) Vercel 프로젝트 생성
1. https://vercel.com 로그인 → "Add New Project"
2. GitHub 리포 선택 → `stockcycle`
3. **중요 설정**:
   - **Root Directory**: `web`  ← 꼭 지정 (모노레포 구조)
   - **Framework Preset**: Next.js (자동 감지)
4. **Environment Variables**에 추가:
   ```
   DATABASE_URL = postgresql://user:pw@host/neondb?sslmode=require
   ADMIN_SECRET = <긴 임의 문자열>   # /etf/manage ETF 목록 편집기의 관리자 키 (없으면 REVALIDATE_SECRET 사용)
   ```
5. "Deploy" 클릭 → 약 1~2분 후 `https://<proj>.vercel.app` 배포 완료

### 2-3) 동작 확인
- `/` — 종목 카드 목록 표시
- `/stocks/005930` — 히트맵 렌더링
- `/etf` — 미국 ETF 트렌드 (Actions 에서 `seed-etf-us` 1회 실행 후 데이터 표시)
- `/etf/manage` — ETF 목록 편집 (관리자 키 입력 후 추가·수정·숨김·삭제)
- `/api/tickers` — JSON 응답

## 3. GitHub Actions 일일 자동 수집

**이미 설정되어 있음** → `.github/workflows/ingest.yml`.
`DATABASE_URL` Secret만 등록하면 매일 자동 실행.

### 3-1) 리포에 Secret 등록
리포 → Settings → Secrets and variables → Actions → New repository secret
```
Name : DATABASE_URL
Value: postgresql://user:pw@host/neondb?sslmode=require
```

### 3-2) 동작 원리

`poc/db.py`가 `DATABASE_URL` 환경변수를 감지:
- **설정됨** → `PgConnWrapper`로 Postgres에 직접 쓰기 (psycopg3)
- **없음** → 로컬 `stock.db` SQLite 사용

`?` 플레이스홀더는 자동으로 `%s`로 치환되어 **기존 backfill/incremental 코드는 한 줄도 변경되지 않음**.

### 3-3) 실행 스케줄

| 시간 (KST) | 시간 (UTC) | 트리거 | 대상 |
|-----------|------------|--------|------|
| 월~금 18:30 | 09:30 | cron | 한국 장 마감 데이터 + 매크로 |
| 화~토 07:30 | 22:30 | cron | 미국 장 마감 데이터 + 매크로 |
| 수동 | — | workflow_dispatch | 백필/증분 모드 선택 가능 |

### 3-4) 첫 운영 플로우

```
[로컬 PC, 1회만]
1. python db.py                        # stock.db 생성
2. python backfill.py   --years 10 --market KOSPI --top 50
3. python backfill_us.py --years 10 --preset sp500_top50
4. python backfill_macro.py --years 10

[로컬 PC → Neon 이관, 1회]
5. export DATABASE_URL=...
6. python migrate_to_postgres.py

[GitHub]
7. Secret에 DATABASE_URL 등록
8. push → Actions 자동 활성화
9. (선택) Actions 탭에서 Run workflow → 동작 확인
```

### 3-5) 수동 실행 (Actions 탭)

`Run workflow` 버튼으로 다음 모드 선택 가능:
- `incremental` — 기본 증분 (한/미/매크로 모두)
- `backfill-kr-top50` — 한국 시총 50위 10년 전체 재수집
- `backfill-us-sp50` — S&P500 상위 50 10년 전체 재수집
- `backfill-macro` — 매크로 5지표 10년 전체 재수집
- `seed-etf-us` — 미국 ETF 유니버스(`poc/tickers_etf_us.tsv`, 100개) 메타 동기화 + 누락 티커 백필.
  `/etf` ETF 트렌드 페이지를 처음 켤 때 1회 실행 (재실행해도 안전, 이미 수집된 티커는 건너뜀)

### 3-6) 모니터링

각 실행 끝에 `Summary` 스텝이 행 수 요약을 출력:
```
tickers                       56 rows
daily_prices             141,234 rows
macro_indicators          12,710 rows
ingestion_log                842 rows
latest daily_prices date: 2026-04-17
```

`ingestion_log` 테이블에 실패한 티커가 기록되므로, SQL 한 줄로 확인 가능:
```sql
SELECT ticker, from_date, to_date, error_msg
FROM ingestion_log
WHERE status = 'error' AND created_at > NOW() - INTERVAL '1 day';
```

## 4. 로컬 개발 vs 프로덕션 전환

| 환경 | `DATABASE_URL` | 어느 DB | 비고 |
|------|---------------|---------|------|
| 로컬 개발 | **설정 안 함** | `poc/stock.db` (SQLite) | 빠른 반복, Python 파이프라인 그대로 |
| Vercel 프로덕션 | Neon URL | Postgres | 이관된 스냅샷 |
| 로컬에서 프로덕션 DB 테스트 | `.env.local`에 Neon URL | Postgres | 배포 전 동일 동작 확인용 |

`web/.env.local` 예시:
```
DATABASE_URL=postgresql://user:pw@host/neondb?sslmode=require
```
> `.gitignore`에 `.env*.local` 이미 포함됨.

## 5. 비용 예상

| 서비스 | 사용량 | 비용 |
|--------|--------|------|
| Neon Postgres | 0.5GB 스토리지 + 월 10GB 전송 | **$0** (Free tier) |
| Vercel Hobby | 100GB 대역폭/월, 무제한 배포 | **$0** |
| GitHub Actions | Public repo 무제한 / Private 2000분/월 | **$0** |
| **합계** | | **$0/월** |

트래픽이 크게 늘어날 경우:
- Neon Pro: $19/월 (스토리지 10GB, 오토스케일)
- Vercel Pro: $20/월 (상업적 이용)

## 6. 트러블슈팅

### "Unable to connect to database" on Vercel
- `DATABASE_URL`에 `?sslmode=require` 가 있는지 확인
- Neon은 IP 허용목록 없음 → 네트워크 정책 설정 불필요

### 빌드 시 `node:sqlite` 오류
- Vercel은 Node 22+ 이미지 사용 → `node:sqlite` 가 없을 수 있으나,
  프로덕션에서는 `DATABASE_URL` 분기로 sqlite 경로가 호출되지 않음.
- 빌드 자체가 실패한다면 `lib/db.ts` 상단 import를 dynamic import로 감싸기.

### 날짜/숫자가 string으로 나옴
- node-postgres는 `NUMERIC`을 string으로 반환 → `queries.ts`의 `Number(...)` 정규화가 이미 처리함.
- 새 쿼리 추가 시 동일 패턴 적용 필요.

### 페이지가 느리다 (특히 종목 상세 첫 클릭)
- 서버 함수 리전과 DB 리전이 멀면 DB 왕복마다 200ms+ 가 든다. 실측(2026-10): Vercel 기본 리전
  iad1(미국 동부) ↔ Neon ap-southeast-1(싱가포르) 왕복 218ms, 연결 수립 1.4초.
- `web/vercel.json` 의 `"regions": ["sin1"]` 이 서버 함수를 싱가포르에서 돌게 한다 (Hobby 플랜도 리전 1개 선택 가능).
  Neon 프로젝트를 다른 리전에 만들었다면 그 리전 코드로 바꿀 것 (Tokyo = `hnd1`).
- 종목 상세는 1시간 ISR 캐시 + DB 왕복 1회로 바뀌었고, `/api/stocks/<티커>/monthly?debug=1` 로 서버 처리 시간을 분해해 볼 수 있다.
- Neon 무료 플랜은 5분 쉬면 컴퓨트가 잠들어 첫 요청이 1~3초 느리다. 서버리스에서는 `DATABASE_URL` 을
  **pooled 엔드포인트**(호스트명에 `-pooler` 가 붙은 주소, Neon 콘솔 → Connection Details → "Pooled connection")로
  쓰면 연결 수립이 더 빠르다.

## 7. 다음 단계

- [x] ~~Python 파이프라인 Postgres 직접 쓰기~~ → `db.py` 어댑터로 완료
- [x] ~~GitHub Actions cron workflow~~ → `.github/workflows/ingest.yml`
- [ ] Vercel `unstable_cache` / ISR로 응답 캐싱
- [ ] Neon Branching으로 PR 프리뷰별 DB 스냅샷
- [ ] 커스텀 도메인 연결 (Vercel 무료)
- [ ] 종목 검색바 (자동완성) UI
- [ ] 마지막 업데이트 시각 배지 (ingestion_log 기반)
