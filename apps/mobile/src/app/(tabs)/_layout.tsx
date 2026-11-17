import { Tabs } from 'expo-router';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlaticonTabIcon } from '@/components/flaticon-tab-icon';
import { symbolFont } from '@/theme/typography';
import { layout, palette } from '@/theme/tokens';

export default function MainTabs() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const dockInset = (width - Math.min(width - 36, layout.maxWidth - 44)) / 2;
  return <Tabs safeAreaInsets={{ bottom: 0 }} screenOptions={{
    headerShown: false,
    tabBarActiveTintColor: palette.forestDark,
    tabBarInactiveTintColor: palette.muted,
    tabBarActiveBackgroundColor: 'transparent',
    tabBarHideOnKeyboard: true,
    tabBarStyle: { position: 'absolute', left: dockInset, right: dockInset, bottom: Math.max(insets.bottom, 14), height: 78, borderRadius: 28, backgroundColor: palette.surface, borderWidth: 1, borderColor: palette.border, borderTopWidth: 1, padding: 8, paddingTop: 8, paddingBottom: 8, shadowColor: palette.forestDark, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 16, elevation: 5 },
    tabBarItemStyle: { borderRadius: 20, marginHorizontal: 3, paddingVertical: 4 },
    tabBarLabelPosition: 'below-icon',
    tabBarLabelStyle: { fontFamily: symbolFont, fontSize: 12, lineHeight: 18, fontWeight: '600', marginTop: 2 },
    sceneStyle: { backgroundColor: palette.background },
  }}>
    <Tabs.Screen name="events" options={{ title: '소식', tabBarAccessibilityLabel: '교회 소식과 행사', tabBarIcon: ({ color, focused }) => <TabIcon name="newspaper" color={color} focused={focused} /> }} />
    <Tabs.Screen name="dongsu" options={{ title: '동수', tabBarLabel: '동수', tabBarIcon: ({ color, focused }) => <TabIcon name="camping" color={color} focused={focused} /> }} />
    <Tabs.Screen name="registrations" options={{ title: '내 신청', tabBarIcon: ({ color, focused }) => <TabIcon name="calendar-check" color={color} focused={focused} /> }} />
    <Tabs.Screen name="account" options={{ title: '내 계정', tabBarIcon: ({ color, focused }) => <TabIcon name="user" color={color} focused={focused} /> }} />
  </Tabs>;
}

function TabIcon({ name, color, focused }: { name: Parameters<typeof FlaticonTabIcon>[0]['name']; color: Parameters<typeof FlaticonTabIcon>[0]['color']; focused: boolean }) {
  return <View style={{ width: 47, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: focused ? palette.sage : 'transparent' }}><FlaticonTabIcon name={name} color={focused ? palette.forestDark : color} size={21} /></View>;
}
