import type { FontFamilyDefinition } from 'expo-font';

// Add licensed app-font TTF faces here. Keep the original font files unchanged.
// Example: { path: require('../../assets/fonts/tiempos/TiemposText-Regular.ttf'), weight: 400 }
export const tiemposFaces: FontFamilyDefinition['fontDefinitions'] = [];

export const fontAssets: FontFamilyDefinition[] = [
  { fontFamily: 'ItdaMyeongjo', fontDefinitions: [
    { path: require('../../assets/fonts/NanumMyeongjo-Regular.ttf'), weight: 400 },
    { path: require('../../assets/fonts/NanumMyeongjo-Bold.ttf'), weight: 700 },
  ] },
  ...(tiemposFaces.length ? [{ fontFamily: 'ItdaTiemposText', fontDefinitions: tiemposFaces }] : []),
];
