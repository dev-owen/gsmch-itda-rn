import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider } from '@/services/session';
import { RetreatDraftProvider } from '@/components/retreat-draft';
import { AppLaunch } from '@/components/app-launch';
import { TypographyProvider } from '@/theme/typography';
import { palette } from '@/theme/tokens';

export default function RootLayout() {
  return <SafeAreaProvider><TypographyProvider><SessionProvider><RetreatDraftProvider><StatusBar style="dark" /><AppLaunch><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.background } }} /></AppLaunch></RetreatDraftProvider></SessionProvider></TypographyProvider></SafeAreaProvider>;
}
