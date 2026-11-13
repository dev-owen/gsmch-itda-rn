import { Link } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '@/components/app-text';
import { AppIcon } from '@/components/app-icon';
import { palette } from '@/theme/tokens';

export function FlaticonAttribution() {
  return <View style={styles.container}>
    <Text style={styles.description}>하단 탭 아이콘</Text>
    <Link href="https://www.flaticon.com/uicons" target="_blank" rel="noopener noreferrer" asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="Uicons by Flaticon, 외부 사이트" style={({ pressed }) => [styles.link, pressed && styles.pressed]}>
        <Text style={styles.label}>Uicons by Flaticon</Text>
        <AppIcon name="arrow-up-right" size={14} color={palette.forest} />
      </Pressable>
    </Link>
  </View>;
}

const styles = StyleSheet.create({
  container: { borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 14, gap: 1 },
  description: { color: palette.muted, fontSize: 11, lineHeight: 19 },
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 7, minHeight: 42 },
  label: { color: palette.forest, fontSize: 13, lineHeight: 22, textDecorationLine: 'underline' },
  pressed: { opacity: 0.65 },
});
