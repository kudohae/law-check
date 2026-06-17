# Law Check 웹사이트 청사진

## 1. 프로젝트 목적

Law Check는 국회에서 발의·제안된 법률안, 정부가 국회에 제출한 법률안, 정부가 국회 제출 전 준비 중인 법률안을 한곳에서 추적하는 웹사이트다.

사용자는 여러 기관 사이트를 따로 열지 않고도 다음 정보를 한 화면에서 확인할 수 있어야 한다.

- 최근 올라온 법률안
- 법률안의 출처: 국회, 정부입법, 정부 제출안
- 현재 진행 단계
- 소관 부처 또는 소관 위원회
- 제안자 또는 제출 기관
- 원문 및 공식 상세 페이지 링크
- 나중에 제공될 AI 요약 상태

초기 버전에서는 AI 요약을 실제로 생성하지 않는다. 다만 데이터 구조와 화면 영역은 미리 만들어 두어, 비용 여유가 생겼을 때 Gemini, Groq, OpenAI, 로컬 모델 중 하나를 연결할 수 있게 한다.

## 2. 핵심 문제

한국의 입법 정보는 한 기관에 모여 있지 않다.

- 국회 단계의 법률안은 국회 의안정보 및 열린국회 API 쪽에 있다.
- 정부가 준비 중인 법령안은 법제처·정부입법지원센터·국민참여입법센터 쪽에 있다.
- 정부가 국회에 제출한 법률안은 국회 데이터 안에서 별도 필터링하거나 의안 상세 정보와 매칭해야 한다.

이 프로젝트의 핵심은 단순히 목록을 보여주는 것이 아니라, 서로 다른 출처의 데이터를 같은 기준으로 정리하는 것이다.

## 3. 1차 MVP 범위

1차 버전은 비용 0원 또는 거의 0원으로 운영할 수 있는 범위만 구현한다. 단, 사용자가 모두 접속할 수 있는 상시 공개 페이지를 목표로 하므로 로컬 앱이 아니라 정적 호스팅 배포를 전제로 한다.

### 포함

- 법률안 목록 페이지
- 법률안 상세 페이지
- 출처별 필터
- 진행 상태별 필터
- 키워드 검색
- 소관 부처/위원회 필터
- 원문 또는 공식 상세 페이지 링크
- 데이터 수집 배치 작업
- 데이터 중복 방지
- AI 요약 준비 상태 표시
- 공개 운영용 정책 페이지
- 광고 영역 자리표시자

### 제외

- 실제 AI 요약 생성
- 사용자 로그인
- 유료 알림 기능
- 법률 자문 기능
- 모든 입법 단계의 완전 자동 매칭
- 모바일 앱
- 실제 광고 코드 삽입

## 4. 사용자

주요 사용자는 다음과 같다.

- 시민단체 활동가
- 기자
- 정책 연구자
- 법률·행정 전공 학생
- 기업 대관·정책 담당자
- 특정 법률 변화를 추적해야 하는 일반 사용자

이 사이트는 법률 전문가용 검색 시스템보다 더 읽기 쉬워야 한다. 다만 정보의 정확성을 희생해서는 안 된다. 모든 항목은 공식 출처 링크를 가져야 한다.

## 5. 공식 데이터 출처

### 국회 법률안

- 공공데이터포털: 국회 국회사무처_국회의원 발의법률안
- URL: https://www.data.go.kr/data/15125946/openapi.do
- 용도:
  - 국회의원 발의 법률안 목록 수집
  - 제안일, 제안자, 의안명, 처리 상태, 소관위원회 등 수집

### 정부입법예고

- 공공데이터포털: 법제처_정부입법예고
- URL: https://www.data.go.kr/data/15058407/openapi.do
- API URL 예시: http://www.lawmaking.go.kr/rest/ogLmPp
- 용도:
  - 정부가 국회 제출 전 준비 중인 입법예고 법령안 수집
  - 소관부처, 예고기간, 공고번호, 법령안명 등 수집

### 국민참여입법센터 API

- URL: https://opinion.lawmaking.go.kr/api/operationGuide
- 용도:
  - 입법현황 목록/상세
  - 입법계획 목록/상세
  - 입법예고 목록/상세
  - 행정예고 목록/상세

### 국가법령정보센터

- URL: https://open.law.go.kr/LSO/main.do
- 용도:
  - 현행 법령 정보 연계
  - 나중에 법률안이 어떤 현행 법률을 바꾸는지 연결할 때 사용

## 6. 데이터 통합 원칙

서로 다른 API의 필드명이 다르므로 내부에서는 하나의 공통 모델로 정리한다.

