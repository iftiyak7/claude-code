import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { addDays, parseISODate, weekday } from '@/domain/dates';
import { useNum, useT } from '@/i18n';
import { PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, useTheme } from '@/ui/theme';

/** 7-day selector ending today — lets the user log/catch up past days. */
export function WeekStrip({ value, today, onChange }: { value: string; today: string; onChange: (d: string) => void }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  return (
    <View style={styles.row}>
      {days.map((d) => {
        const active = d === value;
        return (
          <PressableScale
            key={d}
            scaleTo={0.92}
            onPress={() => {
              haptic.tap();
              onChange(d);
            }}
            style={[styles.day, { backgroundColor: active ? t.primary : t.surface, borderColor: active ? t.primary : t.border }]}
          >
            <Text style={[font.tiny, { color: active ? t.onPrimary : t.muted }]}>{tr.weekdays[weekday(d)]}</Text>
            <Text style={[font.h3, { color: active ? t.onPrimary : t.text, marginTop: 2 }]}>{n(parseISODate(d).getDate())}</Text>
            {d === today && <View style={[styles.dot, { backgroundColor: active ? t.onPrimary : t.primary }]} />}
          </PressableScale>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginTop: 8 },
  day: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  dot: { width: 4, height: 4, borderRadius: 2, marginTop: 4 },
});
