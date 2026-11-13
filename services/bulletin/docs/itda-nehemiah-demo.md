# 느동수 가상 수련회 신청

느동수는 잇다의 수련회 홈과 신청 흐름을 살펴보기 위한 **가상 행사**입니다. 2027년 1월 15~17일, ‘다시, 함께 세우다’, 느헤미야 2:18을 예시로 사용합니다. 장소·일정·신청은 실제 교회 행사와 연결되지 않으며 홈과 행사 목록에 가상 행사 표시를 제공합니다.

## 로컬 준비와 스키마

서비스 루트에서 다음 명령을 실행합니다.

```sh
npm run setup:itda
npm run dev:itda
```

`setup:itda`는 로컬 주소의 DB만 허용하며 인증·행사·계정·동기화 스키마 다음에 `apps/api/db/retreat-schema.sql`과 `retreat-demo.sql`을 적용합니다. 가상 행사 ID는 `20270122-0124-4000-8000-000000000001`입니다. 같은 seed를 다시 실행해도 기존 행사와 관리자의 수정 내용을 덮어쓰지 않습니다.

이전 기본 기간인 1월 22~24일로 저장된 로컬 행사에는 `retreat-date-correction.sql`을 한 번 적용해 1월 15~17일로 정정합니다. 기본 신청·취소 마감은 1월 14일로 맞추고 행사 버전을 증가시킵니다. 기존 신청 답변·출석과 별도로 수정한 일정은 보존하며, 다시 실행해도 정정이 반복되지 않습니다.

새 API 코드를 다른 환경에 반영하려면 기존 스키마 적용 후 **`retreat-schema.sql`도 실제 DB에 적용**해야 합니다. 코드 배포만으로 새 컬럼이 생성되지는 않습니다.

```sh
# 서비스 루트, 대상 DB 확인·백업 후 스키마만 적용
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/db/retreat-schema.sql
```

`retreat-demo.sql`은 로컬 시연용입니다. 운영 마이그레이션에 포함하지 않습니다. 이번 구현은 운영 배포를 수행하지 않았습니다.

| 저장 위치 | 추가 정보 |
| --- | --- |
| `app_users` | `peer_group`, `gender`, `phone_number` — 재사용할 프로필 정보 |
| `events` | `is_demo` — 가상 행사 표시 |
| `registrations` | `retreat_answers` — 신청 당시 또래·성별·연락처, 출발 선택·메모, 기도 제목 |

업무 엔티티는 USER·EVENT·REGISTRATION을 그대로 사용합니다. 공개 콘텐츠는 `src/retreat-content.ts`, 입력 검증은 `src/retreat-validation.ts`, 등록 처리는 `src/retreats.ts`에 있습니다.

## 이용 흐름과 API

방문자는 로그인 없이 홈을 보고 신청서를 작성할 수 있습니다. 최종 등록과 본인 신청 조회에는 Better Auth 로그인 세션이 필요합니다. Google·카카오 OAuth와 콜백을 설정하면 로그인 후 작성 중인 신청서로 돌아와 최종 등록합니다.

| API | 접근과 역할 |
| --- | --- |
| `GET /v1/retreats/nehemiah-winter` | 공개 홈·일정·출발 선택지·공개 행사 정보 |
| `POST /v1/retreats/nehemiah-winter/registrations` | 로그인 후 전용 신청, 즉시 확정 |
| `GET /v1/me/retreats/nehemiah-winter/registration` | 본인 신청·답변 조회, 미신청이면 `registration: null` |
| `GET /v1/me`, `PATCH /v1/me` | 본인 프로필 조회·선택 필드 수정 |
| `GET /v1/me/registrations` | 본인 신청 내역과 수련회 답변 |
| `DELETE /v1/me/registrations/:id` | 기존 취소 기한·출석·버전 규칙에 따른 본인 취소 |
| `GET /v1/admin/events/:id/registrations` | 관리자 명단과 수련회 답변 확인 |

행사 목록·상세의 `isDemo`, `retreatSlug`는 가상 행사 표시와 전용 신청서 연결에 사용합니다. 공개 홈에는 신청자의 이름·연락처·기도 제목을 포함하지 않습니다. 답변은 인증된 본인과 관리자에게만 검증된 필드로 반환합니다.

## 프로필 잠금과 신청 처리

- 이름·또래·성별·연락처가 프로필에 이미 있으면 신청서에서 재사용합니다. 서버도 정규화한 저장값과 제출값을 비교하므로 화면의 잠금을 풀어 변조해도 `PROFILE_FIELD_LOCKED`로 거절합니다.
- 비어 있던 프로필 값만 등록 시 채웁니다. 프로필 자체의 정정은 계정 화면 또는 `PATCH /v1/me`에서 수행하며, 기존 신청 답변을 함께 바꾸지는 않습니다.
- 출발 선택은 `main`·`late`·`car`·`other`입니다. 자차·기타는 출발 메모가 필요합니다. 기도 제목은 선택 사항이며 최대 2,000자입니다. **출발 정보와 기도 제목은 USER 프로필에 저장하지 않습니다.**
- USER → EVENT → REGISTRATION 순서로 잠그고 자격·접수 기간·행사 버전을 검사합니다. 프로필 채움과 신청 저장은 같은 트랜잭션이며 하나가 실패하면 모두 되돌립니다.
- 같은 계정·행사에는 신청 한 개만 유지합니다. 동일한 확정 요청의 재시도는 기존 신청을 반환하고, 다른 답변으로 다시 제출하면 `RETREAT_ALREADY_REGISTERED`로 거절합니다.
- 취소 후 전용 신청서로 재신청하면 같은 신청 ID의 새 버전과 답변을 저장합니다. 늦게 도착한 과거 취소 요청은 새 신청을 취소하지 못합니다.
- 일반 행사 신청 API는 `RETREAT_FORM_REQUIRED`, 일반 신청 이름 정정 API는 `RETREAT_PROFILE_LOCKED`로 우회를 차단합니다.

## 계정 통합·삭제와 개인정보

계정 통합은 유지 계정의 프로필 값을 우선하고 비어 있는 값만 채웁니다. 같은 행사에 유효한 신청 두 개의 수련회 답변이 다르면 자동 통합하지 않습니다. 통합 미리보기와 변경 기록에 연락처·기도 제목의 추가 사본을 남기지 않습니다.

통합되는 원래 계정의 프로필 정보는 비우고 기존 세션을 폐기합니다. 계정 삭제는 프로필의 또래·성별·연락처와 모든 신청의 `retreat_answers`를 제거하며, 남기는 신청·출석 기록의 참가 이름은 익명화합니다. OAuth 제공자 자체의 동의 철회는 앱 계정 삭제와 별도입니다.

## 검증

```sh
ACCOUNT_TEST_DATABASE_URL=postgres://USER@127.0.0.1:6547/itda_test \
EVENT_TEST_DATABASE_URL=postgres://USER@127.0.0.1:6547/itda_test npm test
```

실제 PostgreSQL 테스트는 격리 스키마에서 프로필 변조 차단, 동시·중복 등록, 취소·재신청, 일반 API 우회, 실패 시 전체 롤백, 공개 응답의 개인정보 제외를 확인합니다. 테스트 DB 환경 변수를 생략하면 DB 테스트는 건너뜁니다. OAuth 제공자와 실제 기기의 로그인 검증은 별도로 수행합니다.
