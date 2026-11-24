import { Tabs } from 'expo-router/tabs';
import type { BottomTabBarProps } from 'expo-router/tabs';
import React from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { Ionicons, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['home-outline', 'home'],
  amal: ['moon-outline', 'moon'],
  plan: ['calendar-clear-outline', 'calendar-clear'],
  health: ['heart-outline', 'heart'],
  profile: ['person-outline', 'person'],
};

const spring = LinearTransition.springify().damping(18).stiffness(180);

/**
 * Floating ink pill. Inactive tabs are round icon buttons; the active tab
 * expands into a coral pill with its label (animated layout transition).
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
  const barBg = t.dark ? '#242229' : '#16151A';
  const btnBg = t.dark ? '#34313A' : '#FFFFFF';
  const btnFg = t.dark ? '#F5F0ED' : '#16151A';

  return (
    <View style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, 12) }]} pointerEvents="box-none">
      <Animated.View layout={spring} style={[styles.bar, { backgroundColor: barBg }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const icon = ICONS[route.name] ?? ['ellipse-outline', 'ellipse'];
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                if (focused) return;
                haptic.tap();
                navigateToTab(route.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={labels[route.name]}
            >
              <Animated.View
                layout={spring}
                style={[styles.item, focused ? [styles.active, { backgroundColor: t.primary }] : { backgroundColor: btnBg }]}
              >
                <Ionicons name={focused ? icon[1] : icon[0]} size={20} color={focused ? '#fff' : btnFg} />
                {focused && (
                  <Animated.View entering={FadeIn.delay(80).duration(220)}>
                    <Text style={[font.small, { color: '#fff', fontWeight: '600' }]} numberOfLines={1}>
                      {labels[route.name]}
                    </Text>
                  </Animated.View>
                )}
              </Animated.View>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
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
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 6,
    borderRadius: 40,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  item: { height: 48, minWidth: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  active: { paddingHorizontal: 18 },
});
