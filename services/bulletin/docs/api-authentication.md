# API 인증 정책

일반 사용자 앱은 카카오 OAuth, 웹 관리자 대시보드는 Google OAuth로 로그인합니다. OAuth 응답을 검증한 Better Auth가 서버 DB 세션을 발급하며 이후 API 요청은 해당 세션 쿠키를 전달합니다. 네이티브 앱은 Expo 인증 클라이언트에 보관한 쿠키를 전달합니다. OAuth 공급자의 액세스 토큰이나 클라이언트가 보낸 사용자 ID·역할은 API 인증 수단으로 사용하지 않습니다.

로그인 수단은 서비스의 복귀 경로로 구분합니다. 모바일 앱의 `itda://auth/callback`·`itda://auth/proof`와 앱 웹 미리보기의 인증·계정 경로는 카카오만, 허용된 웹 Origin의 `/admin` 경로는 Google만 허용합니다. 관리자 웹은 스마트폰 브라우저로 접속해도 Google을 사용합니다. 브라우저의 User-Agent로 관리자 권한을 판정하지 않습니다. Google의 앱 복귀, 카카오의 관리자 웹 복귀, 로그인 완료·오류·새 사용자 복귀 주소를 다른 서비스로 바꾸는 요청을 서버에서 거절합니다. OAuth 공급자 콜백에서도 검증된 공급자와 OAuth state의 복귀 경로를 다시 검사합니다.

현재 기본 정책은 Google 로그인 계정을 관리자로 자동 등록하는 것입니다. Google OAuth 검증 후 세션을 발급할 때 `app_users.role`과 `admin_users`에 관리자 등록을 반영합니다. 이미 발급된 Google 세션도 다음 인증 API 접근에서 등록합니다. 카카오 세션에는 자동 관리자 권한을 부여하지 않습니다.

## API별 접근 범위

| API | 필요한 인증 |
| --- | --- |
| `GET /v1/health`, 공개 주보 목록·상세·현재 주보, 공개 이미지 | 비로그인 가능 |
| `GET /v1/events`, `GET /v1/events/:id`, `GET /v1/retreats/nehemiah-winter` | 공개 범위는 비로그인 가능. 행사 개인화는 카카오 세션만 사용 |
| `/v1/me`와 하위 프로필·성도 인증 요청·내 신청·수련회 신청 조회 | 카카오로 발급된 활성 세션 |
| `POST /v1/events/:id/registrations`, `POST /v1/retreats/nehemiah-winter/registrations` | 카카오로 발급된 활성 세션 |
| `/v1/admin/*` 전체: 주보·이미지 업로드·회원·행사·출석·동기화·계정 통합 승인 | Google로 발급된 활성 세션 및 `app_users.role = 'admin'` |
| `GET /v1/account/session`, 로그인 수단 연결·해제·계정 통합·탈퇴 | 공급자별 본인 확인을 위한 공통 계정 세션. 민감한 작업은 최근 OAuth 로그인도 검사 |
| 계정 작업 상태 조회·완료 후 재시도 | 기존 계정 작업의 비밀 작업 토큰. 세션이 폐기된 뒤에도 결과를 확인하기 위한 제한적 인증 |

`/v1/me/login-methods/*`와 `/v1/me/delete/*`는 위의 공통 계정 작업 정책을 따릅니다. 모바일의 로그인·재인증·계정 연결·통합 본인 확인은 카카오만 사용하며 Google 로그인을 시작하는 별도 예외가 없습니다. 기존 Google 연결 정보와 계정 작업 기록은 유지합니다. 관리자 역할을 가진 계정도 카카오로 로그인하면 관리자 API를 사용할 수 없습니다. Google 관리자 세션으로 개인 신청을 하려면 앱에서 카카오로 로그인해야 합니다.

로그인 수단을 해제할 때 일반 사용자는 카카오를, 관리자는 Google을 남겨야 합니다. 필수 로그인 수단의 해제는 `409 REQUIRED_LOGIN_METHOD`로 거절합니다. 남겨 둘 로그인 수단으로 최근 본인 확인도 해야 합니다.

서버는 매 요청 DB의 세션과 회원 상태·인증 버전을 확인합니다. 통합·탈퇴·로그인 수단 해제 등으로 폐기한 세션은 재사용할 수 없습니다. 사용자 API는 본인 정보와 본인 신청만 처리하며 성도 인증이 필요한 행사에는 별도의 성도 인증 조건을 적용합니다. 관리자 공통 인증은 하위 라우터보다 먼저 실행합니다.

변경 요청은 허용된 웹 Origin인지 서버에서도 검사합니다. 네이티브 요청은 Origin이 없을 수 있으며 이 경우에도 세션·권한 검사는 동일하게 수행합니다. 계정 연결·해제·탈퇴는 추가 본인 확인 경로를 통과해야 하므로 원래의 `/api/auth/link-social`, `/api/auth/unlink-account`, `/api/auth/delete-user` 직접 호출은 차단됩니다.

## OAuth 설정

서버 런타임에 다음 값을 설정합니다. 실제 비밀값은 로컬의 Git 제외 `.dev.vars` 또는 배포 환경 secret에만 저장합니다. 모바일·웹 번들에는 클라이언트 비밀값과 `BETTER_AUTH_SECRET`을 넣지 않습니다.

