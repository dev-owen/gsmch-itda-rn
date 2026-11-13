import { View, type ColorValue } from 'react-native';
import Svg, { G, Path } from 'react-native-svg';
import icons from '@/assets/icons/flaticon/regular-rounded.json';
import { palette } from '@/theme/tokens';

export type FlaticonTabIconName = keyof typeof icons.paths;

/** Uicons by Flaticon. Official Regular Rounded outlines, bundled for offline use. */
export function FlaticonTabIcon({ name, size = 21, color = palette.forest }: { name: FlaticonTabIconName; size?: number; color?: ColorValue | null }) {
  return <View accessible={false} importantForAccessibility="no-hide-descendants" pointerEvents="none" style={{ width: size, height: size }}>
    <Svg width={size} height={size} viewBox={icons.viewBox} fill={color ?? palette.forest}>
      <G transform={icons.transform}><Path d={icons.paths[name]} /></G>
    </Svg>
  </View>;
}
