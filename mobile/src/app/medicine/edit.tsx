import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Text } from '@/ui/Text';
import { PALETTE } from '@/domain/defaults';
import { today } from '@/domain/dates';
import type { Medicine } from '@/domain/types';
import { ColorPicker, FormCard, FormScreen, RecurrenceEditor } from '@/features/forms';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Chip, Field, Row, ToggleRow } from '@/ui/components';
import { DateField, TimesEditor } from '@/ui/pickers';
import { font, useTheme } from '@/ui/theme';

type Draft = Omit<Medicine, 'id' | 'updatedAt'> & { id?: string };

export default function EditMedicine() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useData((s) => (id ? s.medicines[id] : undefined));
  const tr = useT();
  const t = useTheme();
  const [d, setD] = useState<Draft>(
    () =>
      existing ?? {
        name: '',
        dose: '1',
        meal: 'after',
        times: ['08:00', '20:00'],
        recurrence: { type: 'daily' },
        startDate: today(),
        alarm: true,
        enabled: true,
        color: PALETTE[5],
      },
  );
  const [err, setErr] = useState<string>();
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = () => {
    if (!d.name.trim()) return setErr(tr.required);
    if (d.times.length === 0) return setErr(tr.addTime);
    useData.getState().upsert('medicines', { ...d, name: d.name.trim() });
    router.back();
  };

  return (
    <FormScreen
      title={existing ? tr.edit : tr.newMedicine}
      onSave={save}
      onDelete={
        existing
          ? () => {
              useData.getState().remove('medicines', existing.id);
              router.back();
            }
          : undefined
      }
    >
      <Field label={tr.name} value={d.name} autoFocus={!existing} onChangeText={(name) => (patch({ name }), setErr(undefined))} error={err} placeholder="Napa 500mg" />
      <Field label={tr.dose} value={d.dose} onChangeText={(dose) => patch({ dose })} placeholder="1 ট্যাবলেট" />
      <FormCard label={tr.mealLabel}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(['before', 'after', 'with', 'any'] as const).map((m) => (
            <Chip key={m} label={tr.meal[m]} active={d.meal === m} onPress={() => patch({ meal: m })} />
          ))}
        </View>
      </FormCard>
      <FormCard label={tr.times}>
        <TimesEditor times={d.times} onChange={(times) => patch({ times })} />
        <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={d.alarm} onChange={(alarm) => patch({ alarm })} />
        <ToggleRow icon="power-outline" label={tr.enable} value={d.enabled} onChange={(enabled) => patch({ enabled })} />
      </FormCard>
      <FormCard label={tr.repeat}>
        <RecurrenceEditor value={d.recurrence} onChange={(recurrence) => patch({ recurrence })} />
        <Row style={{ flexWrap: 'wrap' }}>
          <Text style={[font.small, { color: t.muted }]}>{tr.startDate}</Text>
          <DateField value={d.startDate} onChange={(v) => patch({ startDate: v ?? today() })} />
          <Text style={[font.small, { color: t.muted }]}>{tr.endDate}</Text>
          <DateField value={d.endDate} onChange={(endDate) => patch({ endDate })} placeholder="—" />
        </Row>
      </FormCard>
      <Field
        label={tr.stock}
        value={d.stock != null ? String(d.stock) : ''}
        keyboardType="number-pad"
        onChangeText={(s) => {
          const n = parseInt(s, 10);
          patch({ stock: Number.isFinite(n) ? n : undefined });
        }}
      />
      <FormCard>
        <ColorPicker colors={PALETTE} value={d.color} onChange={(color) => patch({ color })} />
      </FormCard>
    </FormScreen>
  );
}
