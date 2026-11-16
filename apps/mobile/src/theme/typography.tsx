import { createContext, useContext, type PropsWithChildren } from 'react';
import { Platform } from 'react-native';
import { useFonts } from 'expo-font';
import { fontAssets, tiemposFaces } from './font-assets';

const systemSerif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif', web: '"Tiempos Text", Tiempos, Georgia, serif' });
const systemKorean = Platform.select({ ios: 'AppleMyungjo', android: 'serif', default: 'serif', web: '"Nanum Myeongjo", "Noto Serif KR", serif' });
export const symbolFont = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif', web: 'system-ui, sans-serif' });
const fallback = { latin: systemSerif, korean: systemKorean };
const Typography = createContext(fallback);
const TypographyReady = createContext(false);

export function TypographyProvider({ children }: PropsWithChildren) {
  const [loaded, error] = useFonts(fontAssets);
  // Mount the app immediately so data and fonts can load behind the launch screen together.
  const fonts = loaded ? { latin: tiemposFaces.length ? 'ItdaTiemposText' : systemSerif, korean: 'ItdaMyeongjo' } : fallback;
  return <TypographyReady.Provider value={loaded || !!error}><Typography.Provider value={fonts}>{children}</Typography.Provider></TypographyReady.Provider>;
}
export function useTypography() { return useContext(Typography); }
export function useTypographyReady() { return useContext(TypographyReady); }
