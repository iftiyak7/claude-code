import { router } from 'expo-router';
import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import type { Amal } from '@/domain/types';
import { useNum } from '@/i18n';
import { useData } from '@/store/data';
import { Card, Ionicons, PressableScale, ProgressBar, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, useTheme } from '@/ui/theme';
import { useLogCount } from './hooks';

export const AmalCard = memo(function AmalCard({ amal, date, index = 0 }: { amal: Amal; date: string; index?: number }) {
  const t = useTheme();
  const n = useNum();
  const count = useLogCount('amal', amal.id, date);
  const done = count >= amal.target;
  const counter = amal.target > 1;

  const press = () => {
    if (counter) {
      router.push(`/zikr/${amal.id}?date=${date}`);
      return;
    }
    const next = done ? 0 : 1;
    useData.getState().setCount('amal', amal.id, next, date);
    if (next) haptic.success();
    else haptic.tap();
  };

  const quickAdd = () => {
    const c = useData.getState().bump('amal', amal.id, 1, date);
    if (c === amal.target) haptic.success();
    else haptic.tap();
  };

  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 40).duration(360)} layout={LinearTransition.springify().damping(18)}>
      <Card onPress={press} onLongPress={() => router.push(`/amal/edit?id=${amal.id}`)} style={styles.card}>
        <View style={[styles.icon, { backgroundColor: amal.color + (t.dark ? '33' : '1F') }]}>
          <Ionicons name={amal.icon as IconName} size={22} color={amal.color} />
        </View>
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.titleRow}>
            <Text style={[font.body, { color: t.text, fontWeight: '700', flexShrink: 1 }]} numberOfLines={1}>
              {amal.title}
            </Text>
            {counter && (
              <Text style={[font.small, { color: done ? t.success : t.muted, fontWeight: '700' }]}>
                {n(count)}/{n(amal.target)}
              </Text>
            )}
          </View>
          {amal.arabic ? (
            <Text style={[font.small, { color: t.muted, writingDirection: 'rtl' }]} numberOfLines={1}>
              {amal.arabic}
            </Text>
          ) : null}
          {counter && <ProgressBar progress={count / amal.target} color={done ? t.success : amal.color} height={6} />}
        </View>
        {counter && !done ? (
          <PressableScale onPress={quickAdd} scaleTo={0.85} style={[styles.check, { backgroundColor: amal.color + '22' }]} accessibilityLabel="+1">
            <Ionicons name="add" size={22} color={amal.color} />
          </PressableScale>
        ) : (
          <View style={[styles.check, done ? { backgroundColor: t.success } : { borderWidth: 2, borderColor: t.border }]}>
            {done && (
              <Animated.View entering={ZoomIn.springify()}>
                <Ionicons name="checkmark" size={20} color="#fff" />
              </Animated.View>
            )}
          </View>
        )}
      </Card>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10, paddingVertical: 14 },
  icon: { width: 46, height: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  check: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
