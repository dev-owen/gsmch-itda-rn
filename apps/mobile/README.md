# 잇다 모바일 앱

선한목자 젊은이교회 행사 앱입니다. Expo SDK 58 / React Native / Expo Router를 사용합니다.

```sh
npm ci
cp .env.example .env.local
npm start
```

Node.js 22.13 이상을 사용하세요. API·DB·OAuth 설정 및 전체 실행 순서는 작업공간 루트의 `README.md`에 있습니다.

```sh
npm run lint
npm run typecheck
npm run export
```

공개 목록/상세, 내 신청, 계정 연결/통합, 관리자 행사·성도 인증·출석 관리 화면을 포함합니다. 네이티브 OAuth는 `itda://` scheme을 사용하는 개발 빌드에서 확인해야 합니다. 앱에 OAuth 비밀키를 넣지 마세요.

글꼴은 공통 셰리프 설정을 사용합니다. 한글은 나눔명조를 포함하고, Tiempos Text 앱용 파일은 아직 제공되지 않아 영문에 기본 셰리프를 사용합니다. 파일 추가 방법은 [글꼴 안내](assets/fonts/README.md)를 참고하세요.

## 디자인

[사용자가 지정한 KitCraft 소개 글](https://payhip.com/KitCraftkosmu/blog/news/open-figma-with-a-head-start-find-your-next-free-ui-kit)의 [SkillSnap — Microlearning Mobile App UI](https://www.creativefabrica.com/product/skillsnap-microlearning-mobile-app-ui/)를 참고했습니다. 편집 중심의 콘텐츠 카드, 대표 소식, 분류 탐색, 둥근 하단 메뉴를 교회 소식과 수련회 신청 흐름에 맞춰 구현했습니다. 공통 색상은 `src/theme/tokens.ts`, 버튼·카드·입력창은 `src/components/ui.tsx`에 있습니다.

원본 키트는 구독/무료 체험 상품입니다. 가입·결제·체험 시작 없이 공개 미리보기의 일반적인 구성 방식을 참고했으며, 원본 Figma 파일·사진·유료 폰트는 포함하지 않았습니다. 화면 내 공통 아이콘과 공동체·수련회·섬김 일러스트는 이 앱에서 직접 작성한 SVG 컴포넌트입니다. 실제 교회 건물이나 행사장을 나타내지 않습니다.

하단 탭에는 [Flaticon Uicons](https://www.flaticon.com/uicons)의 Regular Rounded 아이콘(신문·캠핑·체크된 달력·사용자)을 사용합니다. 원본 폰트와 추출 JSON은 저장소에 포함하지 않습니다. `npm ci`가 고정된 공식 배포본 3.3.1을 설치한 뒤, 폰트 SHA-256을 확인하고 네 개의 윤곽선을 로컬에서 생성합니다. 시작·내보내기 및 `npm run prebuild` 전에 같은 생성기를 실행합니다. 설치 스크립트를 생략했다면 `npm run generate:icons`를 먼저 실행하세요. 생성한 아이콘은 `react-native-svg`로 표시하므로 실행 중에는 네트워크가 필요하지 않습니다. 내 계정 화면에 `Uicons by Flaticon` 출처 링크를 표시합니다. 버전과 라이선스는 [아이콘 안내](assets/icons/flaticon/README.md)에 기록했습니다.
