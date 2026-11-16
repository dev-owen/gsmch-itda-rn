import { useEffect, useId, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { AppText as Text } from '@/components/app-text';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { palette } from '@/theme/tokens';

export type LaunchPhase = 'intro' | 'waiting' | 'slow';

// The existing app symbol, kept as a vector so it stays crisp at every size.
export const ITDA_SYMBOL = 'M353.554 0H298.446C273.006 0 249.684 14.6347 237.962 37.9539L4.37994 502.646C-1.04325 513.435 -1.45067 526.178 3.2716 537.313L22.6123 582.918C34.6475 611.297 72.5404 614.156 88.4414 587.885L309.863 222.063C313.34 216.317 319.439 212.826 326 212.826C332.561 212.826 338.659 216.317 342.137 222.063L563.559 587.885C579.46 614.156 617.352 611.297 629.388 582.918L648.728 537.313C653.451 526.178 653.043 513.435 647.62 502.646L414.038 37.9539C402.316 14.6347 378.994 0 353.554 0Z';

function useBreath(reduced: boolean) {
  const [value] = useState(() => new Animated.Value(0));
  useEffect(() => {
    value.setValue(0);
    if (reduced) return;
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
      Animated.timing(value, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true, isInteraction: false }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [reduced, value]);
  return value;
}

/** Two sides settle into the familiar symbol; a small light rises between them. */
export function ConnectionArtwork({ size = 260, progress, reduced = false }: {
  size?: number; progress?: Animated.Value; reduced?: boolean;
}) {
  const [still] = useState(() => new Animated.Value(1));
  const reveal = progress || still;
  const breath = useBreath(reduced);
  const id = useId().replace(/:/g, '');
  return <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size }}>
    <Animated.View style={[StyleSheet.absoluteFill, {
      opacity: reveal.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0.35, 1, 1] }),
      transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) }],
    }]}>
      <Svg width="100%" height="100%" viewBox="0 0 260 260">
        <Defs><RadialGradient id={`glow-${id}`} cx="50%" cy="50%" r="50%"><Stop offset="0" stopColor="#EBCBA3" stopOpacity="0.52" /><Stop offset="0.55" stopColor="#F0DEC5" stopOpacity="0.3" /><Stop offset="1" stopColor={palette.background} stopOpacity="0" /></RadialGradient></Defs>
        <Circle cx="130" cy="129" r="128" fill={`url(#glow-${id})`} />
        <Circle cx="130" cy="129" r="98" fill="none" stroke="#DBD7C5" strokeWidth="0.7" />
        <Circle cx="130" cy="129" r="82" fill="none" stroke="#E4DFCE" strokeWidth="0.6" />
        <Ellipse cx="130" cy="163" rx="112" ry="39" fill="none" stroke="#C3CBB7" strokeWidth="0.85" transform="rotate(-17 130 163)" />
        <Circle cx="29" cy="180" r="3" fill="#9BA989" />
        <Circle cx="220" cy="133" r="2.5" fill="#C29B68" />
      </Svg>
    </Animated.View>
    {(['left', 'right'] as const).map(side => <Animated.View key={side} style={[styles.symbolLayer, {
      left: size * 0.346, top: size * 0.35, width: size * 0.308, height: size * 0.286,
      opacity: reveal.interpolate({ inputRange: [0, 0.12, 0.55, 1], outputRange: [0, 0.3, 1, 1] }),
      transform: [
        { translateX: reveal.interpolate({ inputRange: [0, 0.56, 1], outputRange: [side === 'left' ? -size * 0.14 : size * 0.14, 0, 0] }) },
        { translateY: reveal.interpolate({ inputRange: [0, 0.56, 1], outputRange: [size * 0.06, 0, 0] }) },
      ],
    }]}>
      <Svg width="100%" height="100%" viewBox="0 0 652 606">
        <Defs><ClipPath id={`${side}-${id}`}><Rect x={side === 'left' ? 0 : 326} y="0" width="326" height="606" /></ClipPath></Defs>
        <G clipPath={`url(#${side}-${id})`}><Path d={ITDA_SYMBOL} fill={palette.forest} /></G>
      </Svg>
    </Animated.View>)}
    <Animated.View style={[styles.sun, {
      left: size * 0.465, top: size * 0.235, width: size * 0.07, height: size * 0.07, borderRadius: size,
      opacity: reveal.interpolate({ inputRange: [0, 0.18, 0.6, 1], outputRange: [0, 0, 1, 1] }),
      transform: [
        { translateY: Animated.add(reveal.interpolate({ inputRange: [0, 0.65, 1], outputRange: [size * 0.2, 0, 0] }), breath.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.015] })) },
        { scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.05] }) },
      ],
    }]} />
  </View>;
}

function BreathingDots({ reduced }: { reduced: boolean }) {
  const breath = useBreath(reduced);
  return <View style={styles.dots} accessible={false}>{[0, 1, 2].map(index => <Animated.View key={index} style={[styles.dot, {
    backgroundColor: index === 1 ? '#BB9462' : palette.forest,
    opacity: reduced ? 0.65 : breath.interpolate({ inputRange: [0, 0.5, 1], outputRange: index === 1 ? [0.35, 1, 0.35] : [0.75, 0.3, 0.75] }),
  }]} />)}</View>;
}

