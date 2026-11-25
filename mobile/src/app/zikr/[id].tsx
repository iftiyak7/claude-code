import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { today } from '@/domain/dates';
import { useLogCount } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { Blob, IconButton, Ionicons, Khatam, ProgressRing, cardShadow } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';


export default function ZikrCounter() {
  const { id, date: dateParam } = useLocalSearchParams<{ id: string; date?: string }>();
  const date = dateParam ?? today();
  const amal = useData((s) => s.amals[id]);
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  // ring scales with the screen so small phones keep room for the quick-add row
  const { height: winH, width: winW } = useWindowDimensions();
  const RING = Math.round(Math.max(200, Math.min(288, winW - 80, winH * 0.34)));
  const DISC = RING - 52;
  const count = useLogCount('amal', id, date);
  const [celebrate, setCelebrate] = useState(false);

  const pulse = useSharedValue(1);
  const ripple = useSharedValue(1); // 1 = finished (invisible)
  const rippleStyle = useAnimatedStyle(() => ({ opacity: 0.5 * (1 - ripple.value), transform: [{ scale: 0.85 + ripple.value * 0.35 }] }));
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const target = amal?.target ?? 33;
  const round = target > 100 ? 100 : target > 33 ? 33 : target;

  const celebrateNow = useCallback(() => {
    haptic.success();
    setCelebrate(true);
    setTimeout(() => setCelebrate(false), 2600);
  }, []);

  const tap = useCallback(() => {
    if (!amal) return;
    const c = useData.getState().bump('amal', amal.id, 1, date);
    pulse.set(withSequence(withTiming(0.95, { duration: 60 }), withSpring(1, { damping: 10, stiffness: 300 })));
    ripple.set(0);
    ripple.set(withTiming(1, { duration: 560 }));
    if (c === amal.target) celebrateNow();
    else if (c % round === 0) haptic.medium();
    else haptic.tap();
  }, [amal, date, pulse, ripple, round, celebrateNow]);

  /** Counted elsewhere (e.g. on a physical tasbih): add a batch or fill the target at once. */
  const addBatch = useCallback(
    (k: number | 'complete') => {
      if (!amal) return;
      const st = useData.getState();
      const before = st.logs[`${date}|amal|${amal.id}`]?.count ?? 0;
      const after = k === 'complete' ? Math.max(before, amal.target) : before + k;
      st.setCount('amal', amal.id, after, date);
      pulse.set(withSequence(withTiming(0.95, { duration: 80 }), withSpring(1, { damping: 10, stiffness: 300 })));
      if (before < amal.target && after >= amal.target) celebrateNow();
      else haptic.light();
    },
    [amal, date, pulse, celebrateNow],
  );

  if (!amal) {
    return (
      <View style={[styles.center, { backgroundColor: t.bg }]}>
        <Text style={{ color: t.muted }}>—</Text>
      </View>
    );
  }

  const done = count >= amal.target;
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

  const barBg = t.dark ? '#242229' : '#16151A';

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Blob size={300} />
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <IconButton icon="chevron-down" onPress={() => router.back()} />
        <View style={[styles.pill, { backgroundColor: t.surface }]}>
          <Khatam size={12} color={t.primary} />
          <Text style={[font.tiny, { color: t.text }]}>{tr.zikr}</Text>
        </View>
        <IconButton icon="create-outline" onPress={() => router.push(`/amal/edit?id=${amal.id}`)} />
      </View>

      <Animated.View entering={FadeInDown.duration(450)} style={styles.texts}>
        {amal.arabic ? <Text style={[font.arabic, styles.arabic, { color: t.text }]}>{amal.arabic}</Text> : null}
        <Text style={[font.h2, { color: t.text, textAlign: 'center' }]}>{amal.title}</Text>
        {amal.meaning ? <Text style={[font.small, { color: t.muted, textAlign: 'center' }]}>{amal.meaning}</Text> : null}
      </Animated.View>

      {/* the whole middle area is the tap target */}
      <Pressable onPress={tap} style={styles.tapArea} accessibilityRole="button" accessibilityLabel={tr.tapToCount}>
        <Animated.View style={[styles.ripple, { borderColor: t.primary, width: RING + 20, height: RING + 20, borderRadius: (RING + 20) / 2 }, rippleStyle]} pointerEvents="none" />
        <Animated.View style={pulseStyle}>
          <ProgressRing size={RING} stroke={16} progress={count / amal.target} color={done ? t.success : t.primary} track={t.dark ? t.surface2 : 'rgba(255,255,255,0.8)'}>
            <View style={[styles.disc, cardShadow(t), { backgroundColor: t.surface, width: DISC, height: DISC, borderRadius: DISC / 2 }]}>
              <Text style={[font.small, { color: t.muted }]}>{tr.todayCount}</Text>
              <Text style={[styles.count, { color: t.text, fontSize: RING * 0.26, lineHeight: RING * 0.31 }]}>{n(count)}</Text>
              <View style={[styles.targetPill, { backgroundColor: done ? t.successSoft : t.primarySoft }]}>
                <Text style={[font.tiny, { color: done ? t.success : t.primaryDeep, fontSize: 12 }]}>
                  {tr.target}: {n(amal.target)} {amal.unit ?? ''}
                </Text>
              </View>
            </View>
          </ProgressRing>
        </Animated.View>
        <Text style={[font.small, { color: t.muted, marginTop: 18 }]}>
          {done ? tr.completeToday : `${tr.round} ${n(inRound)}/${n(round)} · ${tr.tapToCount}`}
        </Text>
      </Pressable>

      {/* already counted on a tasbih? add in one tap */}
      {!done && (
        <Animated.View entering={FadeInDown.delay(150)} style={styles.quick}>
          <View style={styles.quickRow} accessibilityLabel={tr.tasbihDone}>
            {[10, 33, 100].filter((k) => k < amal.target).map((k) => (
              <Pressable
                key={k}
                onPress={() => addBatch(k)}
                style={({ pressed }) => [styles.chip, { backgroundColor: t.surface, borderColor: t.border, opacity: pressed ? 0.6 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={`+${k}`}
              >
                <Text style={[font.small, { color: t.text, fontWeight: '600' }]}>+{n(k)}</Text>
              </Pressable>
            ))}
            <Pressable
              onPress={() => addBatch('complete')}
              style={({ pressed }) => [styles.chip, { backgroundColor: t.successSoft, borderColor: t.successSoft, opacity: pressed ? 0.6 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel={tr.markComplete}
            >
              <Ionicons name="checkmark-done" size={16} color={t.success} />
              <Text style={[font.small, { color: t.success, fontWeight: '700' }]}>{tr.markComplete}</Text>
            </Pressable>
          </View>
        </Animated.View>
      )}

      <View style={[styles.bottomWrap, { paddingBottom: Math.max(insets.bottom, 14) + 6 }]}>
        <View style={[styles.bottom, { backgroundColor: barBg }]}>
          <Pressable
            onPress={() => {
              useData.getState().bump('amal', amal.id, -1, date);
              haptic.tap();
            }}
            style={styles.circle}
            accessibilityLabel={tr.undo}
          >
            <Ionicons name="arrow-undo" size={20} color="#16151A" />
          </Pressable>
          <View style={[styles.remain, { backgroundColor: t.primary }]}>
            <Text style={[font.small, { color: '#fff', fontWeight: '600' }]}>
              {tr.remaining} {n(Math.max(0, amal.target - count))}
            </Text>
          </View>
          <Pressable onPress={reset} style={styles.circle} accessibilityLabel={tr.reset}>
            <Ionicons name="refresh" size={20} color="#16151A" />
          </Pressable>
        </View>
      </View>

      {celebrate && (
        <Animated.View entering={FadeIn} style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: 'rgba(22,21,26,0.25)' }]} pointerEvents="none">
          <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.badge, { backgroundColor: t.surface }]}>
            <View style={[styles.badgeIcon, { backgroundColor: t.primary }]}>
              <Ionicons name="sparkles" size={30} color="#fff" />
            </View>
            <Text style={[font.h3, { color: t.text, marginTop: 14, textAlign: 'center' }]}>{tr.completeToday}</Text>
            <Text style={[font.body, { color: t.primary, marginTop: 6, fontWeight: '700' }]}>
              +{n(amal.points)} {tr.points}
            </Text>
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill },
  texts: { paddingHorizontal: 28, marginTop: 8, alignItems: 'center', gap: 2 },
  arabic: { textAlign: 'center', fontSize: 32, lineHeight: 54 },
  tapArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', borderWidth: 2 },
  disc: { alignItems: 'center', justifyContent: 'center' },
  count: { fontWeight: '700', letterSpacing: -2, fontVariant: ['tabular-nums'] },
  targetPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill },
  bottomWrap: { alignItems: 'center' },
  quick: { paddingHorizontal: 20, marginBottom: 14 },
  quickRow: { flexDirection: 'row', justifyContent: 'center', gap: 8, flexWrap: 'wrap' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1 },
  bottom: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 7, borderRadius: 40 },
  circle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  remain: { height: 52, paddingHorizontal: 26, borderRadius: 26, alignItems: 'center', justifyContent: 'center', minWidth: 130 },
  badge: { borderRadius: radius.xl, padding: 28, alignItems: 'center', maxWidth: 290 },
  badgeIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
