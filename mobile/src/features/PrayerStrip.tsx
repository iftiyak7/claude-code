import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { PRAYERS, type DayPrayerTimes } from '@/domain/prayer';
import type { Amal, PrayerName } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { Ionicons, PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';
import { formatClock } from './hooks';

/** Five fard prayers as tappable capsules. */
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
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const logs = useData((s) => s.logs);
  return (
    <View style={styles.row}>
      {PRAYERS.map((p) => {
        const a = salah[p];
        const done = a ? (logs[`${date}|amal|${a.id}`]?.count ?? 0) >= 1 : false;
        const isNow = current === p && !done;
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
            <Text style={[font.tiny, { color: isNow ? t.primary : t.muted, fontWeight: isNow ? '700' : '500' }]} numberOfLines={1}>
              {tr.prayer[p]}
            </Text>
            <View
              style={[
                styles.capsule,
                done
                  ? { backgroundColor: t.successSoft }
                  : isNow
                    ? { backgroundColor: t.primary }
                    : { backgroundColor: t.surface2 },
              ]}
            >
              {done ? (
                <Animated.View entering={ZoomIn.springify()} style={[styles.check, { borderColor: t.success }]}>
                  <Ionicons name="checkmark" size={15} color={t.success} />
                </Animated.View>
              ) : (
                <Ionicons name={(a?.icon as never) ?? 'ellipse-outline'} size={18} color={isNow ? '#fff' : t.muted} />
              )}
            </View>
            <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{n(formatClock(times[p], 'en', false))}</Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  item: { flex: 1, alignItems: 'center', gap: 6 },
  capsule: { width: '100%', height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center' },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