### 공통 법안 모델

```ts
type BillSource =
  | "assembly_member"
  | "assembly_government"
  | "government_pre_submit"
  | "government_notice";

type BillStage =
  | "drafting"
  | "pre_announcement"
  | "submitted_to_assembly"
  | "committee_review"
  | "plenary_review"
  | "passed"
  | "rejected"
  | "withdrawn"
  | "promulgated"
  | "unknown";

type AiSummaryStatus =
  | "none"
  | "pending"
  | "done"
  | "failed";

type Bill = {
  id: string;
  externalId: string;
  source: BillSource;
  title: string;
  normalizedTitle: string;
  stage: BillStage;
  statusLabel: string;
  proposerName?: string;
  proposerType?: "member" | "government" | "committee" | "ministry" | "unknown";
  ministry?: string;
  committee?: string;
  proposedDate?: string;
  noticeStartDate?: string;
  noticeEndDate?: string;
  lastUpdatedAt?: string;
  officialUrl: string;
  originalTextUrl?: string;
  rawSummary?: string;
  aiSummary?: string;
  aiSummaryStatus: AiSummaryStatus;
  aiSummaryUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
};
```

### 중복 처리

다음 기준을 조합해 중복 가능성을 판단한다.

- 공식 API의 고유 ID
- 법률안명 정규화 결과
- 제안일 또는 공고일
- 소관 부처
- 소관 위원회
- 제출자 또는 제안자

완전 자동 매칭이 어려운 항목은 `needsReview` 상태로 남긴다. 초기 버전에서는 관리자 화면을 만들지 않고, 데이터베이스에서 직접 확인할 수 있게 한다.

## 7. 추천 기술 스택

### 프론트엔드

- Next.js
- React
- TypeScript
- Tailwind CSS

선택 이유:

- 목록, 상세, 검색 페이지를 빠르게 만들 수 있다.
- 서버 API와 화면을 같은 프로젝트에서 관리할 수 있다.
- 나중에 배치 작업, 캐시, 서버 사이드 렌더링을 붙이기 쉽다.

### 백엔드

- Next.js Route Handlers
- Node.js
- TypeScript

초기에는 별도 백엔드 서버를 두지 않는다. 데이터 수집과 웹 API를 같은 Next.js 앱 안에서 관리한다.

### 데이터베이스

- Supabase Postgres

선택 이유:

- 무료 티어로 시작 가능하다.
- SQL로 데이터 정합성을 관리하기 쉽다.
- 나중에 관리자 화면, 검색, 인증을 붙이기 좋다.

대체 선택:

- SQLite: 완전 로컬 MVP에 적합
- PostgreSQL 직접 운영: 서버 운영 비용과 관리 부담이 늘어난다

### 배포

초기 선택:

- Cloudflare Pages: 웹사이트 배포
- GitHub Actions: 데이터 갱신
- JSON 파일: 데이터 저장

비용을 더 줄이고 싶을 때:

- 이미 Cloudflare Pages 무료 플랜을 기준으로 한다.
- 도메인을 사지 않으면 Cloudflare Pages 기본 도메인으로 운영할 수 있다.

GitHub Pages는 무료 공개 사이트 배포가 가능하지만, 상업적 웹호스팅 용도에는 제한이 있으므로 광고 수익화를 고려하는 이 프로젝트의 1순위 배포처로 보지 않는다.

### 데이터 수집

초기:

- 수동 실행 스크립트
- 예: `npm run sync:bills`

운영 단계:

- GitHub Actions 스케줄
- Vercel Cron
- Supabase Edge Function Cron

무료 운영을 우선하면 GitHub Actions 스케줄이 가장 현실적이다.

## 8. 화면 설계

### 홈 / 법률안 목록

목적: 지금 어떤 법률안이 움직이고 있는지 빠르게 보여준다.

필수 요소:

- 상단 검색창
- 출처 필터
  - 전체
  - 국회의원 발의
  - 정부 제출
  - 정부입법예고
  - 정부입법현황
- 진행 상태 필터
- 소관 부처/위원회 필터
- 정렬
  - 최신순
  - 예고 종료 임박순
  - 최근 업데이트순
- 법률안 카드 또는 표

목록 항목에 표시할 정보:

- 법률안명
- 출처
- 진행 상태
- 제안자/소관부처
- 제안일 또는 예고기간
- 소관위원회
- AI 요약 상태

### 법률안 상세

목적: 한 법률안의 현재 위치와 공식 근거를 보여준다.

필수 요소:

