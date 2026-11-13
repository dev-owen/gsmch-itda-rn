import type { ReactNode } from 'react';
import { View, type ColorValue } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/tokens';

export type IconName = 'calendar' | 'home' | 'arrow-right' | 'arrow-up-right' | 'search' | 'map-pin' | 'users' | 'check' | 'chevron-left' | 'chevron-right' | 'tent' | 'user' | 'bookmark' | 'clock' | 'mail' | 'lock' | 'heart' | 'book' | 'cross' | 'log-out';

const drawings: Record<IconName, ReactNode> = {
  calendar: <><Rect x="3.5" y="5" width="17" height="15.5" rx="3" /><Path d="M7.5 3v4m9-4v4M4 10h16m-12 4h2m4 0h2m-8 3.5h2" /></>,
  home: <><Path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2h-4v-8H9v8H5a2 2 0 0 1-2-2z" /></>,
  'arrow-right': <Path d="M4 12h15m-6-6 6 6-6 6" />,
  'arrow-up-right': <Path d="M6 18 18 6M6 6h12v12" />,
  search: <><Circle cx="10.5" cy="10.5" r="6.5" /><Path d="m15.5 15.5 5 5" /></>,
  'map-pin': <><Path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><Circle cx="12" cy="10" r="2.5" /></>,
  users: <><Circle cx="9" cy="8" r="3" /><Path d="M3 20v-2a6 6 0 0 1 12 0v2m1-15a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" /></>,
  check: <Path d="m5 12 4.5 4.5L19 7" />,
  'chevron-left': <Path d="m15 5-7 7 7 7" />,
  'chevron-right': <Path d="m9 5 7 7-7 7" />,
  tent: <><Path d="m3 20 9-16 9 16H3Zm5 0 4-8 4 8M10 3l2 1 2-1" /></>,
  user: <><Circle cx="12" cy="8" r="3.5" /><Path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  bookmark: <Path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z" />,
  clock: <><Circle cx="12" cy="12" r="9" /><Path d="M12 7v5l3.5 2" /></>,
  mail: <><Rect x="3" y="5" width="18" height="14" rx="3" /><Path d="m4 7 8 6 8-6" /></>,
  lock: <><Rect x="5" y="10" width="14" height="11" rx="3" /><Path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  heart: <Path d="M12 20 4 12a5 5 0 0 1 8-6 5 5 0 0 1 8 6l-8 8Z" />,
  book: <><Path d="M12 6c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1v15" /><Path d="M6 9h3m6 0h3" /></>,
  cross: <Path d="M12 3v18M5 9h14" />,
  'log-out': <><Path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-13 5 5-5 5m-5-5h10" /></>,
};

/** Small, original line icons shared by every platform. */
export function AppIcon({ name, size = 22, color = palette.forest, strokeWidth = 1.7 }: { name: IconName; size?: number; color?: ColorValue | null; strokeWidth?: number }) {
  return <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size }}><Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color ?? palette.forest} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">{drawings[name]}</Svg></View>;
}
