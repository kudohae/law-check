# Law Check

Law Check는 국회 법률안과 정부입법 정보를 한 화면에서 추적하는 정적 웹사이트입니다.

운영비 0원을 목표로 하므로 초기 버전은 서버와 유료 데이터베이스 없이 동작합니다. 데이터는 `public/data/bills.json` 파일로 저장하고, GitHub Actions 같은 무료 예약 작업으로 갱신할 수 있습니다.

공개 상시 운영은 Cloudflare Pages 무료 플랜을 1순위로 둡니다. 나중에 광고 수익화를 고려할 수 있도록 개인정보 처리방침, 문의, 편집 원칙 페이지와 광고 자리표시자를 포함합니다. 실제 광고 코드는 아직 넣지 않습니다.

## 실행

```powershell
npm install
npm run dev
```

## 데이터 갱신

```powershell
npm run sync:data
```

기본 수집 범위는 국회 API 5페이지, 국민참여입법센터 5페이지입니다. 필요하면 환경 변수로 조절합니다.

```powershell
$env:LAWMAKING_MAX_PAGES="10"
$env:ASSEMBLY_MAX_PAGES="10"
npm run sync:data
```

API 키가 없거나 공공 API 연결이 실패하면 기존 데이터가 유지됩니다.

## 빌드

```powershell
npm run build
```

Cloudflare Pages 설정:

- Build command: `npm run build`
- Build output directory: `dist`
- Root directory: repository root

## 비용 원칙

- 서버 상시 운영 없음
- 유료 DB 없음
- AI 요약 생성 없음
- 정적 호스팅 가능
- 데이터 갱신은 무료 예약 작업으로 처리 가능