- 법률안명
- 공식 출처 링크
- 출처
- 진행 상태
- 제안자 또는 제출 기관
- 소관 부처
- 소관 위원회
- 제안일
- 예고기간
- 원문 링크
- 진행 타임라인
- AI 요약 영역

AI 요약 영역의 초기 문구:

> AI 요약은 아직 제공하지 않습니다. 나중에 비용과 품질 기준이 정해지면 이 영역에 요약을 표시합니다.

### 데이터 출처 안내 페이지

목적: 이 사이트가 어떤 공식 데이터를 쓰는지 밝힌다.

필수 요소:

- 국회 데이터 출처
- 법제처 데이터 출처
- 국민참여입법센터 데이터 출처
- 갱신 주기
- 데이터 오류 가능성
- 공식 판단은 원문 링크를 확인해야 한다는 안내

### 소개 페이지

목적: 서비스의 한계와 원칙을 명확히 한다.

필수 문구:

> Law Check는 법률 자문 서비스가 아닙니다. 이 사이트는 공개된 공식 데이터를 보기 쉽게 정리하는 정보 제공 서비스입니다. 법률적 판단이나 권리·의무에 관한 결정은 반드시 공식 문서와 전문가 검토를 거쳐야 합니다.

### 정책 페이지

광고 수익화를 나중에 검토할 수 있도록 다음 정적 페이지를 초기부터 둔다.

- `/privacy.html`
- `/contact.html`
- `/editorial-policy.html`

초기 개인정보 처리방침에는 회원가입, 문의 양식, 자체 분석 스크립트, 광고 코드가 없다는 사실을 명시한다. 광고를 붙이는 시점에는 쿠키, 광고 네트워크, 제3자 사업자 고지를 추가해야 한다.

## 9. 데이터베이스 설계

### `bills`

법률안의 공통 정보.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid | 내부 ID |
| external_id | text | 외부 API ID |
| source | text | 데이터 출처 |
| title | text | 법률안명 |
| normalized_title | text | 검색·매칭용 정규화 제목 |
| stage | text | 표준화된 진행 단계 |
| status_label | text | 원본 상태 라벨 |
| proposer_name | text | 제안자/제출자 |
| proposer_type | text | 제안자 유형 |
| ministry | text | 소관부처 |
| committee | text | 소관위원회 |
| proposed_date | date | 제안일 |
| notice_start_date | date | 입법예고 시작일 |
| notice_end_date | date | 입법예고 종료일 |
| official_url | text | 공식 상세 페이지 |
| original_text_url | text | 원문 링크 |
| raw_summary | text | API에서 제공하는 요약 또는 주요내용 |
| ai_summary | text | 나중에 생성할 AI 요약 |
| ai_summary_status | text | none/pending/done/failed |
| ai_summary_updated_at | timestamptz | AI 요약 갱신 시각 |
| needs_review | boolean | 자동 매칭 검토 필요 여부 |
| created_at | timestamptz | 생성 시각 |
| updated_at | timestamptz | 수정 시각 |

### `bill_events`

법률안 진행 이력.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid | 내부 ID |
| bill_id | uuid | bills.id |
| event_type | text | 이벤트 유형 |
| event_label | text | 표시용 문구 |
| event_date | date | 이벤트 날짜 |
| source_url | text | 근거 URL |
| created_at | timestamptz | 생성 시각 |

### `sync_runs`

데이터 수집 실행 기록.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid | 내부 ID |
| source | text | 수집 출처 |
| started_at | timestamptz | 시작 시각 |
| finished_at | timestamptz | 종료 시각 |
| status | text | success/failed/partial |
| fetched_count | integer | 가져온 항목 수 |
| inserted_count | integer | 신규 저장 수 |
| updated_count | integer | 갱신 수 |
| error_message | text | 오류 메시지 |

### `raw_bill_payloads`

원본 응답 보관용. API 구조가 바뀌었을 때 추적하기 위해 둔다.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid | 내부 ID |
| bill_id | uuid | 연결된 법률안 |
| source | text | 출처 |
| external_id | text | 외부 ID |
| payload | jsonb | 원본 API 응답 |
| fetched_at | timestamptz | 수집 시각 |

## 10. API 설계

### 공개 API

#### `GET /api/bills`

법률안 목록 조회.

쿼리:

- `q`: 검색어
- `source`: 출처
- `stage`: 진행 단계
- `ministry`: 소관부처
- `committee`: 소관위원회
- `sort`: 정렬
- `page`: 페이지

#### `GET /api/bills/:id`

법률안 상세 조회.

반환:

- 법률안 기본 정보
- 진행 이벤트
- 원문 링크
- AI 요약 상태

### 내부 API 또는 스크립트

#### `sync:assembly-member-bills`