| 값 | 용도 |
| --- | --- |
| `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` | 인증 API 공개 주소와 32자 이상 무작위 서버 비밀값 |
| `KAKAO_CLIENT_ID`, `KAKAO_CLIENT_SECRET` | 카카오 OAuth 앱 자격 증명 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 관리자 Google OAuth 앱 자격 증명 |
| `ADMIN_REGISTRATION_MODE` | `automatic`(기본값): Google 관리자 자동 등록. `approval`: 신규 자동 등록 중지 및 수동 승인 |
| `WEB_ORIGIN` | 관리자 웹의 정확한 Origin |
| `MOBILE_APP_ORIGIN` | 모바일 복귀 scheme, 기본값 `itda://` |
| `EXTRA_TRUSTED_ORIGINS` | 추가로 허용할 개발·웹 Origin을 쉼표로 나열 |

각 공급자 콘솔에는 API 주소를 기준으로 콜백을 등록합니다.

- 카카오: `{BETTER_AUTH_URL}/api/auth/callback/kakao`
- Google: `{BETTER_AUTH_URL}/api/auth/callback/google`

예를 들어 로컬 API가 `http://localhost:8787`이면 이 주소 뒤에 각각 `/api/auth/callback/kakao`, `/api/auth/callback/google`을 붙입니다. 모바일의 앱 복귀 주소 `itda://auth/callback`은 OAuth 공급자의 서버 콜백과 별개입니다. 실제 기기에서는 접근 가능한 API 주소와 개발 빌드의 scheme을 사용합니다. 공급자의 이메일 제공·동의 설정도 실제 계정 로그인으로 확인해야 합니다.

## 관리자 등록과 마이그레이션

Better Auth 인증 테이블 및 `schema.sql` → `event-schema.sql` → `account-schema.sql` 등 기존 마이그레이션을 적용합니다. `account-schema.sql`은 세션에 서버용 `authVersion`, `authProviderId`를 추가합니다. 이전 세션의 빈 공급자 값으로는 사용자·관리자 전용 API를 사용할 수 없으므로 해당 공급자로 다시 로그인해야 합니다.

기본값인 `automatic`에서는 Google 로그인 시 관리자로 자동 등록하므로 별도 승인 명령이 필요하지 않습니다. 기존 일반 계정도 검증된 Google 세션으로 접근하면 관리자 권한을 받습니다.

추후 승인제로 전환하려면 서버의 `ADMIN_REGISTRATION_MODE`를 `approval`로 변경합니다. 이 설정은 신규 자동 등록만 중지하며 기존 자동 등록 관리자의 권한을 회수하지 않습니다. 권한 회수가 필요하면 `approval` 전환 후 해당 계정을 `admin_users`에서 삭제하고 `app_users.role`을 `user`로 바꾸며 `version`을 증가시킵니다. 별도 관리자 승인 UI는 아직 없습니다.

`approval`에서는 Google로 한 번 로그인한 계정을 DB 관리자가 다음 명령으로 승인합니다. 서비스 루트에서 실행합니다.

```sh
cd apps/api
psql "$DATABASE_URL" -v admin_email='approved@example.com' -f db/grant-admin.sql
```

스크립트는 지정 이메일에 연결된 Google 계정이 있고 회원이 활성 상태일 때만 승인합니다. `admin_users`와 `app_users.role`을 한 SQL 문장으로 함께 반영하고 반복 실행해도 기존 권한과 회원 버전이 불필요하게 변하지 않습니다. 반환 결과가 0행이면 이메일·Google 연결·회원 상태를 확인합니다. `approval`에서는 Google 로그인만으로 관리자 권한을 얻지 않습니다.

## 오류와 검증

오류 응답은 `{ "code": "...", "message": "..." }` 형식이며 인증 관련 응답은 캐시하지 않습니다.

- `401 UNAUTHENTICATED`: 로그인하지 않았거나 세션이 만료됨
- `401 SESSION_EXPIRED` 등: 폐기된 인증 버전 또는 사용할 수 없는 계정
- `403 KAKAO_LOGIN_REQUIRED`: 사용자 API에 카카오 로그인 필요
- `403 GOOGLE_LOGIN_REQUIRED`: 관리자 API에 Google 로그인 필요
- `403 PLATFORM_LOGIN_PROVIDER_MISMATCH`: 앱은 카카오, 관리자 웹은 Google만 로그인 가능하거나 복귀 경로가 서로 다른 서비스로 지정됨
- `400 INVALID_LOGIN_CALLBACK`: 로그인 복귀 주소가 없거나 허용되지 않는 주소임
- `403 FORBIDDEN`: 승인 모드에서 Google 로그인은 했으나 관리자 권한 없음
- `403 UNTRUSTED_ORIGIN`: 허용되지 않은 웹 Origin의 변경 요청
- `428 RECENT_LOGIN_REQUIRED` / `OAUTH_PROOF_REQUIRED`: 민감한 계정 작업 전에 다시 로그인 필요

로컬 API 테스트는 익명·공급자·역할·세션 폐기·Origin 거절과 계정 작업 회귀를 검사합니다. 이 변경으로 운영 배포를 수행하지 않았으며 실제 카카오·Google 계정 OAuth 로그인 및 실기기 복귀는 각 환경의 공급자 설정 후 별도로 검증해야 합니다.
