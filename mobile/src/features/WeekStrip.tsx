import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';
import { addDays, parseISODate, weekday } from '@/domain/dates';
import { useNum, useT } from '@/i18n';
import { Ionicons, PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';

/**
 * 7-day capsule selector ending today. Fully completed days show a mint
 * check; the selected day is a tall coral capsule.
 */
export function WeekStrip({
  value,
  today,
  onChange,
  complete,
}: {
  value: string;
  today: string;
  onChange: (d: string) => void;
  /** returns 0..1 completion for a date (optional) */
  complete?: (d: string) => number;
}) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <View style={styles.row}>
      {days.map((d) => {
        const active = d === value;
        const ratio = complete?.(d) ?? 0;
        const done = ratio >= 1;
        return (
          <PressableScale
            key={d}
            scaleTo={0.92}
            onPress={() => {
              haptic.tap();
              onChange(d);
            }}
            style={styles.col}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            <Text style={[font.tiny, { color: active ? t.text : t.muted, fontWeight: active ? '700' : '500' }]}>{tr.weekdays[weekday(d)]}</Text>
            <View
              style={[
                styles.capsule,
                { backgroundColor: active ? t.primary : t.surface },
                active && { height: 74, shadowColor: t.primary, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
              ]}
            >
              {done && !active ? (
                <Animated.View entering={ZoomIn} style={[styles.check, { backgroundColor: t.successSoft }]}>
                  <Ionicons name="checkmark" size={16} color={t.success} />
                </Animated.View>
              ) : (
                <Text style={[font.h3, { color: active ? '#fff' : t.text }]}>{n(parseISODate(d).getDate())}</Text>
              )}
              {d === today && <View style={[styles.dot, { backgroundColor: active ? '#fff' : t.primary }]} />}
              {!done && ratio > 0 && !active && (
                <View style={[styles.partial, { backgroundColor: t.primarySoft }]}>
                  <View style={{ height: `${ratio * 100}%`, backgroundColor: t.primary, borderRadius: 2 }} />
                </View>
              )}
            </View>
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginTop: 16, alignItems: 'flex-start' },
  col: { flex: 1, alignItems: 'center', gap: 8 },
  capsule: { width: '100%', height: 62, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  check: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: 9, width: 5, height: 5, borderRadius: 3 },
  partial: { position: 'absolute', bottom: 10, width: 4, height: 14, borderRadius: 2, justifyContent: 'flex-end', overflow: 'hidden' },
});
