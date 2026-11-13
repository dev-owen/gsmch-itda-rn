import { AppText as Text, AppTextInput as TextInput } from '@/components/app-text';
import type { ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, View, type StyleProp, type TextInputProps, type ViewStyle,  } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';

import { layout, palette } from '@/theme/tokens';
import { AppIcon, type IconName } from '@/components/app-icon';

export function Screen({ children, title, eyebrow, subtitle, back = false, right, refreshing, onRefresh }: {
  children: ReactNode; title?: string; eyebrow?: string; subtitle?: string;
  back?: boolean; right?: ReactNode; refreshing?: boolean; onRefresh?: () => void;
}) {
  return <SafeAreaView edges={['top', 'left', 'right']} style={styles.safe}>
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.scroll}
        refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={palette.forest} /> : undefined}>
        <View style={styles.content}>
          {back && <Pressable accessibilityRole="button" accessibilityLabel="이전 화면" onPress={() => router.canGoBack() ? router.back() : router.replace('/events')} style={styles.back}><AppIcon name="chevron-left" size={18} /><Text style={styles.backText}>돌아가기</Text></Pressable>}
          {(title || eyebrow) && <View style={styles.header}>
            <View style={styles.flex}>
              {eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
              {title && <Text accessibilityRole="header" style={styles.title}>{title}</Text>}
              {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
            </View>{right}
          </View>}
          {children}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

export function Body({ children, muted = false, style }: { children: ReactNode; muted?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={style}><Text style={[styles.body, muted && styles.muted]}>{children}</Text></View>;
}
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[styles.card, style]}>{children}</View>; }
export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{right}</View>{children}</View>;
}
export function Button({ label, onPress, variant = 'primary', busy = false, disabled = false, compact = false, icon }: {
  label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'kakao'; busy?: boolean; disabled?: boolean; compact?: boolean; icon?: IconName;
}) {
  const subdued = variant === 'secondary' || variant === 'ghost' || variant === 'kakao';
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.button, styles[variant], compact && styles.compactButton, (disabled || busy) && styles.disabled, pressed && styles.pressed]}>
    {busy && <ActivityIndicator color={subdued ? palette.forest : palette.white} size="small" />}
    <Text style={[styles.buttonText, subdued && styles.darkButtonText]}>{busy ? '처리 중…' : label}</Text>
    {!busy && (icon || variant === 'primary') && <AppIcon name={icon || 'arrow-right'} size={17} color={subdued ? palette.forest : palette.white} />}
  </Pressable>;
}
export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: !!selected }} onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
  </Pressable>;
}
export function Badge({ label, tone = 'green' }: { label: string; tone?: 'green' | 'gold' | 'red' | 'muted' }) {
  return <View style={[styles.badge, { backgroundColor: tone === 'red' ? palette.dangerLight : tone === 'gold' ? palette.goldLight : tone === 'muted' ? palette.background : palette.forestLight }]}><Text style={[styles.badgeText, { color: tone === 'red' ? palette.danger : tone === 'muted' ? palette.muted : palette.forest }]}>{label}</Text></View>;
}
export function Field({ label, help, ...props }: TextInputProps & { label: string; help?: string }) {
  return <View style={styles.fieldWrap}><View style={styles.fieldLabel}><Text style={styles.label}>{label}</Text>{props.editable === false && <AppIcon name="lock" size={14} color={palette.muted} />}</View><TextInput accessibilityLabel={label} placeholderTextColor="#818C7C" {...props} style={[styles.input, props.multiline && styles.multiline, props.editable === false && styles.lockedInput, props.style]} />{help && <Text style={styles.help}>{help}</Text>}</View>;
}
export function Notice({ children, danger = false }: { children: ReactNode; danger?: boolean }) { return <View accessibilityRole={danger ? 'alert' : undefined} style={[styles.notice, danger && styles.dangerNotice]}><View style={[styles.noticeDot, danger && { backgroundColor: palette.danger }]} /><Text style={[styles.noticeText, danger && { color: palette.danger }]}>{children}</Text></View>; }
export function LoadingState({ label = '잠시만 기다려 주세요' }: { label?: string }) { return <View style={styles.state}><ActivityIndicator size="large" color={palette.forest} /><Text style={styles.stateText}>{label}</Text></View>; }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <Card style={styles.state}><View style={styles.stateMark}><AppIcon name="calendar" size={27} /></View><Text style={styles.stateTitle}>{title}</Text><Text style={styles.stateText}>{description}</Text>{action}</Card>; }
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) { return <Card><Notice danger>{message}</Notice>{onRetry && <Button label="다시 불러오기" variant="secondary" onPress={onRetry} />}</Card>; }
export function Row({ children, between = false, style }: { children: ReactNode; between?: boolean; style?: StyleProp<ViewStyle> }) { return <View style={[styles.row, between && { justifyContent: 'space-between' }, style]}>{children}</View>; }
export function DetailRow({ label, value }: { label: string; value?: string | null }) { return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text style={styles.detailValue}>{value || '추후 안내'}</Text></View>; }
export function Divider() { return <View style={styles.divider} />; }
export const common = StyleSheet.create({ gap: { gap: 14 }, smallGap: { gap: 8 }, grow: { flex: 1, minWidth: 0 }, title: { fontSize: 20, lineHeight: 30, fontWeight: '700', color: palette.ink, letterSpacing: -0.5 }, caption: { fontSize: 12, lineHeight: 19, color: palette.muted }, rowWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, largeValue: { fontSize: 32, lineHeight: 43, fontWeight: '700', color: palette.forest } });

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background }, flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 130 }, content: { width: '100%', maxWidth: layout.maxWidth, alignSelf: 'center', paddingHorizontal: layout.gutter, paddingTop: 24, gap: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 0 }, eyebrow: { fontSize: 10, lineHeight: 17, letterSpacing: 1.6, color: palette.muted, fontWeight: '600', marginBottom: 9 },
  title: { fontSize: 32, lineHeight: 44, letterSpacing: -1, color: palette.ink, fontWeight: '700' }, subtitle: { fontSize: 14, lineHeight: 24, color: palette.muted, marginTop: 9 }, back: { minHeight: 44, alignSelf: 'flex-start', alignItems: 'center', flexDirection: 'row', gap: 5, paddingRight: 14 }, backText: { color: palette.forest, fontSize: 13, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 26, color: palette.ink }, muted: { color: palette.muted }, card: { padding: 22, borderRadius: layout.radius, borderColor: palette.border, borderWidth: 1, backgroundColor: palette.surface, gap: 16 }, section: { gap: 14 }, sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }, sectionTitle: { color: palette.ink, fontWeight: '700', fontSize: 19, lineHeight: 29, letterSpacing: -0.5 },
  button: { minHeight: 52, paddingHorizontal: 22, paddingVertical: 14, borderRadius: 28, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 }, primary: { backgroundColor: palette.forestDark }, secondary: { backgroundColor: palette.sage }, ghost: { backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border }, danger: { backgroundColor: palette.danger }, kakao: { backgroundColor: palette.kakao }, compactButton: { minHeight: 42, paddingVertical: 10, paddingHorizontal: 17 }, disabled: { opacity: 0.46 }, pressed: { opacity: 0.75 }, buttonText: { fontSize: 14, lineHeight: 23, fontWeight: '700', color: palette.white, flexShrink: 1, textAlign: 'center' }, darkButtonText: { color: palette.forestDark },
  chip: { minHeight: 40, paddingHorizontal: 17, paddingVertical: 9, borderRadius: 22, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, justifyContent: 'center' }, chipSelected: { backgroundColor: palette.forestDark, borderColor: palette.forestDark }, chipText: { color: palette.muted, fontWeight: '600', fontSize: 13, lineHeight: 20 }, chipTextSelected: { color: palette.white }, badge: { alignSelf: 'flex-start', borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10 }, badgeText: { fontSize: 10, lineHeight: 16, fontWeight: '700' },
  fieldWrap: { gap: 9 }, fieldLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, label: { color: palette.ink, fontSize: 13, lineHeight: 21, fontWeight: '600' }, input: { borderWidth: 1, borderColor: palette.border, borderRadius: 16, paddingHorizontal: 17, paddingVertical: 15, backgroundColor: palette.surface, fontSize: 15, lineHeight: 23, color: palette.ink, minHeight: 54 }, lockedInput: { backgroundColor: palette.sageLight, color: '#596951', borderColor: '#D5DECB' }, multiline: { minHeight: 124, textAlignVertical: 'top' }, help: { fontSize: 12, lineHeight: 20, color: palette.muted }, notice: { padding: 15, backgroundColor: palette.sageLight, borderRadius: 17, flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, noticeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: palette.forest, marginTop: 8 }, dangerNotice: { backgroundColor: palette.dangerLight }, noticeText: { flex: 1, color: palette.forest, fontSize: 12, lineHeight: 21 },
  state: { paddingVertical: 36, alignItems: 'center', gap: 16 }, stateMark: { width: 64, height: 64, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.sageLight, marginBottom: 3 }, stateTitle: { fontSize: 20, lineHeight: 30, fontWeight: '700', textAlign: 'center', color: palette.ink }, stateText: { color: palette.muted, fontSize: 14, lineHeight: 24, textAlign: 'center' }, row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 }, detailRow: { flexDirection: 'row', gap: 15, paddingVertical: 8 }, detailLabel: { width: 62, color: palette.muted, fontSize: 12, lineHeight: 23 }, detailValue: { flex: 1, fontWeight: '500', color: palette.ink, fontSize: 14, lineHeight: 23 }, divider: { height: 1, backgroundColor: palette.border, marginVertical: 4 },
});
