# StockCycle PoC — 10년 주식 데이터 백필 & 분석

Google Sheets(GOOGLEFINANCE) 기반 프로토타입을 웹서비스로 전환하기 위한 **데이터 파이프라인 PoC**.

## 구성

```
poc/
├── requirements.txt   # 의존성
├── db.py              # SQLite 스키마 & 초기화
├── backfill.py        # 한국 주식 10년 백필 (pykrx)
├── backfill_us.py     # 미국 주식 10년 백필 (yfinance)
├── backfill_macro.py  # 매크로 지표 (환율/VIX/금리/DXY/WTI) 백필
├── incremental.py     # 일별 증분 수집 (한/미/매크로 통합)
├── analyze.py         # 월별 상승/하락 집계 쿼리 샘플
├── features.py        # 월별 ML 피처 엔지니어링 (+ 매크로 join)
├── ml_experiment.py   # 실험 1: XGBoost vs 통계 기준선 (+ 매크로 A/B)
└── stock.db           # SQLite DB (실행 후 생성)
```

## 설치

```bash
cd poc
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
# source .venv/bin/activate
pip install -r requirements.txt
```

## 실행 순서

### 1) DB 초기화
```bash
python db.py
```

### 2) 10년 데이터 백필

**A. 특정 종목만:**
```bash
python backfill.py --years 10 --tickers 005930 000660 035420
#                                        삼성전자 SK하이닉스 NAVER
```

**B. 코스피 시총 상위 50개:**
```bash
python backfill.py --years 10 --market KOSPI --top 50
```

**C. 미국 주식 (개별 티커):**
```bash
python backfill_us.py --years 10 --tickers AAPL MSFT NVDA GOOGL
```

**D. 미국 프리셋 (S&P500 상위 50 / FAANG / AI):**
```bash
python backfill_us.py --years 10 --preset sp500_top50
python backfill_us.py --years 10 --preset faang
python backfill_us.py --years 10 --preset ai
```

> ⏱ 소요 시간
> - **한국** (pykrx): 종목당 2~5초, 50종목 ≈ 3~5분
> - **미국** (yfinance): 종목당 1~2초, 50종목 ≈ 1~2분
>
> rate limit 회피를 위해 `--sleep` 간격 적용 (기본 0.2~0.3초).
> 한국/미국 데이터는 동일한 `daily_prices` 테이블에 저장되며 `tickers.market` 으로 구분.

### 2-1) 매크로 지표 백필

```bash
# 전체 지표 10년치
python backfill_macro.py --years 10

# 특정 지표만
python backfill_macro.py --years 10 --indicators VIX USDKRW
```

수집 지표 (yfinance):

| 코드 | 심볼 | 의미 |
|------|------|------|
| `USDKRW` | `KRW=X` | 원/달러 환율 |
| `VIX` | `^VIX` | CBOE 변동성 지수 — 공포 지수 |
| `US10Y` | `^TNX` | 미국 10년 국채 수익률 |
| `DXY` | `DX-Y.NYB` | 달러 인덱스 |
| `WTI` | `CL=F` | WTI 원유 선물 |

모두 `macro_indicators(indicator, date, value)` 테이블에 UPSERT.

### 3) 월별 상승/하락 집계 확인
```bash
python analyze.py 005930   # 한국 (삼성전자)
python analyze.py AAPL     # 미국 (Apple)
```

예상 출력:
```
=== 005930 월별 통계 (10년) ===
 month  years_count  avg_return  up_probability  min_return  max_return
     1           10        1.23           60.00       -8.50       12.30
     2           10       -0.45           40.00      -11.20        7.80
 ...

--- 상승 확률 히트맵 ---
   1월   60.0%  ████████████
   2월   40.0%  ████████
  ...
```

### 3-1) 실험 1: XGBoost vs 통계 기준선

**단일 종목:**
```bash
python ml_experiment.py 005930
```

**여러 종목 + 차트:**
```bash
python ml_experiment.py 005930 000660 AAPL MSFT --plot
```

**프리셋 (한국 대형주 / 미국 빅테크):**
```bash
python ml_experiment.py --preset korean_bluechips
python ml_experiment.py --preset us_bigtech
```

**매크로 피처 A/B 비교 (중요 검증):**
```bash
python ml_experiment.py --preset korean_bluechips --ab-macro
```

매크로 포함 vs 제외 모델 성능을 나란히 비교하여, 환율/VIX 등 매크로 변수가
**실제로 예측력을 높이는지** 검증합니다. 출력 예:

```
### 매크로 A/B 비교 (모델 평균)
| model                | accuracy_noMacro | accuracy_withMacro | delta_acc_%p |
|----------------------|------------------|--------------------|--------------|
| XGBoost              |           0.548  |             0.587  |        +3.90 |
| Baseline_LogReg      |           0.530  |             0.556  |        +2.60 |
```

**무엇을 비교하나:**

| 모델 | 설명 |
|------|------|
| `Baseline_AlwaysUp` | 다수결 기준선 — 무조건 상승 예측 |
| `Baseline_Seasonality` | 월별 역사적 상승확률 > 50% → 상승 (기존 시트 로직) |
| `Baseline_LogReg` | 로지스틱 회귀 — 선형 벤치마크 |
| `XGBoost` | 비선형 그래디언트 부스팅 |

