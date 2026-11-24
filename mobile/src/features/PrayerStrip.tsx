import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { PRAYERS, type DayPrayerTimes } from '@/domain/prayer';
import type { Amal, PrayerName } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { Ionicons, PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font } from '@/ui/theme';
import { formatClock } from './hooks';

/** Five fard prayers as tappable check-ins, drawn on the hero gradient. */
export function PrayerStrip({
  date,
  times,
  salah,
  current,
}: {
  date: string;
  times: DayPrayerTimes;
  salah: Partial<Record<PrayerName, Amal>>;
  current: PrayerName | null;
}) {
  const tr = useT();
  const n = useNum();
  const logs = useData((s) => s.logs);
  return (
    <View style={styles.row}>
      {PRAYERS.map((p) => {
        const a = salah[p];
        const done = a ? (logs[`${date}|amal|${a.id}`]?.count ?? 0) >= 1 : false;
        const isNow = current === p;
        return (
          <PressableScale
            key={p}
            scaleTo={0.9}
            disabled={!a}
            onPress={() => {
              if (!a) return;
              useData.getState().setCount('amal', a.id, done ? 0 : 1, date);
              if (done) haptic.tap();
              else haptic.success();
            }}
            style={styles.item}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: done }}
            accessibilityLabel={tr.prayer[p]}
          >
            <View
              style={[
                styles.dot,
                done ? styles.dotDone : styles.dotTodo,
                isNow && !done && { borderColor: '#F3D37A', borderWidth: 2 },
              ]}
            >
              {done ? (
                <Animated.View entering={ZoomIn.springify()}>
                  <Ionicons name="checkmark" size={18} color="#0A4A37" />
                </Animated.View>
              ) : (
                <Ionicons name={(a?.icon as never) ?? 'ellipse-outline'} size={16} color="rgba(255,255,255,0.85)" />
              )}
            </View>
            <Text style={[font.tiny, styles.name]} numberOfLines={1}>
              {tr.prayer[p]}
            </Text>
            <Text style={[font.tiny, styles.time]}>{n(formatClock(times[p]).replace(/ (AM|PM)$/, ''))}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  item: { alignItems: 'center', width: 58 },
  dot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dotDone: { backgroundColor: '#F3D37A' },
  dotTodo: { backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' },
  name: { color: '#fff', marginTop: 6 },
  time: { color: 'rgba(255,255,255,0.7)', marginTop: 1, fontWeight: '500' },
});
