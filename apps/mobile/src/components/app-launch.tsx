import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { Animated, BackHandler, Platform, StyleSheet, View } from 'react-native';
import { usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useSession } from '@/services/session';
import { useTypographyReady } from '@/theme/typography';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { palette } from '@/theme/tokens';
import { LaunchScreen } from './launch-screen';

// Hold the native still until the matching React surface has actually laid out.
if (Platform.OS !== 'web') void SplashScreen.preventAutoHideAsync().catch(() => {});

type ContentSignal = { source: symbol; scope: string; ready: boolean };
type LaunchContent = { report(signal: ContentSignal): void; clear(source: symbol): void };
const LaunchContentContext = createContext<LaunchContent | null>(null);

/** Report the first home request for the current identity, including failures. */
export function useLaunchContentReady(scope: string, ready: boolean) {
  const content = useContext(LaunchContentContext);
  const [source] = useState(() => Symbol('launch-content'));
  useEffect(() => {
    content?.report({ source, scope, ready });
    return () => content?.clear(source);
  }, [content, source, scope, ready]);
}

export function AppLaunch({ children }: PropsWithChildren) {
  const { user, loading: sessionLoading } = useSession();
  const fontsReady = useTypographyReady();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);
  const [introComplete, setIntroComplete] = useState(false);
  const [slow, setSlow] = useState(false);
  const [continueRequested, setContinueRequested] = useState(false);
  const [contentSignal, setContentSignal] = useState<ContentSignal | null>(null);
  const [opacity] = useState(() => new Animated.Value(1));
  const nativeHidden = useRef(false);
  const [content] = useState<LaunchContent>(() => ({
    report: signal => setContentSignal(signal),
    clear: source => setContentSignal(previous => previous?.source === source ? null : previous),
  }));
  const expectedScope = `${user?.id || 'public'}:${user?.isMemberVerified}:${user?.role}:${user?.status}`;
  const home = pathname === '/' || pathname === '/events';
  const homeReady = !home || (contentSignal?.scope === expectedScope && contentSignal.ready);
  const ready = !sessionLoading && fontsReady && homeReady;
  const dismiss = visible && (continueRequested || (introComplete && ready));

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!dismiss) {
      opacity.setValue(1);
      return;
    }
    const animation = Animated.timing(opacity, { toValue: 0, duration: reducedMotion ? 0 : 300, useNativeDriver: true });
    animation.start(({ finished }) => { if (finished) setVisible(false); });
    return () => animation.stop();
  }, [dismiss, opacity, reducedMotion]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [visible, pathname]);

  const onOverlayLayout = useCallback(() => {
    if (nativeHidden.current) return;
    nativeHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, []);
  const onIntroComplete = useCallback(() => setIntroComplete(true), []);
  const onContinue = useCallback(() => setContinueRequested(true), []);
  const phase = introComplete && !ready ? slow ? 'slow' : 'waiting' : 'intro';

  return <LaunchContentContext.Provider value={content}>
    <View style={styles.root}>
      <View style={styles.root} pointerEvents={visible ? 'none' : 'auto'} accessibilityElementsHidden={visible} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'} aria-hidden={visible} {...(Platform.OS === 'web' ? { inert: visible } : {})}>
        {children}
      </View>
      {visible && <Animated.View onLayout={onOverlayLayout} style={[styles.overlay, { opacity }]} accessibilityViewIsModal>
        <LaunchScreen phase={phase} onIntroComplete={onIntroComplete} onContinue={onContinue} />
      </Animated.View>}
    </View>
  </LaunchContentContext.Provider>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 1000, elevation: 1000, backgroundColor: palette.background },
});
