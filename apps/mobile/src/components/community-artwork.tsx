import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { palette } from '@/theme/tokens';

/** Original decorative artwork; it does not depict a real church or venue. */
export function CommunityArtwork({ variant = 'gathering', compact = false, style }: { variant?: 'gathering' | 'retreat' | 'service'; compact?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.frame, compact && styles.compact, style]}>
    <Svg width="100%" height="100%" viewBox="0 0 360 220" preserveAspectRatio="xMidYMid slice">
      <Rect width="360" height="220" fill={variant === 'service' ? palette.peach : variant === 'retreat' ? '#DCE9E2' : '#E5EAD9'} />
      <Circle cx="280" cy="53" r="31" fill="#D9AD7C" />
      <Path d="M0 146C76 94 112 147 188 128c84-22 114-8 172 11v81H0Z" fill="#C1D0B3" />
      <Path d="M0 193c72-12 89-43 156-36 92 9 138 7 204-12v75H0Z" fill="#8EAA90" />
      {variant === 'retreat' ? <>
        <Path d="m59 156 48-103 48 103Z" fill="#557E67" /><Path d="m90 156 39-80 39 80Z" fill="#426D58" />
        <Path d="m201 160 42-91 42 91Z" fill="#6A8C72" /><Path d="m246 165 39-98 39 98Z" fill="#38624F" />
        <Path d="m114 187 62-92 70 92Z" fill="#F4E7CC" /><Path d="m150 187 26-51 28 51Z" fill="#375D4C" />
        <Path d="m176 95 70 92h-42l-28-51Z" fill="#E5CBA5" />
        <Path d="M176 187c-9 12-9 22-6 33h52c-21-15-31-26-35-33" fill="#EADBC0" />
        <Circle cx="39" cy="45" r="2" fill={palette.surface} /><Circle cx="186" cy="42" r="3" fill={palette.surface} /><Circle cx="324" cy="91" r="2" fill={palette.surface} />
      </> : variant === 'service' ? <>
        <Path d="M108 177c5-18 20-24 38-19l29 12c9 4 14 1 20-3l36-26c17-12 30 4 16 16l-53 40c-9 7-19 8-31 5l-60-15" fill="#F5D8B5" stroke="#245244" strokeWidth="3" />
        <Path d="M140 162h43c18 0 19 19 2 21h-26" fill="#F5D8B5" stroke="#245244" strokeWidth="3" strokeLinecap="round" />
        <Path d="M182 144V77m0 35c-33 0-42-21-33-36 28-2 40 16 33 36Zm0-17c29 1 45-16 39-36-29-3-42 14-39 36Z" fill="#507C5E" stroke="#245244" strokeWidth="3" />
        <Circle cx="76" cy="77" r="18" fill="#E8C7A5" /><Path d="m268 103 5 5m0-10-5 5" stroke="#8E7554" strokeWidth="2" strokeLinecap="round" />
      </> : <>
        <Path d="M104 173V89a76 76 0 0 1 152 0v84Z" fill="#F7F0DF" />
        <Path d="M126 173V94a54 54 0 0 1 108 0v79Z" fill="#D0DDBD" />
        <Path d="M180 65v48m-17-30h34" stroke="#52785D" strokeWidth="5" strokeLinecap="round" />
        <Path d="M0 204c81-19 149-22 220-4 62 16 102 7 140 0v20H0Z" fill="#567D62" />
        <G><Circle cx="149" cy="141" r="10" fill="#D9AD87" /><Path d="M130 185v-18a19 19 0 0 1 38 0v18Z" fill="#245244" /><Path d="M142 185v22m14-22v22" stroke="#244B3C" strokeWidth="7" strokeLinecap="round" /></G>
        <G><Circle cx="205" cy="139" r="10" fill="#C39369" /><Path d="M187 182v-17a18 18 0 0 1 36 0v17Z" fill="#D4A17B" /><Path d="M198 182v22m13-22v22" stroke="#6B7352" strokeWidth="7" strokeLinecap="round" /></G>
        <Path d="M43 178v-42m0 20c-17 0-25-13-20-24 17 0 24 10 20 24Zm0-11c17 0 27-11 22-24-18 0-25 12-22 24Z" fill="#577F5D" stroke="#577F5D" strokeWidth="2" />
        <Ellipse cx="299" cy="160" rx="19" ry="24" fill="#7F9C70" /><Path d="M299 160v35" stroke="#44674B" strokeWidth="4" strokeLinecap="round" />
      </>}
      <Path d="M24 29h15m-7.5-7.5v15" stroke="#FFFEF8" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
    </Svg>
  </View>;
}
const styles = StyleSheet.create({ frame: { width: '100%', height: 180, borderRadius: 20, overflow: 'hidden', backgroundColor: palette.sage }, compact: { height: 96, borderRadius: 18 } });
