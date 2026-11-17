import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { AppText as Text } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import { FeaturedEventCard } from '@/components/event-card';
import type { EventItem } from '@/domain/types';
import { palette } from '@/theme/tokens';

/** Both swipe directions advance in the same order. No like/dislike action is recorded. */
export function EventDeck({ events, now }: { events: EventItem[]; now: number }) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState(320);
  const [position] = useState(() => new Animated.Value(0));
  const animating = useRef(false);
  const reduceMotion = useRef(false);
  const suppressPress = useRef(false);
  const capturedOffset = useRef(0);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasNext = events.length > 1;
  const currentIndex = index % Math.max(events.length, 1);
  const current = events[currentIndex];
  const next = events[(currentIndex + 1) % events.length];

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (mounted) reduceMotion.current = value; });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { reduceMotion.current = value; });
    return () => { mounted = false; subscription.remove(); position.stopAnimation(); if (pressTimer.current) clearTimeout(pressTimer.current); };
  }, [position]);

  useLayoutEffect(() => {
    position.setValue(0);
    animating.current = false;
  }, [index, position]);

  const advance = useCallback((direction: -1 | 1) => {
    if (!hasNext || animating.current) return;
    animating.current = true;
    Animated.timing(position, {
      toValue: direction * (width + 120),
      duration: reduceMotion.current ? 0 : 220,
      useNativeDriver: Platform.OS !== 'web',
    }).start(({ finished }) => {
      if (finished) setIndex(value => value + 1);
      else { position.setValue(0); animating.current = false; }
    });
  }, [hasNext, position, width]);

  const reset = useCallback(() => {
    Animated.spring(position, { toValue: 0, speed: 24, bounciness: reduceMotion.current ? 0 : 5, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [position]);

  const finishGesture = useCallback(() => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    // A mouse click may follow mouseup even after a drag on React Native Web.
    pressTimer.current = setTimeout(() => { suppressPress.current = false; }, 250);
  }, []);

  // PanResponder only registers these callbacks; refs are read when a gesture fires.
  // eslint-disable-next-line react-hooks/refs
  const responder = useMemo(() => PanResponder.create({
    // Leave taps and vertical scrolling to the card and the surrounding screen.
    onMoveShouldSetPanResponderCapture: (_, gesture) => {
      const capture = hasNext && !animating.current && Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.3;
      if (capture) capturedOffset.current = gesture.dx;
      return capture;
    },
    onPanResponderGrant: () => { position.stopAnimation(); suppressPress.current = true; if (pressTimer.current) clearTimeout(pressTimer.current); },
    onPanResponderMove: (_, gesture) => { position.setValue(gesture.dx + capturedOffset.current); },
    onPanResponderRelease: (_, gesture) => {
      const distance = gesture.dx + capturedOffset.current;
      if (Math.abs(distance) > Math.min(width * 0.24, 90) || (Math.abs(distance) > 20 && Math.abs(gesture.vx) > 0.6)) advance(distance < 0 ? -1 : 1);
      else reset();
      finishGesture();
    },
    onPanResponderTerminationRequest: () => true,
    onPanResponderTerminate: () => { reset(); finishGesture(); },
  }), [advance, finishGesture, hasNext, position, reset, width]);

  if (!current) return null;

  return <View style={styles.section}>
    <View style={styles.heading}>
      <View style={styles.headingCopy}><Text accessibilityRole="header" style={styles.title}>다가오는 만남</Text><Text style={styles.subtitle}>{hasNext ? '한 장씩, 반가운 소식을 만나보세요' : '새로운 소식을 만나보세요'}</Text></View>
      <View style={styles.counter}><Text accessibilityLiveRegion="polite" style={styles.counterText}>{currentIndex + 1} / {events.length}</Text></View>
    </View>
    <View style={styles.stack} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
      {hasNext && <>
        <View pointerEvents="none" accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.backCard} />
        <View pointerEvents="none" accessible={false} aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.nextCard}><FeaturedEventCard event={next} now={now} preview /></View>
      </>}
      <Animated.View {...responder.panHandlers} style={[styles.activeCard, Platform.OS === 'web' && styles.webGesture, { transform: [{ translateX: position }, { rotate: position.interpolate({ inputRange: [-width, 0, width], outputRange: ['-9deg', '0deg', '9deg'], extrapolate: 'clamp' }) }], opacity: position.interpolate({ inputRange: [-width - 120, 0, width + 120], outputRange: [0, 1, 0], extrapolate: 'clamp' }) }]}>
        <FeaturedEventCard event={current} now={now} onPress={() => { if (!suppressPress.current && !animating.current) router.push({ pathname: '/events/[id]', params: { id: current.id } }); }} />
      </Animated.View>
    </View>
    <View style={styles.controls}>
      <Pressable disabled={!hasNext} accessibilityRole="button" accessibilityLabel="왼쪽으로 넘겨 다음 소식" accessibilityState={{ disabled: !hasNext }} onPress={() => advance(-1)} style={({ pressed }) => [styles.directionButton, !hasNext && styles.disabled, pressed && styles.pressed]}><AppIcon name="chevron-left" size={19} /></Pressable>
      <View style={styles.controlCopy}><View style={styles.dots}>{events.slice(0, 7).map((event, dot) => <View key={event.id} style={[styles.dot, dot === currentIndex % 7 && styles.activeDot]} />)}</View><Text style={styles.controlHint}>{hasNext ? '어느 쪽이든 다음 소식으로' : '새 소식이 올라오면 함께 보여드릴게요'}</Text></View>
      <Pressable disabled={!hasNext} accessibilityRole="button" accessibilityLabel="오른쪽으로 넘겨 다음 소식" accessibilityState={{ disabled: !hasNext }} onPress={() => advance(1)} style={({ pressed }) => [styles.directionButton, !hasNext && styles.disabled, pressed && styles.pressed]}><AppIcon name="chevron-right" size={19} /></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 16 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headingCopy: { flex: 1, gap: 4 }, title: { color: palette.ink, fontSize: 18, lineHeight: 28, fontWeight: '700', letterSpacing: -0.4 }, subtitle: { color: palette.muted, fontSize: 12, lineHeight: 20 },
  counter: { backgroundColor: palette.stone, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 15 }, counterText: { color: palette.forest, fontSize: 12, lineHeight: 19, fontWeight: '600', fontVariant: ['tabular-nums'] },
  stack: { paddingBottom: 16 }, activeCard: { zIndex: 2 }, webGesture: { touchAction: 'pan-y', userSelect: 'none' },
  backCard: { position: 'absolute', top: 24, bottom: 0, left: 20, right: 20, borderRadius: 28, backgroundColor: palette.peach },
  nextCard: { position: 'absolute', top: 9, left: 9, right: 9, bottom: 8, borderRadius: 28, overflow: 'hidden', opacity: 0.7 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 }, directionButton: { flexShrink: 0, width: 44, height: 44, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, alignItems: 'center', justifyContent: 'center' }, controlCopy: { flex: 1, minWidth: 0, gap: 7, alignItems: 'center' }, dots: { flexDirection: 'row', alignItems: 'center', gap: 5 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.border }, activeDot: { width: 17, backgroundColor: palette.forest }, controlHint: { textAlign: 'center', color: palette.muted, fontSize: 12, lineHeight: 20 }, disabled: { opacity: 0.35 }, pressed: { opacity: 0.65 },
});
