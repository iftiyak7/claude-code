import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AMAL_ICONS, PALETTE } from '@/domain/defaults';
import { hmToMinutes } from '@/domain/dates';
import type { RoutineBlock } from '@/domain/types';
import { ColorPicker, FormCard, FormScreen } from '@/features/forms';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Chip, Field, Ionicons, PressableScale, Row, ToggleRow, type IconName } from '@/ui/components';
import { PickerPill } from '@/ui/pickers';
import { font, useTheme } from '@/ui/theme';

type Draft = Omit<RoutineBlock, 'id' | 'updatedAt'> & { id?: string };

const ICONS = ['bed-outline', 'cafe-outline', 'briefcase-outline', 'school-outline', 'barbell-outline', 'restaurant-outline', 'car-outline', 'people-outline', ...AMAL_ICONS.slice(0, 4)];

export default function EditRoutine() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useData((s) => (id ? s.routines[id] : undefined));
  const tr = useT();
  const t = useTheme();
  const [d, setD] = useState<Draft>(() => existing ?? { title: '', start: '09:00', end: '10:00', days: [], color: PALETTE[2], icon: 'briefcase-outline', remind: true });
  const [err, setErr] = useState<string>();
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = () => {
    if (!d.title.trim()) return setErr(tr.required);
    if (hmToMinutes(d.end) <= hmToMinutes(d.start)) return setErr(`${tr.end} > ${tr.start}`);
    useData.getState().upsert('routines', { ...d, title: d.title.trim() });
    router.back();
  };

  return (
    <FormScreen
      title={existing ? tr.edit : tr.newRoutine}
      onSave={save}
      onDelete={
        existing
          ? () => {
              useData.getState().remove('routines', existing.id);
              router.back();
            }
          : undefined
      }
    >
      <Field label={tr.title} value={d.title} autoFocus={!existing} onChangeText={(title) => (patch({ title }), setErr(undefined))} error={err} />
      <FormCard label={`${tr.start} – ${tr.end}`}>
        <Row>
          <PickerPill mode="time" value={d.start} onChange={(start) => patch({ start })} />
          <Text style={[font.body, { color: t.muted }]}>→</Text>
          <PickerPill mode="time" value={d.end} onChange={(end) => patch({ end })} />
        </Row>
        <ToggleRow icon="notifications-outline" label={tr.remindAtTime} value={d.remind} onChange={(remind) => patch({ remind })} />
      </FormCard>
      <FormCard label={tr.repeat}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Chip label={tr.rec.daily} active={d.days.length === 0} onPress={() => patch({ days: [] })} />
          {tr.weekdays.map((w, i) => {
            const on = d.days.includes(i);
            return <Chip key={w} label={w} active={on} onPress={() => patch({ days: on ? d.days.filter((x) => x !== i) : [...d.days, i].sort() })} />;
          })}
        </View>
      </FormCard>
      <FormCard>
        <ColorPicker colors={PALETTE} value={d.color} onChange={(color) => patch({ color })} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ICONS.map((ic) => (
            <PressableScale
              key={ic}
              onPress={() => patch({ icon: ic })}
              style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: d.icon === ic ? d.color : t.surface2 }}
            >
              <Ionicons name={ic as IconName} size={20} color={d.icon === ic ? '#fff' : t.muted} />
            </PressableScale>
          ))}
        </View>
      </FormCard>
    </FormScreen>
  );
}