국회의원 발의 법률안 수집.

#### `sync:government-notices`

정부입법예고 수집.

#### `sync:government-progress`

정부입법현황 수집.

#### `normalize:bills`

제목, 날짜, 상태값 정규화.

#### `match:government-to-assembly`

정부입법 데이터와 국회 제출안을 매칭한다. 초기에는 보수적으로 동작한다. 확실하지 않으면 `needs_review = true`로 남긴다.

## 11. 진행 단계 표준화

외부 API의 상태값은 그대로 사용자에게 보여주되, 내부 필터링을 위해 표준 상태를 별도로 둔다.

| 표준 단계 | 의미 |
|---|---|
| drafting | 정부 내부 준비 또는 입법계획 |
| pre_announcement | 입법예고 |
| submitted_to_assembly | 국회 제출 |
| committee_review | 상임위원회 심사 |
| plenary_review | 본회의 심의 |
| passed | 가결 |
| rejected | 부결 |
| withdrawn | 철회 |
| promulgated | 공포 |
| unknown | 알 수 없음 |

## 12. AI 요약 기능 계획

초기 버전에서는 AI 요약을 생성하지 않는다.

다만 다음 구조는 미리 둔다.

- `ai_summary`
- `ai_summary_status`
- `ai_summary_updated_at`

### 나중에 구현할 요약 형식

```md
## 한 문장 요약

## 바뀌는 내용

## 영향을 받는 사람·기관

## 쟁점

## 원문에서 확인할 부분
```

### 비용 통제 원칙

- 모든 법률안을 자동 요약하지 않는다.
- 사용자가 상세 페이지를 열었다고 바로 요약하지 않는다.
- 관리자가 선택한 법률안만 요약한다.
- 같은 법률안은 한 번만 요약하고 DB에 저장한다.
- 무료 API 한도 또는 로컬 모델을 우선 검토한다.

### 요약 품질 원칙

- 원문에 없는 내용을 만들어내지 않는다.
- 추측은 표시하지 않는다.
- 법률 자문처럼 단정하지 않는다.
- 조문 변경과 정책 효과를 구분한다.
- 공식 원문 링크를 함께 보여준다.

## 13. 검색 설계

초기 검색:

- PostgreSQL `ILIKE`
- 제목, 제안자, 부처, 위원회 검색

개선 검색:

- PostgreSQL full-text search
- 형태소 분석 기반 한국어 검색
- Elasticsearch 또는 Meilisearch

초기에는 복잡한 검색 엔진을 도입하지 않는다. 데이터 양이 커지고 검색 품질 문제가 실제로 생기면 바꾼다.

## 14. 운영 방식

### 초기 운영

- Cloudflare Pages 무료 플랜에 정적 사이트 배포
- 하루 1회 GitHub Actions 예약 수집
- 수집 실패 시 기록만 남김
- 사이트에는 마지막 갱신 시간을 표시
- 수집 실패 시 기존 `public/data/bills.json` 유지

### 운영 화면에 표시할 정보

- 마지막 데이터 갱신 시각
- 데이터 출처
- 공식 링크
- 수집 실패 시 일부 데이터가 늦을 수 있다는 안내

## 15. 보안과 법적 주의

### API 키

- API 키는 `.env.local`에 둔다.
- 클라이언트 코드에 노출하지 않는다.
- Git에 커밋하지 않는다.

### 법률 고지

사이트 하단과 소개 페이지에 다음 내용을 표시한다.

> 이 사이트는 공개 입법 정보를 정리해 보여주는 서비스이며, 법률 자문을 제공하지 않습니다. 표시된 내용은 공식 사이트의 원문과 다를 수 있으므로 중요한 판단에는 반드시 공식 문서를 확인해야 합니다.

### 저작권과 출처

- 공식 데이터 출처를 명시한다.
- 원문 전체를 무단 복제해 자체 콘텐츠처럼 보이게 하지 않는다.
- 가능한 경우 공식 상세 페이지로 연결한다.

### 광고 수익화

초기에는 광고 코드를 넣지 않는다. 나중에 광고를 붙일 때는 다음 기준을 지킨다.

- 광고와 법률 정보 영역을 명확히 구분한다.
- 광고주가 법률안 표시 순서나 설명에 영향을 주지 못하게 한다.
- 개인정보 처리방침에 광고·쿠키·제3자 사업자 정보를 추가한다.
- AdSense 같은 광고 네트워크의 심사 기준이 바뀔 수 있으므로 신청 직전에 최신 정책을 다시 확인한다.

## 16. 폴더 구조 초안

