# KRX ETF 종합 EDA 대시보드 (네이버 증권 실시간 연동)

네이버 증권 ETF 실시간 API(`stock.naver.com/api/stockSecurity/etfs/v2/domestic`)를 연동하여 한국거래소(KRX) 상장 전체 1,171개 ETF 종목을 100% 전수 수신하고, 다차원 탐색적 데이터 분석(EDA)을 제공하는 고성능 정적 웹 대시보드입니다.

---

## 🌟 주요 특징 및 차별점

1. **정적 페이지 배포(Static Hosting) 완벽 최적화**:
   - 별도 백엔드 없이 **GitHub Pages, Vercel, Netlify, Cloudflare Pages, S3** 또는 로컬 파일(`file:///.../index.html`) 더블클릭만으로도 즉시 구동됩니다.
   - 최초 실행 시 `data/etf_data.js`를 통해 **0초 로딩**으로 1,171개 전 종목의 전체 분석 차트와 테이블이 즉각 표시됩니다.

2. **네이버 증권 실시간 API 연동 & 스마트 폴백(Fallback)**:
   - **실시간 전수 수신 (Live Fetch)**: 페이지 0~11(`size=100`)를 비동기 병렬/청크 호출하여 전체 종목을 1~2초 만에 실시간 갱신합니다.
   - **브라우저 CORS 완벽 대응**:
     - `localhost:3000` 환경에서는 네이버 API 서버가 기본 허용한 CORS 도메인으로 실시간 직접 수신됩니다.
     - 외부 정적 호스팅 도메인 환경에서는 내장 스냅샷 데이터셋으로 무결점 자동 동기화되며, 커스텀 프록시 주소 설정도 지원합니다.
   - **실시간 자동 갱신 (Auto Refresh)**: 1분 / 3분 / 5분 단위 자동 갱신 지원.

3. **월스트리트/블룸버그 터미널급 종합 EDA(탐색적 데이터 분석) 기능**:
   - **시장 브레드스(Market Breadth) & 거시 KPI**:
     - 전체 상장 종목 수(1,171개), 시장 총 순자산(AUM, 약 457.6조 원), 당일 총 거래대금 및 거래량
     - 상승/보합/하락 종목 수 및 실시간 비율 프로그레스 바
     - 평균 1M / 3M / 6M 수익률 및 |괴리율| ≥ 1.0% 유의 종목 수
   - **운용사·브랜드 점유율 분석 (Issuer EDA)**:
     - 브랜드별 AUM 점유율 도넛 차트 (KODEX, TIGER, RISE, ACE, PLUS, SOL, KIWOOM 등)
     - 상위 운용사별 상장 라인업 규모 및 평균 1M/6M 성과 비교
   - **자산군 및 테마 구조 분석 (Category EDA)**:
     - 국내주식 vs 해외주식 vs 채권형 vs 혼합형 vs 파생/원자재 비중
     - 특수 ETF 라인업 비중 (액티브, 배당/월배당, 레버리지/인버스, 환헤지, TR)
   - **수익률 분포 및 모멘텀 분석 (Returns EDA)**:
     - 기간별(당일, 1개월, 3개월, 6개월) 수익률 빈도 히스토그램
     - 실시간 급등/급락 Top Movers 리더보드
     - 1개월 vs 6개월 모멘텀 4분면 산점도
     - 통계적 수치(평균, 중앙값, 최저, 최고, 표준편차) 요약표
   - **유동성 vs 규모 매트릭스 (Liquidity EDA)**:
     - 순자산(AUM, log scale) vs 당일 거래대금(log scale) 2차원 버블 차트
     - 유동성 부족 대형 ETF(잠자는 거인) 및 단기 과열 종목 즉각 식별
   - **iNav 괴리율 & LP 리스크 분석 (Disparity EDA)**:
     - 현재가 대비 순자산가치(iNav) 괴리율 빈도 분포 곡선
     - 괴리율 상위/하위 이상치(Outlier) 실시간 경고 리스트 (LP 유동성 호가 공급 왜곡 포착)
   - **전체 ETF 종합 탐색기 (Master ETF Screener)**:
     - 실시간 다중 키워드 검색 (종목명, 코드, 운용사, 테마)
     - 운용사별, 자산군별, 특수 속성별(액티브, 배당, 레버리지 등) 칩 필터링
     - 15개 핵심 재무 컬럼 정렬 (AUM순, 거래대금순, 등락률순, 괴리율순 등)
     - 관심 종목(Watchlist) 즐겨찾기 (LocalStorage 자동 보존)
     - 필터링 결과 엑셀 호환 CSV 즉시 내보내기 (UTF-8 BOM 내장)
     - 종목 클릭 시 세부 지표 및 기간별 수익률 차트 팝업 모달

