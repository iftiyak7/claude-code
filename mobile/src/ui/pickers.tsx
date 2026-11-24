import RNDateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { at, hmFromDate, isValidHM, isValidISODate, parseISODate, toISODate, today } from '@/domain/dates';
import type { HM, ISODate } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { Button, Chip, Ionicons, Row } from './components';
import { haptic } from './haptics';
import { font, radius, useTheme } from './theme';

type Mode = 'time' | 'date';

function usePicker(mode: Mode, value: string | undefined, onChange: (v: string) => void) {
  const [iosOpen, setIosOpen] = useState(false);
  const toDate = () => (mode === 'time' ? at(today(), value && isValidHM(value) ? value : '08:00') : parseISODate(value && isValidISODate(value) ? value : today()));
  const fmt = (d: Date) => (mode === 'time' ? hmFromDate(d) : toISODate(d));
  const open = () => {
    haptic.tap();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: toDate(),
        mode,
        is24Hour: true,
        onValueChange: (_e, d) => d && onChange(fmt(d)),
      });
    } else setIosOpen(true);
  };
  return { open, iosOpen, setIosOpen, toDate, fmt };
}

function IOSSheet({ mode, visible, onClose, value, onPick }: { mode: Mode; visible: boolean; onClose: () => void; value: Date; onPick: (d: Date) => void }) {
  const t = useTheme();
  const tr = useT();
  const [d, setD] = useState(value);
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={() => setD(value)}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.surface }]}>
        <RNDateTimePicker value={d} mode={mode} display="spinner" is24Hour onValueChange={(_e, nd) => nd && setD(nd)} textColor={t.text} />
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button kind="ghost" small label={tr.cancel} onPress={onClose} />
          <Button
            small
            label={tr.save}
            onPress={() => {
              onPick(d);
              onClose();
            }}
          />
        </Row>
      </View>
    </Modal>
  );
}

/** Tappable pill showing a time/date; opens the platform picker. */
export function PickerPill({
  mode,
  value,
  onChange,
  placeholder,
  onRemove,
}: {
  mode: Mode;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  onRemove?: () => void;
}) {
  const t = useTheme();
  const n = useNum();
  const p = usePicker(mode, value, onChange);

  if (Platform.OS === 'web') {
    return <WebInput mode={mode} value={value} onChange={onChange} onRemove={onRemove} />;
  }
  return (
    <>
      <Pressable onPress={p.open} style={[styles.pill, { backgroundColor: t.primarySoft }]} accessibilityRole="button">
        <Ionicons name={mode === 'time' ? 'time-outline' : 'calendar-outline'} size={16} color={t.primary} />
        <Text style={[font.body, { color: value ? t.primary : t.muted, fontWeight: '700' }]}>{value ? n(value) : placeholder ?? '—'}</Text>
        {onRemove && (
          <Pressable hitSlop={10} onPress={onRemove}>
            <Ionicons name="close-circle" size={16} color={t.primary} />
          </Pressable>
        )}
      </Pressable>
      {Platform.OS === 'ios' && (
        <IOSSheet mode={mode} visible={p.iosOpen} onClose={() => p.setIosOpen(false)} value={p.toDate()} onPick={(d) => onChange(p.fmt(d))} />
      )}
    </>
  );
}

function WebInput({ mode, value, onChange, onRemove }: { mode: Mode; value?: string; onChange: (v: string) => void; onRemove?: () => void }) {
  const t = useTheme();
  const [text, setText] = useState(value ?? '');
  const valid = mode === 'time' ? isValidHM : isValidISODate;
  return (
    <View style={[styles.pill, { backgroundColor: t.primarySoft }]}>
      <TextInput
        value={text}
        placeholder={mode === 'time' ? 'HH:mm' : 'YYYY-MM-DD'}
        placeholderTextColor={t.faint}
        onChangeText={(s) => {
          setText(s);
          if (valid(s)) onChange(s);
        }}
        style={[font.body, { color: t.primary, fontWeight: '700', width: mode === 'time' ? 56 : 100, padding: 0 }]}
      />
      {onRemove && (
        <Pressable hitSlop={10} onPress={onRemove}>
          <Ionicons name="close-circle" size={16} color={t.primary} />
        </Pressable>
      )}
    </View>
  );
}

/** Edit a list of HH:mm times. */
export function TimesEditor({ times, onChange }: { times: HM[]; onChange: (t: HM[]) => void }) {
  const tr = useT();
  const sorted = [...times].sort();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {sorted.map((tm, i) => (
        <PickerPill
          key={`${tm}-${i}`}
          mode="time"
          value={tm}
          onChange={(v) => onChange(dedupe(sorted.map((x, j) => (j === i ? v : x))))}
          onRemove={() => onChange(sorted.filter((_, j) => j !== i))}
        />
      ))}
      <Chip label={tr.addTime} icon="add" onPress={() => onChange(dedupe([...sorted, nextFree(sorted)]))} />
    </View>
  );
}

const dedupe = (a: HM[]) => Array.from(new Set(a)).sort();
function nextFree(times: HM[]): HM {
  const base = ['08:00', '13:00', '20:00', '22:00', '06:00', '10:00', '16:00', '18:00'];
  return base.find((b) => !times.includes(b)) ?? '12:00';
}

export function DateField({ value, onChange, placeholder }: { value?: ISODate; onChange: (v: ISODate | undefined) => void; placeholder?: string }) {
  return <PickerPill mode="date" value={value} onChange={onChange} placeholder={placeholder} onRemove={value ? () => onChange(undefined) : undefined} />;
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: 16, paddingBottom: 34, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
});