**자동 판정 로직** (ml_experiment.py 마지막 출력):

- **Δ ≥ +10%p** → ✅ ML 채택 — **Python(FastAPI) + XGBoost** 스택
- **Δ ≥ +3%p**   → 🟡 추가 피처/앙상블 검토 (매크로 지표 추가)
- **Δ < +3%p**   → ❌ ML 우위 없음 — **Next.js 풀스택** 단순화

피처 (월별):

종목 피처:
- 수익률 lag: 1/3/6/12개월
- 변동성 lag: 1/3개월 (일별 log return std × √21)
- 거래량 비율: 최근월 평균 / 12개월 평균
- 12개월 모멘텀: 월말 종가 / 12개월 이동평균
- 계절성: month (1~12)

매크로 피처 (`include_macro=True` 기본):
- USDKRW, VIX, US10Y, DXY, WTI의 1개월 lag 값
- USDKRW, VIX의 1개월 변화율 (%)
- VIX 3개월 이동평균 (리스크 레짐 프록시)

> ⚠️ 모든 매크로 피처는 `shift(1)` 적용 — 예측 시점에 이미 알려진 직전월 값만 사용하여
> lookback bias(미래 정보 누출)를 방지합니다.

### 4) 일별 증분 업데이트 (매일 장 마감 후)
```bash
# 종목 + 매크로 지표 모두 업데이트 (기본)
python incremental.py

# 매크로만
python incremental.py --only-macro

# 매크로 제외
python incremental.py --skip-macro
```

`incremental.py`는 `tickers.market` 컬럼을 기준으로 자동 라우팅:
- `KOSPI`/`KOSDAQ` → pykrx
- `NASDAQ`/`NYSE`/`US_OTHER` → yfinance
- + 매크로 지표 (USDKRW/VIX/US10Y/DXY/WTI) 동시 갱신

한/미 주식을 섞어 등록해 두어도 한 번의 실행으로 모두 업데이트됩니다.

> ⚠️ **시차 주의**: 미국 장 마감은 KST 기준 익일 새벽 05:00~06:00.
> 한국 장 마감(KST 15:30)과 별도 스케줄로 돌리는 것이 안전합니다.

## 자동화 (cron 예시)

**Linux/macOS crontab:**
```
# 평일 18:30 KST — 한국 주식 증분 수집 (미국은 skip, 당일 데이터 없음)
30 18 * * 1-5 cd /path/to/poc && .venv/bin/python incremental.py >> incremental.log 2>&1
# 평일 07:30 KST — 미국 주식 증분 수집 (직전 영업일 데이터)
30  7 * * 2-6 cd /path/to/poc && .venv/bin/python incremental.py >> incremental.log 2>&1
```

**GitHub Actions** (`.github/workflows/ingest.yml`):
```yaml
name: Daily Ingest
on:
  schedule:
    - cron: "30 9 * * 1-5"   # UTC 09:30 = KST 18:30
  workflow_dispatch:
jobs:
  ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install -r poc/requirements.txt
      - run: python poc/incremental.py
      - uses: actions/upload-artifact@v4
        with: { name: stock-db, path: poc/stock.db }
```

> 운영 시에는 DB를 아티팩트 대신 **TimescaleDB/Postgres**로 옮기는 것을 권장.

## 검증 체크리스트

PoC 완료 후 확인해야 할 항목:

- [ ] 50종목 × 10년 백필이 5분 이내 완료되는가?
- [ ] `ingestion_log`에 error row가 있는가? (네트워크/종목상장폐지 예외)
- [ ] `analyze.py`의 월별 상승확률이 GOOGLEFINANCE 기반 결과와 일치하는가?
- [ ] 증분 수집이 이미 저장된 날짜를 중복 insert하지 않는가? (ON CONFLICT로 보장)
- [ ] SQLite 파일 크기가 허용 범위인가? (2000종목 × 10년 ≈ 200MB 예상)

## 다음 단계

1. **Postgres/TimescaleDB 마이그레이션** — `db.py`의 스키마를 PG 문법으로 전환
2. **FastAPI 래퍼** — `analyze.py` 쿼리를 `/api/stocks/{ticker}/monthly` 엔드포인트로
3. **ML 실험 노트북** — 월별 상승 확률 vs XGBoost 예측 정확도 비교 (실험 1)
4. ~~**yfinance 통합** — 미국 주식 지원 (동일 스키마 재사용)~~ ✅ 완료
5. **거래소 시간 고려 스케줄러** — 한/미 각각 장 마감에 맞춘 별도 실행
6. ~~**ML 피처 엔지니어링**~~ ✅ 기본 피처 완료 (`features.py`)
7. ~~**ML 실험 스크립트**~~ ✅ 완료 (`ml_experiment.py`)
8. ~~**매크로 피처 테이블**~~ ✅ 완료 (`backfill_macro.py`, `features.py`)
9. **Walk-forward 검증** — 고정 split 대신 rolling window로 재검증
10. **FastAPI 래퍼 + 프론트엔드** — 실험 1 결과에 따라 스택 확정
11. **추가 매크로 지표** — 한국 금리(ECOS API), 원자재 바스켓, 업종 ETF 상대강도
