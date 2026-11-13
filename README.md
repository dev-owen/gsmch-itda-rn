# 잇다 — 선한목자 젊은이교회 행사 앱

공개 일정은 로그인 없이 보고, 카카오·Google 로그인 후 신청과 취소를 할 수 있는 React Native 앱입니다. 성도 인증이 필요한 행사와 관리자 기능을 구분합니다. 기존 모바일 주보의 Hono/PostgreSQL 서버를 확장했습니다.

- `apps/mobile`: Expo SDK 58, React Native, Expo Router
- `services/bulletin`: 기존 주보 서버·웹과 잇다의 행사/계정 기능 확장

## 실행

Node.js 22.13 이상과 PostgreSQL 14 이상이 필요합니다. 각 앱의 의존성은 별도로 설치합니다.

```sh
cd services/bulletin
npm ci
# 로컬 PostgreSQL에 itda_local 데이터베이스를 먼저 만듭니다.
# apps/api/.dev.vars.example을 참고해 apps/api/.dev.vars를 작성합니다.
npm run setup:itda
npm run dev:itda
```

다른 터미널에서:

```sh
cd apps/mobile
npm ci
# .env.example을 .env.local로 복사합니다.
npm start
```

웹 미리보기는 `npm run web`으로 열 수 있습니다. 실제 휴대폰에서는 API 주소를 개발 컴퓨터의 LAN 주소로 지정합니다. 계정 연결·통합은 네이티브 앱용으로 구현했습니다.

`services/bulletin`에서 `npm run sync:itda` 또는 `npm run preview:bulletin`을 실행하면 주간 작업과 같은 규칙으로 현재 공개 주보의 행사를 로컬 DB로 가져옵니다. 새 행사에서 신청 기능은 꺼져 있으며, 관리자 수정 내용과 기존 신청·출석은 보존합니다. 운영 DB에는 이 로컬 명령을 실행할 수 없습니다.

## 로그인 설정

비밀값은 서버의 `.dev.vars` 또는 배포 환경의 secret에만 둡니다. 앱에는 공개 API 주소만 넣습니다.

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- Kakao: `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET`
- 서버 OAuth 리다이렉트: `{BETTER_AUTH_URL}/api/auth/callback/google`, `/kakao`
- 앱 복귀 scheme: `itda://`; 개발 빌드가 필요합니다. Expo Go는 배포용 OAuth 검증 대상이 아닙니다.
- 허용 웹 주소는 `WEB_ORIGIN`과 `EXTRA_TRUSTED_ORIGINS`, 앱 주소는 `MOBILE_APP_ORIGIN`에 설정합니다.
- 관리자 초기 지정은 기존 `apps/api/db/grant-admin.sql` 사용 후 행사 스키마를 적용합니다. 기존 회원을 나중에 관리자로 지정한다면 `app_users.role`도 함께 갱신해야 합니다.

로그인은 사용자 구분만 수행합니다. 성도 인증은 별도의 관리자 확인으로 반영합니다. 이메일이 같아도 계정을 자동 통합하지 않습니다.

## 계정 연결과 통합

단일 USER에 카카오·Google 로그인 수단을 연결합니다. 이미 두 USER가 있다면 양쪽 계정을 새로 인증하고 신청별 최종 결과를 확인한 후 통합합니다. 개인정보와 역할은 클라이언트가 지정할 수 없습니다.

통합은 DB 트랜잭션, 전체 미리보기 검증, 짧은 본인 확인 기한, 중복 요청 식별자를 사용합니다. 신청·출석 충돌은 확정을 막습니다. 관리자 USER가 포함되면 기존 관리자 ID를 유지하고 별도 승인을 요구합니다. 통합·해제·탈퇴로 폐기한 세션은 서버에서도 즉시 거절합니다.

## 느동수 체험

하단의 ‘동수’ 탭에서 가상의 느헤미야 동계수련회 안내와 신청서를 엽니다. 이름·또래·성별·연락처 중 계정에 저장된 값은 자동 입력되고 잠깁니다. 출발 방식·시각과 기도제목은 해당 신청에 저장합니다. 비로그인 상태에서도 작성·검토할 수 있고, 최종 접수에는 로그인이 필요합니다.

`npm run setup:itda`는 로컬 DB에만 체험용 행사를 추가합니다. 운영 DB에는 가상 행사 데이터를 자동으로 넣지 않습니다. 자세한 내용은 [느동수 안내](services/bulletin/docs/itda-nehemiah-demo.md)를 참고하세요.

## 검증

```sh
cd services/bulletin
npm run ci
# 별도의 로컬 테스트 DB를 지정하면 실제 PostgreSQL 트랜잭션 검사도 실행합니다.
ACCOUNT_TEST_DATABASE_URL=postgres://localhost:6547/itda_test EVENT_TEST_DATABASE_URL=postgres://localhost:6547/itda_test npm test
```

```sh
cd apps/mobile
npm test
npm run lint
npx tsc --noEmit
npx expo export --platform all
```

운영 반영 전 DB 백업 후 Better Auth 마이그레이션과 `schema.sql` → `event-schema.sql` → `account-schema.sql` → `event-sync-schema.sql` → `retreat-schema.sql`을 순서대로 적용합니다. `retreat-demo.sql`은 로컬 체험용 데이터입니다. 이 체크아웃에서 운영 배포는 실행하지 않았습니다. 실제 OAuth 공급자 설정, iOS/Android 개발 빌드와 실기기 검증은 별도로 필요합니다.

현재 검증 결과(2026-11-13): 서버 154개 테스트 통과(실제 PostgreSQL 통합 검사 포함, 생략 0), 모바일 입력 계약·계정 전환 테스트 6개 통과, 타입 검사·Lint·iOS/Android/웹 번들 생성 통과. 카카오·Google 실계정 로그인과 실기기 테스트는 공급자 설정 후 확인합니다.

주보 주간 갱신과 잇다 자체 행사 관리는 [행사 동기화 안내](services/bulletin/docs/itda-event-sync.md)를 참고하세요. 잇다 운영 Worker에 주간 Cron을 배포하면 매주 월요일 한국 시간 오전 9시에 가져옵니다. 관리자 화면에서 즉시 갱신과 원본/직접 관리 전환도 지원합니다.
