import { createContext, useContext, type PropsWithChildren } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { useFonts } from 'expo-font';
import { fontAssets, tiemposFaces } from './font-assets';
import { palette } from './tokens';

const systemSerif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif', web: '"Tiempos Text", Tiempos, Georgia, serif' });
const systemKorean = Platform.select({ ios: 'AppleMyungjo', android: 'serif', default: 'serif', web: '"Nanum Myeongjo", "Noto Serif KR", serif' });
export const symbolFont = Platform.select({ ios: 'System', android: 'sans-serif', default: 'sans-serif', web: 'system-ui, sans-serif' });
const fallback = { latin: systemSerif, korean: systemKorean };
const Typography = createContext(fallback);

export function TypographyProvider({ children }: PropsWithChildren) {
  const [loaded, error] = useFonts(fontAssets);
  if (!loaded && !error) return <View style={styles.loading}><ActivityIndicator color={palette.forest} accessibilityLabel="글꼴을 준비하고 있어요" /></View>;
  const fonts = loaded ? { latin: tiemposFaces.length ? 'ItdaTiemposText' : systemSerif, korean: 'ItdaMyeongjo' } : fallback;
  return <Typography.Provider value={fonts}>{children}</Typography.Provider>;
}
export function useTypography() { return useContext(Typography); }
const styles = StyleSheet.create({ loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.background } });
