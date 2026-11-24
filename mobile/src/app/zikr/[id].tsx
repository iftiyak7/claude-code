import { LinearGradient } from 'expo-linear-gradient';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { today } from '@/domain/dates';
import { useLogCount } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { IconButton, Ionicons, IslamicPattern, ProgressRing } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, useTheme } from '@/ui/theme';

export default function ZikrCounter() {
  const { id, date: dateParam } = useLocalSearchParams<{ id: string; date?: string }>();
  const date = dateParam ?? today();
  const amal = useData((s) => s.amals[id]);
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const count = useLogCount('amal', id, date);
  const [celebrate, setCelebrate] = useState(false);

  const pulse = useSharedValue(1);
  const ripple = useSharedValue(1); // 1 = finished (invisible)
  const rippleStyle = useAnimatedStyle(() => ({
    opacity: 1 - ripple.value,
    transform: [{ scale: 0.6 + ripple.value * 0.9 }],
  }));
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const target = amal?.target ?? 33;
  const round = target > 100 ? 100 : target > 33 ? 33 : target;

  const tap = useCallback(() => {
    if (!amal) return;
    const c = useData.getState().bump('amal', amal.id, 1, date);
    pulse.set(withSequence(withTiming(0.94, { duration: 60 }), withSpring(1, { damping: 10, stiffness: 300 })));
    ripple.set(0);
    ripple.set(withTiming(1, { duration: 520 }));
    if (c === amal.target) {
      haptic.success();
      setCelebrate(true);
      setTimeout(() => setCelebrate(false), 2600);
    } else if (c % round === 0) haptic.medium();
    else haptic.tap();
  }, [amal, date, pulse, ripple, round]);

  if (!amal) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.muted }}>—</Text>
      </View>
    );
  }

  const done = count >= amal.target;
  const progress = count / amal.target;
  const inRound = count === 0 ? 0 : count % round === 0 ? round : count % round;

  const reset = () => {
    const doIt = () => {
      useData.getState().setCount('amal', amal.id, 0, date);
      haptic.warn();
    };
    if (Platform.OS === 'web') return doIt();
    Alert.alert(tr.reset, tr.confirmDelete, [
      { text: tr.cancel, style: 'cancel' },
      { text: tr.reset, style: 'destructive', onPress: doIt },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient colors={[t.heroA, t.heroB]} style={StyleSheet.absoluteFill} />
      <IslamicPattern opacity={0.06} />

      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <IconButton icon="chevron-down" onPress={() => router.back()} bg="rgba(255,255,255,0.14)" color="#fff" />
        <View style={{ flex: 1 }} />
        <IconButton icon="create-outline" onPress={() => router.push(`/amal/edit?id=${amal.id}`)} bg="rgba(255,255,255,0.14)" color="#fff" />
      </View>

      <Animated.View entering={FadeInDown.duration(450)} style={styles.texts}>
        {amal.arabic ? <Text style={[font.arabic, styles.arabic]}>{amal.arabic}</Text> : null}
        <Text style={[font.h2, { color: '#fff', textAlign: 'center' }]}>{amal.title}</Text>
        {amal.meaning ? <Text style={[font.small, styles.meaning]}>{amal.meaning}</Text> : null}
      </Animated.View>

      {/* the whole lower half is a tap target */}
      <Pressable onPress={tap} style={styles.tapArea} accessibilityRole="button" accessibilityLabel={tr.tapToCount}>
        <Animated.View style={[styles.ripple, rippleStyle]} pointerEvents="none" />
        <Animated.View style={pulseStyle}>
          <ProgressRing size={260} stroke={14} progress={progress} color={done ? '#F3D37A' : '#7BE0B8'} track="rgba(255,255,255,0.12)">
            <View style={styles.inner}>
              <Text style={styles.count}>{n(count)}</Text>
              <Text style={[font.small, { color: 'rgba(255,255,255,0.75)' }]}>
                / {n(amal.target)} {amal.unit ?? ''}
              </Text>
            </View>
          </ProgressRing>
        </Animated.View>
        <Text style={[font.small, styles.hint]}>
          {done ? tr.completeToday : `${tr.round} ${n(inRound)}/${n(round)} · ${tr.tapToCount}`}
        </Text>
      </Pressable>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + 20 }]}>
        <Pressable
          onPress={() => {
            useData.getState().bump('amal', amal.id, -1, date);
            haptic.tap();
          }}
          style={styles.action}
        >
          <Ionicons name="arrow-undo" size={20} color="#fff" />
          <Text style={[font.small, { color: '#fff' }]}>{tr.undo}</Text>
        </Pressable>
        <View style={styles.remain}>
          <Text style={[font.tiny, { color: 'rgba(255,255,255,0.7)' }]}>{tr.remaining}</Text>
          <Text style={[font.h3, { color: '#fff' }]}>{n(Math.max(0, amal.target - count))}</Text>
        </View>
        <Pressable onPress={reset} style={styles.action}>
          <Ionicons name="refresh" size={20} color="#fff" />
          <Text style={[font.small, { color: '#fff' }]}>{tr.reset}</Text>
        </Pressable>
      </View>

      {celebrate && (
        <Animated.View entering={FadeIn} style={[StyleSheet.absoluteFill, styles.center]} pointerEvents="none">
          <Animated.View entering={ZoomIn.springify().damping(12)} style={styles.badge}>
            <Ionicons name="sparkles" size={42} color="#0A4A37" />
            <Text style={[font.h3, { color: '#0A4A37', marginTop: 8, textAlign: 'center' }]}>{tr.completeToday}</Text>
            <Text style={[font.body, { color: '#0A4A37', marginTop: 4 }]}>+{n(amal.points)} {tr.points}</Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', paddingHorizontal: 16 },
  texts: { paddingHorizontal: 28, marginTop: 18, alignItems: 'center', gap: 8 },
  arabic: { color: '#F3D37A', textAlign: 'center', fontSize: 34, lineHeight: 56 },
  meaning: { color: 'rgba(255,255,255,0.75)', textAlign: 'center' },
  tapArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: 300, height: 300, borderRadius: 150, borderWidth: 2, borderColor: 'rgba(243,211,122,0.6)' },
  inner: { alignItems: 'center' },
  count: { color: '#fff', fontSize: 72, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -2 },
  hint: { color: 'rgba(255,255,255,0.8)', marginTop: 22 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 28 },
  action: { alignItems: 'center', gap: 4, padding: 10, minWidth: 64 },
  remain: { alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 22, paddingVertical: 8, borderRadius: radius.pill },
  badge: { backgroundColor: '#F3D37A', borderRadius: radius.xl, padding: 28, alignItems: 'center', maxWidth: 280 },
});
