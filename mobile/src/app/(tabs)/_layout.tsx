import { Tabs } from 'expo-router/tabs';
import type { BottomTabBarProps } from 'expo-router/tabs';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { Ionicons, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { useTheme } from '@/ui/theme';

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['home-outline', 'home'],
  amal: ['moon-outline', 'moon'],
  plan: ['calendar-clear-outline', 'calendar-clear'],
  health: ['heart-outline', 'heart'],
  profile: ['person-outline', 'person'],
};

/**
 * Floating bottom bar: every tab always shows its icon AND its name, so it is
 * obvious what each button does. The active tab gets a coral pill behind the
 * icon that springs in, and a bolder label.
 */
function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const labels: Record<string, string> = {
    index: tr.tabs.today,
    amal: tr.tabs.amal,
    plan: tr.tabs.plan,
    health: tr.tabs.health,
    profile: tr.tabs.profile,
  };

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[styles.bar, { backgroundColor: t.surface, borderColor: t.border }]}>
        {state.routes.map((route, index) => (
          <TabItem
            key={route.key}
            focused={state.index === index}
            icon={ICONS[route.name] ?? ['ellipse-outline', 'ellipse']}
            label={labels[route.name] ?? route.name}
            onPress={() => {
              if (state.index === index) return;
              haptic.tap();
              navigateToTab(route.key);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function TabItem({ focused, icon, label, onPress }: { focused: boolean; icon: [IconName, IconName]; label: string; onPress: () => void }) {
  const t = useTheme();
  const on = useSharedValue(focused ? 1 : 0);
  const press = useSharedValue(1);
  useEffect(() => {
    on.set(withSpring(focused ? 1 : 0, { damping: 15, stiffness: 190 }));
  }, [focused, on]);
  const pill = useAnimatedStyle(() => ({
    opacity: on.get(),
    transform: [{ scaleX: 0.55 + on.get() * 0.45 }, { scaleY: 0.8 + on.get() * 0.2 }],
  }));
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: -on.get() * 1.5 }, { scale: press.get() }] }));
  return (
    <Pressable
      style={styles.item}
      onPress={onPress}
      onPressIn={() => press.set(withSpring(0.88, { damping: 14, stiffness: 300 }))}
      onPressOut={() => press.set(withSpring(1, { damping: 12, stiffness: 260 }))}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.iconWrap, lift]}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.pill, { backgroundColor: t.primary }, pill]} />
        <Ionicons name={focused ? icon[1] : icon[0]} size={21} color={focused ? '#fff' : t.muted} />
      </Animated.View>
      <Text style={[styles.label, { color: focused ? t.text : t.muted, fontWeight: focused ? '700' : '500' }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      tabBar={(p) => <TabBar {...p} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: t.bg },
        animation: Platform.OS === 'web' ? 'none' : 'shift',
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="amal" />
      <Tabs.Screen name="plan" />
      <Tabs.Screen name="health" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 12 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 28,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 14,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 2 },
  iconWrap: { width: 54, height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { borderRadius: 16 },
  label: { fontSize: 11.5, lineHeight: 15 },
});
