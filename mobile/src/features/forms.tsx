import { router } from 'expo-router';
import React from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text, TextInput } from '@/ui/Text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { today } from '@/domain/dates';
import type { Recurrence, ReminderRule } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { Button, Card, Chip, IconButton, Ionicons, Segmented, ToggleRow, Row } from '@/ui/components';
import { DateField, PickerPill, TimesEditor } from '@/ui/pickers';
import { font, radius, space, useTheme } from '@/ui/theme';

export function FormScreen({
  title,
  onSave,
  onDelete,
  children,
}: {
  title: string;
  onSave: () => void;
  onDelete?: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const tr = useT();
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.head, { paddingTop: Platform.OS === 'ios' ? 16 : insets.top + 10, borderBottomColor: t.border }]}>
        <IconButton icon="close" onPress={() => router.back()} />
        <Text style={[font.h3, { color: t.text, flex: 1, textAlign: 'center' }]} numberOfLines={1}>
          {title}
        </Text>
        <Button small label={tr.save} onPress={onSave} />
      </View>
      <ScrollView contentContainerStyle={{ padding: space(4), paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {children}
        {onDelete && (
          <Button
            kind="danger"
            icon="trash-outline"
            label={tr.delete}
            style={{ marginTop: space(6) }}
            onPress={() => {
              if (Platform.OS === 'web') return onDelete();
              Alert.alert(tr.confirmDelete, '', [
                { text: tr.cancel, style: 'cancel' },
                { text: tr.delete, style: 'destructive', onPress: onDelete },
              ]);
            }}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** Labelled group. `bare` skips the card (for controls that are already pills). */
export function FormCard({ label, children, bare }: { label?: string; children: React.ReactNode; bare?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: space(5) }}>
      {label ? <Text style={[font.small, { color: t.muted, marginBottom: 10, marginLeft: 4, fontWeight: '600' }]}>{label}</Text> : null}
      {bare ? <View style={{ gap: 12 }}>{children}</View> : <Card style={{ gap: 14, padding: 18 }}>{children}</Card>}
    </View>
  );
}

export function NumberInput({ value, onChange, min = 1, max = 100000, step = 1 }: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) {
  const t = useTheme();
  const n = useNum();
  const clamp = (x: number) => Math.max(min, Math.min(max, x));
  return (
    <Row gap={10}>
      <IconButton icon="remove" onPress={() => onChange(clamp(value - step))} size={36} />
      <TextInput
        value={String(value)}
        keyboardType="number-pad"
        onChangeText={(s) => {
          const x = parseInt(s.replace(/[^\d]/g, ''), 10);
          onChange(Number.isFinite(x) ? clamp(x) : min);
        }}
        style={[styles.num, { color: t.text, backgroundColor: t.surface2 }]}
        accessibilityLabel={n(value)}
      />
      <IconButton icon="add" onPress={() => onChange(clamp(value + step))} size={36} />
    </Row>
  );
}

export function RecurrenceEditor({ value, onChange }: { value: Recurrence; onChange: (r: Recurrence) => void }) {
  const tr = useT();
  const t = useTheme();
  const types: Recurrence['type'][] = ['daily', 'weekly', 'once', 'everyNDays', 'monthly'];
  const set = (type: Recurrence['type']) => {
    switch (type) {
      case 'daily':
        return onChange({ type });
      case 'weekly':
        return onChange({ type, days: value.type === 'weekly' ? value.days : [5] });
      case 'once':
        return onChange({ type, date: today() });
      case 'everyNDays':
        return onChange({ type, every: 2, start: today() });
      case 'monthly':
        return onChange({ type, day: new Date().getDate() });
    }
  };
  return (
    <>
      <View style={styles.wrap}>
        {types.map((ty) => (
          <Chip key={ty} label={tr.rec[ty]} active={value.type === ty} onPress={() => set(ty)} />
        ))}
      </View>
      {value.type === 'weekly' && (
        <View style={styles.wrap}>
          {tr.weekdays.map((d, i) => {
            const on = value.days.includes(i);
            return (
              <Chip
                key={d}
                label={d}
                active={on}
                onPress={() => onChange({ ...value, days: on ? value.days.filter((x) => x !== i) : [...value.days, i].sort() })}
              />
            );
          })}
        </View>
      )}
      {value.type === 'once' && <DateField value={value.date} onChange={(d) => onChange({ ...value, date: d ?? today() })} />}
      {value.type === 'everyNDays' && (
        <>
          <Row>
            <Text style={[font.body, { color: t.text }]}>{tr.every}</Text>
            <NumberInput value={value.every} min={2} max={365} onChange={(every) => onChange({ ...value, every })} />
            <Text style={[font.body, { color: t.text }]}>{tr.days}</Text>
          </Row>
          <Row>
            <Text style={[font.small, { color: t.muted }]}>{tr.startDate}</Text>
            <DateField value={value.start} onChange={(d) => onChange({ ...value, start: d ?? today() })} />
          </Row>
        </>
      )}
      {value.type === 'monthly' && (
        <Row>
          <Text style={[font.body, { color: t.text }]}>{tr.dayOfMonth}</Text>
          <NumberInput value={value.day} min={1} max={31} onChange={(day) => onChange({ ...value, day })} />
        </Row>
      )}
    </>
  );
}

export function ReminderEditor({ value, onChange, allowInterval = true, showStop = true }: { value: ReminderRule; onChange: (r: ReminderRule) => void; allowInterval?: boolean; showStop?: boolean }) {
  const tr = useT();
  const t = useTheme();
  const modes: ReminderRule['mode'][] = allowInterval ? ['none', 'times', 'interval'] : ['none', 'times'];
  return (
    <>
      <Segmented value={value.mode} onChange={(mode) => onChange({ ...value, mode, times: mode === 'times' && value.times.length === 0 ? ['08:00'] : value.times })} options={modes.map((m) => ({ value: m, label: tr.rm[m] }))} />
      {value.mode === 'times' && <TimesEditor times={value.times} onChange={(times) => onChange({ ...value, times })} />}
      {value.mode === 'interval' && (
        <>
          <Row style={{ flexWrap: 'wrap' }}>
            <Text style={[font.body, { color: t.text }]}>{tr.intervalMin}</Text>
          </Row>
          <View style={styles.wrap}>
            {[30, 60, 90, 120, 180, 240].map((m) => (
              <Chip key={m} label={`${m}`} active={value.intervalMinutes === m} onPress={() => onChange({ ...value, intervalMinutes: m })} />
            ))}
          </View>
          <Row style={{ flexWrap: 'wrap' }}>
            <Text style={[font.small, { color: t.muted }]}>{tr.from}</Text>
            <PickerPill mode="time" value={value.windowStart} onChange={(windowStart) => onChange({ ...value, windowStart })} />
            <Text style={[font.small, { color: t.muted }]}>{tr.to}</Text>
            <PickerPill mode="time" value={value.windowEnd} onChange={(windowEnd) => onChange({ ...value, windowEnd })} />
          </Row>
        </>
      )}
      {value.mode !== 'none' && (
        <>
          <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={value.alarm} onChange={(alarm) => onChange({ ...value, alarm })} />
          {showStop && <ToggleRow icon="checkmark-circle-outline" label={tr.stopWhenDone} value={value.stopWhenDone} onChange={(stopWhenDone) => onChange({ ...value, stopWhenDone })} />}
        </>
      )}
    </>
  );
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <View style={styles.wrap}>
      {colors.map((c) => (
        <Pressable
          key={c}
          onPress={() => onChange(c)}
          style={[styles.swatchRing, { borderColor: value === c ? c : 'transparent' }]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === c }}
        >
          <View style={[styles.swatch, { backgroundColor: c }]} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  num: { width: 88, textAlign: 'center', fontSize: 18, fontWeight: '700', paddingVertical: 8, borderRadius: radius.sm },
  swatchRing: { padding: 3, borderRadius: 20, borderWidth: 2 },
  swatch: { width: 28, height: 28, borderRadius: 14 },
});

export function MoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useTheme();
  const tr = useT();
  return (
    <Pressable onPress={onToggle} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', padding: 10, marginBottom: 6 }} accessibilityRole="button">
      <Text style={[font.body, { color: t.primary, fontWeight: '600' }]}>{open ? tr.quick.less : tr.quick.more}</Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={t.primary} />
    </Pressable>
  );
}
