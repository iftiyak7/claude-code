import { router } from 'expo-router';
import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { salahTimeStarted } from '@/domain/prayer';
import type { Amal } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { Card, Ionicons, PressableScale, ProgressBar, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';
import { toast } from '@/ui/toast';
import { formatClock, useLogCount, useNow, usePrayerTimes } from './hooks';

export const AmalCard = memo(function AmalCard({ amal, date, index = 0 }: { amal: Amal; date: string; index?: number }) {
  const t = useTheme();
  const n = useNum();
  const tr = useT();
  const lang = useData((s) => s.settings.language);
  const count = useLogCount('amal', amal.id, date);
  const done = count >= amal.target;
  const counter = amal.target > 1;
  const now = useNow(15_000);
  const { today: times } = usePrayerTimes(date);
  const prayerAt = amal.kind === 'salah' && amal.prayer ? times[amal.prayer] : null;
  const locked = !!prayerAt && !done && !salahTimeStarted(prayerAt, date, now);

  const press = () => {
    if (counter) {
      router.push(`/zikr/${amal.id}?date=${date}`);
      return;
    }
    if (locked && prayerAt && amal.prayer) {
      haptic.warn();
      toast(tr.salahNotYet(tr.prayer[amal.prayer], n(formatClock(prayerAt, lang))), 'time-outline');
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
    <Animated.View entering={FadeInDown.delay(40 + index * 40).duration(380)} layout={LinearTransition.springify().damping(18)}>
      <Card onPress={press} onLongPress={() => router.push(`/amal/edit?id=${amal.id}`)} style={[styles.card, locked && { opacity: 0.6 }]}>
        <View style={[styles.icon, { backgroundColor: amal.color + (t.dark ? '2E' : '1A') }]}>
          <Ionicons name={amal.icon as IconName} size={22} color={amal.color} />
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[font.body, { color: t.text, fontWeight: '600' }]} numberOfLines={1}>
            {amal.title}
          </Text>
          {counter ? (
            <View style={{ gap: 8 }}>
              <Text style={[font.small, { color: t.muted }]}>
                <Text style={{ color: done ? t.success : t.text, fontWeight: '700' }}>{n(count)}</Text> / {n(amal.target)} {amal.unit ?? ''}
              </Text>
              <ProgressBar progress={count / amal.target} color={done ? t.success : t.primary} height={6} />
            </View>
          ) : amal.arabic ? (
            <Text style={[font.arabic, { fontSize: 17, color: t.muted, textAlign: 'left', lineHeight: 28 }]} numberOfLines={1}>
              {amal.arabic}
            </Text>
          ) : null}
        </View>
        {counter && !done ? (
          <PressableScale onPress={quickAdd} scaleTo={0.85} style={[styles.action, { backgroundColor: t.ink }]} accessibilityLabel="+1">
            <Ionicons name="add" size={22} color={t.onInk} />
          </PressableScale>
        ) : (
          <View style={[styles.action, done ? { backgroundColor: t.success } : { borderWidth: 2, borderColor: t.border }]}>
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
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12, paddingVertical: 16, paddingHorizontal: 16 },
  icon: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  action: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