export function LaunchScreen({ phase, onIntroComplete, onContinue }: {
  phase: LaunchPhase; onIntroComplete: () => void; onContinue: () => void;
}) {
  const reduced = useReducedMotion();
  // Measure after layout so the static web export and first client render agree.
  const [screenHeight, setScreenHeight] = useState(0);
  const artworkSize = screenHeight ? Math.min(260, Math.max(150, screenHeight * 0.3)) : 260;
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    progress.setValue(reduced ? 1 : 0);
    const animation = Animated.timing(progress, { toValue: 1, duration: reduced ? 0 : 2200, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start();
    const timer = setTimeout(onIntroComplete, reduced ? 200 : 2700);
    return () => { animation.stop(); clearTimeout(timer); };
  }, [onIntroComplete, progress, reduced]);

  const waiting = phase !== 'intro';
  return <SafeAreaView style={styles.screen} onLayout={event => setScreenHeight(event.nativeEvent.layout.height)}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} bounces={false}>
    <View style={styles.center}>
      <ConnectionArtwork size={artworkSize} progress={progress} reduced={reduced} />
      <Animated.View style={[styles.lockup, {
        opacity: progress.interpolate({ inputRange: [0, 0.3, 0.75, 1], outputRange: [0, 0, 1, 1] }),
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 0.3, 0.8, 1], outputRange: [12, 12, 0, 0] }) }],
      }]}>
        <Text style={styles.wordmark}>잇다</Text>
        <Text style={styles.tagline}>믿음 안에서, 우리의 만남을 잇다</Text>
      </Animated.View>
      <View style={styles.status}>
        {waiting && <><View style={styles.statusMessage} accessibilityLiveRegion="polite" accessibilityRole="progressbar" accessibilityLabel={phase === 'slow' ? '연결이 조금 늦어지고 있어요' : '반가운 소식을 불러오고 있어요'} accessibilityValue={{ text: '소식을 불러오는 중' }}><BreathingDots reduced={reduced} /><Text style={styles.statusText}>{phase === 'slow' ? '연결이 조금 늦어지고 있어요' : '반가운 소식을 불러오고 있어요'}</Text></View>{phase === 'slow' && <><Text style={styles.slowHelp}>잠시 더 기다리거나 먼저 둘러보세요.</Text><Pressable accessibilityRole="button" onPress={onContinue} style={({ pressed }) => [styles.continue, pressed && { opacity: 0.6 }]}><Text style={styles.continueText}>화면 먼저 보기</Text></Pressable></>}</>}
      </View>
    </View>
    <View style={styles.footer}><Text style={styles.church}>선한목자 젊은이교회</Text><Text style={styles.motto}>WITH JESUS, LIKE JESUS</Text></View>
    </ScrollView>
  </SafeAreaView>;
}

/** Shared, light-weight continuation of the launch artwork for in-screen waits. */
export function BrandLoading({ label = '잠시만 기다려 주세요' }: { label?: string }) {
  const reduced = useReducedMotion();
  return <View style={styles.inline} accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ text: '불러오는 중' }} accessibilityLiveRegion="polite">
    <ConnectionArtwork size={112} reduced={reduced} />
    <Text style={styles.inlineLabel}>{label}</Text>
    <BreathingDots reduced={reduced} />
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: palette.background, alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1, width: '100%' }, scrollContent: { flexGrow: 1, alignItems: 'center' },
  center: { flex: 1, justifyContent: 'center', width: '100%', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  symbolLayer: { position: 'absolute' }, sun: { position: 'absolute', backgroundColor: '#C29B68' },
  lockup: { alignItems: 'center', marginTop: -19, gap: 14 },
  wordmark: { color: palette.forestDark, fontSize: 46, lineHeight: 62, letterSpacing: 3, fontWeight: '700', paddingLeft: 3 },
  tagline: { fontSize: 13, lineHeight: 24, color: '#737B6C', letterSpacing: 0.2, textAlign: 'center' },
  status: { minHeight: 136, alignItems: 'center', paddingTop: 30, gap: 12 },
  statusMessage: { alignItems: 'center', gap: 12 },
  statusText: { fontSize: 12, lineHeight: 22, textAlign: 'center', color: palette.muted },
  slowHelp: { fontSize: 11, lineHeight: 19, color: palette.muted, textAlign: 'center', marginTop: -8 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, height: 10 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  continue: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, borderWidth: 1, borderColor: '#D4D9C9', borderRadius: 24 },
  continueText: { fontSize: 12, lineHeight: 21, color: palette.forest },
  footer: { alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 30, paddingTop: 12 },
  church: { fontSize: 11, lineHeight: 20, color: palette.muted, letterSpacing: 0.6 },
  motto: { fontSize: 8, lineHeight: 14, color: '#9A9C8C', letterSpacing: 1.9 },
  inline: { alignItems: 'center', gap: 13, paddingVertical: 20 },
  inlineLabel: { fontSize: 13, lineHeight: 23, color: palette.muted, textAlign: 'center', marginTop: -4 },
});