---

## 🚀 빠른 시작 가이드 (Local Run)

본 프로젝트는 Python 가상환경 도구로 **`uv`**를 완벽 지원합니다.

### 방법 1. 로컬 개발 서버 실행 (`server.py`)
네이버 API의 CORS 정책을 가장 깔끔하게 수신할 수 있는 `localhost:3000` 고속 스레드 서버를 실행합니다:

```bash
uv run server.py
```

브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속하시면 실시간 네이버 API와 완벽 연동된 대시보드가 열립니다.

### 방법 2. 커맨드라인 최신 데이터 수동 수집 (`fetch_etfs.py`)
네이버 API로부터 전체 ETF 1,171개 전 종목을 일괄 수신하여 `data/` 폴더의 JSON 및 JS 파일을 최신 시장 데이터로 갱신합니다:

```bash
uv run fetch_etfs.py
```

### 방법 3. 정적 배포 (GitHub Pages 등)
- 저장소 루트의 `index.html`, `style.css`, `app.js`, `data/` 폴더를 GitHub Pages, Vercel, Netlify 등에 그대로 푸시하시면 추가 설정 없이 즉시 운영 배포됩니다.
- 로컬 파일 탐색기에서 `index.html`을 더블클릭하여 열어도 내장된 최신 데이터셋으로 완벽하게 작동합니다.

---

## 📂 파일 구조

```
etfdashboard/
├── index.html            # 메인 대시보드 정적 HTML 페이지
├── style.css             # 핀테크 다크 테마 & 글래스모피즘 CSS 스타일시트
├── app.js                # 실시간 API 연동, EDA 분석 통계 및 차트 인터랙션 엔진
├── server.py             # localhost:3000 고속 스레드 개발 서버 (uv 실행)
├── fetch_etfs.py         # 네이버 ETF 전수 데이터 수집 및 갱신 스크립트 (uv 실행)
├── data/
│   ├── etf_data.json     # 최신 ETF 전체 원본 데이터 (JSON)
│   └── etf_data.js       # 정적 오프라인 구동을 위한 초기화 번들 (JS)
└── README.md             # 프로젝트 안내 문서
```

---

## 📊 네이버 증권 API 규격 요약

- **엔드포인트**: `https://stock.naver.com/api/stockSecurity/etfs/v2/domestic`
- **파라미터**:
  - `listingType`: `aumDesc` (순자산 내림차순 정렬)
  - `size`: 1회 최대 `100` (100 초과 시 400 Bad Request 반환)
  - `index`: 페이지 번호 (`1`, `2`, ... `12`)
- **수집 데이터 필드**:
  - `itemCode` (종목코드), `itemName` (종목명)
  - `currentPrice` (현재가), `changePrice` (전일비), `changeRate` (등락률)
  - `priceMovement` (상승/하락/보합 상태)
  - `tradingVolume` (거래량), `tradingValue` (거래대금)
  - `totalNetAssets` (순자산총액 / AUM)
  - `etfType` (자산 분류 및 세부 유형)
  - `returnRate1m`, `returnRate3m`, `returnRate6m` (1/3/6개월 수익률)
  - `iNav` (순자산가치, 실시간 괴리율 산출에 사용)