```txt
law-check/
  README.md
  BLUEPRINT.md
  package.json
  .env.example
  src/
    app/
      page.tsx
      bills/
        [id]/
          page.tsx
      sources/
        page.tsx
      about/
        page.tsx
      api/
        bills/
          route.ts
        bills/
          [id]/
            route.ts
    components/
      BillList.tsx
      BillFilters.tsx
      BillStatusBadge.tsx
      BillTimeline.tsx
      AiSummaryPanel.tsx
    lib/
      db.ts
      normalize.ts
      dates.ts
      sources/
        assembly.ts
        lawmaking.ts
    scripts/
      syncAssemblyBills.ts
      syncGovernmentNotices.ts
      syncGovernmentProgress.ts
      matchBills.ts
  supabase/
    migrations/
      0001_init.sql
```

## 17. 환경 변수 초안

```env
DATABASE_URL=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

ASSEMBLY_API_KEY=
LAWMAKING_API_KEY=

AI_PROVIDER=disabled
AI_API_KEY=
```

`AI_PROVIDER`는 초기에는 `disabled`로 둔다.

## 18. 개발 순서

### 1단계: 프로젝트 골격

- Next.js 프로젝트 생성
- Tailwind CSS 설정
- 기본 레이아웃 작성
- 목록/상세 페이지 목업 작성

### 2단계: 데이터베이스

- Supabase 프로젝트 생성
- `bills`, `bill_events`, `sync_runs`, `raw_bill_payloads` 테이블 생성
- `.env.example` 작성

### 3단계: 데이터 수집

- 국회의원 발의 법률안 수집 스크립트 작성
- 정부입법예고 수집 스크립트 작성
- 원본 payload 저장
- 공통 모델로 정규화

### 4단계: 화면 연결

- `/api/bills` 구현
- `/api/bills/:id` 구현
- 목록 페이지에 실제 데이터 표시
- 상세 페이지에 실제 데이터 표시

### 5단계: 필터와 검색

- 검색어 필터
- 출처 필터
- 진행 단계 필터
- 소관 부처/위원회 필터

### 6단계: 배포

- Vercel 배포
- Supabase 연결
- 수집 스크립트 실행 방식 결정
- 마지막 갱신 시각 표시

### 7단계: AI 요약 준비

- `AiSummaryPanel` 컴포넌트 작성
- 요약 상태 표시
- `AI_PROVIDER=disabled`일 때 생성 버튼 숨김
- 나중에 AI 작업 큐를 붙일 수 있게 내부 인터페이스만 정의

## 19. 성공 기준

1차 MVP가 성공하려면 다음 조건을 만족해야 한다.

- 사용자가 최신 법률안을 목록으로 볼 수 있다.
- 사용자가 법률안의 공식 출처로 이동할 수 있다.
- 국회 데이터와 정부입법 데이터를 한 화면에서 구분해 볼 수 있다.
- 진행 상태 기준으로 필터링할 수 있다.
- 법률안 상세 페이지에서 기본 정보와 진행상황을 볼 수 있다.
- AI 요약 기능이 아직 없다는 사실이 명확하게 표시된다.
- 나중에 AI 요약을 붙일 수 있는 DB 필드와 화면 구조가 이미 있다.

## 20. 가장 큰 리스크

### 데이터 매칭

정부입법 단계의 법령안과 국회 제출 후 의안이 항상 같은 식별자를 공유하지 않을 수 있다.

대응:

- 제목 정규화
- 날짜 비교
- 소관부처 비교
- 불확실한 항목은 자동 병합하지 않음

### API 변경

공공 API의 필드명, 응답 구조, 호출 제한이 바뀔 수 있다.

대응:

- 원본 payload 저장
- 수집 실행 로그 저장
- 데이터 출처별 수집 모듈 분리

### 비용

AI 요약을 무작정 자동 생성하면 비용이 생긴다.

대응:

- 초기에는 AI 비활성화
- 요약 캐시
- 관리자 선택형 생성
- 무료 한도 또는 로컬 모델 검토

### 법률 정보 오해

사용자가 AI 요약이나 정리된 정보를 공식 법률 판단으로 오해할 수 있다.

대응:

- 공식 링크 우선
- 법률 자문이 아니라는 고지
- 요약보다 원문을 우선하는 UI

## 21. 최종 방향

Law Check는 “AI가 법률을 설명해주는 서비스”로 시작하지 않는다. 처음에는 공식 입법 정보를 모아, 찾기 쉽고 비교하기 쉽게 정리하는 서비스로 시작한다.

AI 요약은 나중에 붙일 수 있는 보조 기능이다. 이 순서가 비용과 정확성 면에서 가장 안전하다.
