# 무비용 운영 계획

Law Check의 초기 운영은 돈이 들지 않는 구성을 기준으로 한다.

## 기본 구조

- 웹사이트: 정적 파일
- 데이터 저장소: `public/data/bills.json`
- 데이터 갱신: GitHub Actions 예약 작업
- 배포 1순위: Cloudflare Pages 무료 플랜
- 배포 후보: Vercel 무료 플랜, GitHub Pages
- AI 요약: 비활성화

## 비용이 들지 않는 이유

- 상시 서버가 없다.
- 유료 데이터베이스가 없다.
- AI API를 호출하지 않는다.
- 데이터는 빌드에 포함되는 JSON 파일이다.
- 예약 갱신은 GitHub Actions 무료 한도 안에서 처리할 수 있다.

## API 키

일부 공공 API는 키가 필요할 수 있다. 키가 필요하면 GitHub 저장소의 Actions secrets에 넣는다.

- `ASSEMBLY_API_KEY`
- `LAWMAKING_API_KEY`

키가 없거나 API 연결이 실패하면 기존 데이터 파일을 유지한다. 이 경우 사이트는 계속 열린다.

## 배포 후보

### Cloudflare Pages

장점:

- 무료 플랜에서 정적 요청과 대역폭 부담이 작다.
- 광고 수익화를 염두에 둔 공개 정보 사이트에 적합하다.
- 커스텀 도메인 연결이 쉽다.

설정:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root

### Vercel 무료 플랜

장점:

- Vite 앱 배포가 쉽다.

주의:

- 무료 플랜 정책은 바뀔 수 있다. 운영 전 현재 조건을 다시 확인해야 한다.

### GitHub Pages

장점:

- 완전 무료로 시작하기 쉽다.
- GitHub Actions와 잘 맞는다.

주의:

- GitHub Pages는 공개 프로젝트 사이트에 좋지만, 상업 거래나 SaaS 성격의 무료 웹호스팅 용도로 쓰는 데 제한 문구가 있다.
- 광고 수익화를 진지하게 고려한다면 GitHub Pages는 1순위가 아니다.

## 광고 수익화 준비

초기에는 광고 코드를 넣지 않는다.

다만 나중에 AdSense 같은 광고 네트워크 신청을 고려해 다음 페이지를 정적 문서로 둔다.

- `/privacy.html`
- `/contact.html`
- `/editorial-policy.html`

광고를 붙이기 전에는 다음을 확인한다.

- 개인정보 처리방침에 광고·쿠키·제3자 사업자 고지 추가
- 사이트에 독자적인 설명·정책·데이터 정리 가치가 충분한지 확인
- 광고가 법률 정보와 혼동되지 않도록 표시
- AI 요약이 켜지는 경우, AI 생성 정보와 공식 출처를 명확히 구분

## 상시 운영 모델

사용자가 항상 접속할 수 있는 구조는 다음과 같다.

1. GitHub 저장소에 코드와 `public/data/bills.json`을 보관한다.
2. Cloudflare Pages가 저장소를 연결해 `dist/`를 배포한다.
3. GitHub Actions가 하루 한 번 공공 데이터를 갱신한다.
4. 데이터 파일이 바뀌면 Cloudflare Pages가 새 버전을 배포한다.
5. API 수집이 실패해도 기존 JSON 파일을 유지하므로 사이트는 계속 열린다.

서버가 매 요청마다 API를 호출하지 않기 때문에 운영비와 장애 가능성을 줄일 수 있다.
### Vercel 무료 플랜

장점:

- Vite 앱 배포가 쉽다.

주의:

- 무료 플랜 정책은 바뀔 수 있다. 운영 전 현재 조건을 다시 확인해야 한다.

## 빌드 명령

```powershell
npm run build
```

빌드 결과는 `dist/`에 생성된다.
