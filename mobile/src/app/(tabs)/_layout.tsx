import { Tabs } from 'expo-router/tabs';
import type { BottomTabBarProps } from 'expo-router/tabs';
import React, { useEffect } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '@/i18n';
import { Ionicons, cardShadow, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, useTheme } from '@/ui/theme';

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['home-outline', 'home'],
  amal: ['moon-outline', 'moon'],
  plan: ['calendar-outline', 'calendar'],
  health: ['heart-outline', 'heart'],
  profile: ['person-outline', 'person'],
};

function TabItem({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: [IconName, IconName]; onPress: () => void }) {
  const t = useTheme();
  const v = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    v.set(withSpring(focused ? 1 : 0, { damping: 16, stiffness: 220 }));
  }, [focused, v]);
  const pill = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ scaleX: 0.6 + v.value * 0.4 }] }));
  const ic = useAnimatedStyle(() => ({ transform: [{ translateY: -v.value * 1 }, { scale: 1 + v.value * 0.06 }] }));
  return (
    <Pressable
      onPress={onPress}
      style={styles.item}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
    >
      <View style={styles.iconWrap}>
        <Animated.View style={[styles.pill, { backgroundColor: t.primarySoft }, pill]} />
        <Animated.View style={ic}>
          <Ionicons name={focused ? icon[1] : icon[0]} size={22} color={focused ? t.primary : t.muted} />
        </Animated.View>
      </View>
      <Text style={[font.tiny, { color: focused ? t.primary : t.muted, marginTop: 3 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

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
    <View style={[styles.barWrap, { paddingBottom: Math.max(insets.bottom, 10) }]} pointerEvents="box-none">
      <View style={[styles.bar, cardShadow(t), { backgroundColor: t.surface, borderColor: t.border }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          return (
            <TabItem
              key={route.key}
              focused={focused}
              label={labels[route.name] ?? route.name}
              icon={ICONS[route.name] ?? ['ellipse-outline', 'ellipse']}
              onPress={() => {
                if (focused) return;
                haptic.tap();
                navigateToTab(route.key);
              }}
            />
          );
        })}
      </View>
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
  barWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  bar: { flexDirection: 'row', borderRadius: 26, paddingVertical: 8, paddingHorizontal: 6, borderWidth: StyleSheet.hairlineWidth },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 },
  iconWrap: { width: 56, height: 32, alignItems: 'center', justifyContent: 'center' },
  pill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 16 },
});
