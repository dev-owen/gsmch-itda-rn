# 앱 글꼴

현재 한글은 **나눔명조 Regular / Bold**를 앱에 포함해 사용합니다. Google Fonts 공식 배포본이며 원본 파일을 변경하지 않았습니다. SIL Open Font License는 `OFL-NanumMyeongjo.txt`에 있습니다.

Tiempos는 아직 파일이 제공되지 않아 포함되어 있지 않습니다. 영문은 플랫폼 셰리프(웹/iOS Georgia, Android serif)로 표시합니다. 대체 글꼴을 Tiempos라는 이름으로 등록하지 않습니다.

Tiempos Text 앱용 TTF를 준비하면 `assets/fonts/tiempos/`에 넣고 `src/theme/font-assets.ts`의 `tiemposFaces`에 추가합니다.

```ts
export const tiemposFaces: FontFamilyDefinition['fontDefinitions'] = [
  { path: require('../../assets/fonts/tiempos/TiemposText-Regular.ttf'), weight: 400 },
  { path: require('../../assets/fonts/tiempos/TiemposText-Semibold.ttf'), weight: 600 },
  { path: require('../../assets/fonts/tiempos/TiemposText-Bold.ttf'), weight: 700 },
];
```

구입한 파일명에 맞게 경로를 지정합니다. 변수 폰트라면 weight를 고정하지 않은 하나의 face로 등록할 수 있습니다. 글꼴 파일은 별도 허용 없이 공개 저장소에 올리지 않습니다. 앱을 다시 번들링하면 전체 텍스트의 영문 부분에 적용되며, 한글은 나눔명조를 유지합니다. 입력 필드와 탭 라벨도 한글 명조를 사용하고 기호 아이콘은 시스템 글꼴을 유지합니다.

- 제작사: https://klim.co.nz/fonts/tiempos-text/
- 나눔명조 배포본: https://github.com/google/fonts/tree/main/ofl/nanummyeongjo
