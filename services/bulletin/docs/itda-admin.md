# 잇다 어드민

기존 React 관리자 웹에서 잇다 앱과 같은 API·PostgreSQL 데이터를 관리합니다. 별도 서비스나 회원 DB를 만들지 않습니다.

## 실행과 접속

Node.js 22.13 이상이 필요합니다. 처음 준비하는 환경은 저장소 루트 README의 의존성 설치와 `npm run setup:itda` 절차를 따릅니다. 두 터미널에서 각각 실행합니다.

```sh
cd services/bulletin
npm run dev:itda
```

```sh
cd services/bulletin
npm run dev:web
```

`http://localhost:5173/admin`으로 접속합니다. Google OAuth 콜백은 API 주소인 `http://localhost:8787/api/auth/callback/google`에 등록합니다. 관리자 웹 주소는 서버의 `WEB_ORIGIN` 또는 `EXTRA_TRUSTED_ORIGINS`에 포함되어야 합니다. 배포 시 웹의 `VITE_API_BASE_URL`에 잇다 API 주소를 지정합니다. 같은 호스트에서 서비스하면 빈 값으로 둡니다.

현재는 Google 계정으로 로그인하면 관리자로 자동 등록되어 대시보드를 이용합니다. 서버의 `ADMIN_REGISTRATION_MODE` 기본값은 `automatic`입니다. 추후 `approval`로 변경하면 신규 자동 등록을 중지하고 `apps/api/db/grant-admin.sql`로 수동 승인할 수 있습니다. 전환 전에 등록된 관리자 권한은 그대로 유지되며 별도로 회수해야 합니다. 웹의 별도 관리자 승인 화면은 아직 제공하지 않습니다. [API 인증 설정](api-authentication.md)

## 메뉴

| 주소 | 기능 |
| --- | --- |
| `/admin`, `/admin/retreats` | 수련회 접수 관리 |
| `/admin/users` | 로그인 회원 관리 |
| `/admin/bulletins` | 기존 주보 목록·작성 |
| `/admin/site-info` | 기존 교회 안내 편집 |

### 수련회 접수

- 행사 선택 후 전체 신청을 불러와 유효 접수·출석·본대/후발대·신청 취소 현황을 집계합니다. 체험용 수련회에는 가상 행사임을 표시합니다.
- 이름·연락처·또래·접수 코드 검색과 접수·출석·출발 방식 필터를 함께 적용할 수 있습니다.
- 신청 상세에서 신청 당시의 기본 정보·출발 메모·기도제목을 확인하고 회원 관리로 이동합니다.
- 출석은 미확인·출석·결석으로 변경합니다. 신청 취소는 상세 화면에서 다시 확인한 후 처리합니다. 기존 서버의 행사·신청 상태 규칙을 따릅니다.
- CSV는 현재 검색과 필터에 맞는 **전체 결과**를 다운로드합니다. 이름·또래·성별·연락처·접수/출석 상태·출발 정보·접수 코드·접수/취소일이 포함됩니다. 기도제목은 제외합니다. UTF-8 BOM, 따옴표 이스케이프와 수식 실행 방어를 적용하고 연락처 앞자리 0을 보존합니다.
- 취소된 행사는 유효 접수 집계에서 제외하고 기존 출석을 취소 전 기록으로 표시합니다. 실제 신청 이력은 보존합니다.
- 일반 행사도 선택할 수 있습니다. 수련회 전용 답변이 없는 신청에는 해당 정보를 빈 값으로 표시합니다.

### 회원 관리

- 앱 회원의 이름·이메일·연락처를 검색하고 성도 인증 요청·인증 완료·미인증 상태를 필터링합니다. 목록은 페이지당 최대 50명입니다.
- 회원 상세에서 이름·또래·성별·연락처를 수정하고 성도 인증 승인·해제를 처리합니다. 인증 해제는 재확인을 거칩니다.
- 이메일·로그인 수단·관리자 역할은 읽기 전용입니다. 공급자 이름만 표시하며 로그인 토큰·세션·연결 계정 식별자는 노출하지 않습니다.
- 앱 등록일은 `app_users.created_at`, 마지막 정보 변경은 `app_users.updated_at`입니다. 실제 마지막 로그인 시각을 의미하지 않습니다.
- 신청 내역에서 해당 행사의 접수 관리로 이동합니다. 기본 정보 수정은 계정에만 적용하고 이미 제출한 신청서의 정보는 변경하지 않습니다.

## 권한과 데이터 처리

모든 회원·신청 API는 서버에서 Better Auth 세션과 활성 상태의 `app_users.role`을 확인하고 `Cache-Control: no-store`로 응답합니다. 수정 시에는 트랜잭션 안에서 관리자 권한을 재확인하고 `expectedVersion`으로 동시 수정을 검사합니다. 다른 변경이 먼저 저장되면 최신 정보를 불러온 뒤 다시 처리합니다.

접수·회원 정보를 브라우저 영구 저장소에 저장하지 않습니다. 기존 공개 주보의 오프라인 캐시와 관리자 데이터는 분리되어 있습니다. CSV 다운로드 파일에는 연락처가 포함되므로 교회의 명단 관리 기준에 따라 취급합니다.

운영 스키마가 기존 `retreat-schema.sql`까지 적용되어 있다면 추가 DB 마이그레이션은 필요하지 않습니다. 이 구현에는 운영 배포, 실제 OAuth 공급자 설정 변경, 실제 회원 데이터 수정이 포함되어 있지 않습니다.

## 추가·확장 API

기존 접수·출석·성도 인증 API를 재사용하며 다음 회원 API를 추가하거나 확장합니다.

- `GET /v1/admin/users?search=&verification=verified|pending|unverified&limit=50&cursor=`: 기본 프로필·이메일·공급자 이름·앱 등록일·정보 변경일 목록.
- `GET /v1/admin/users/:id`: 활성 회원 상세.
- `PATCH /v1/admin/users/:id/profile`: `expectedVersion`과 변경할 `name`, `peerGroup`, `gender`, `phoneNumber` 중 하나 이상. 이름 이외의 값은 `null`로 비울 수 있습니다.
- `GET /v1/admin/users/:id/registrations?limit=50&cursor=`: 해당 회원의 신청 이력. 행사 상세와 신청 시점의 답변을 포함합니다.

기존 `PATCH /v1/admin/users/:id`와 `POST /v1/admin/users/:id/member-verification`의 성도 인증 계약은 유지합니다.
