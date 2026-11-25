import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { AMAL_ICONS, PALETTE } from '@/domain/defaults';
import type { Reminder } from '@/domain/types';
import { ColorPicker, FormCard, FormScreen, MoreToggle, RecurrenceEditor } from '@/features/forms';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Field, Ionicons, PressableScale, ToggleRow, type IconName } from '@/ui/components';
import { TimesEditor } from '@/ui/pickers';
import { useTheme } from '@/ui/theme';

type Draft = Omit<Reminder, 'id' | 'updatedAt'> & { id?: string };

const ICONS = ['notifications-outline', 'call-outline', 'cart-outline', 'school-outline', 'briefcase-outline', 'cash-outline', 'gift-outline', ...AMAL_ICONS.slice(0, 5)];

export default function EditReminder() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useData((s) => (id ? s.reminders[id] : undefined));
  const tr = useT();
  const t = useTheme();
  const [d, setD] = useState<Draft>(
    () => existing ?? { title: '', recurrence: { type: 'daily' }, times: ['09:00'], alarm: false, enabled: true, icon: 'notifications-outline', color: PALETTE[7] },
  );
  const [err, setErr] = useState<string>();
  const [more, setMore] = useState(!!existing);
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = () => {
    if (!d.title.trim()) return setErr(tr.required);
    if (d.times.length === 0) return setErr(tr.addTime);
    useData.getState().upsert('reminders', { ...d, title: d.title.trim() });
    router.back();
  };

  return (
    <FormScreen
      title={existing ? tr.edit : tr.newReminder}
      onSave={save}
      onDelete={
        existing
          ? () => {
              useData.getState().remove('reminders', existing.id);
              router.back();
            }
          : undefined
      }
    >
      <Field label={tr.title} value={d.title} autoFocus={!existing} placeholder={tr.quick.reminderPh} onChangeText={(title) => (patch({ title }), setErr(undefined))} error={err} style={{ fontSize: 18, paddingVertical: 16 }} />
      <FormCard label={tr.repeat}>
        <RecurrenceEditor value={d.recurrence} onChange={(recurrence) => patch({ recurrence })} />
      </FormCard>
      <FormCard label={tr.times}>
        <TimesEditor times={d.times} onChange={(times) => patch({ times })} />
        <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={d.alarm} onChange={(alarm) => patch({ alarm })} />
        {more && <ToggleRow icon="power-outline" label={tr.enable} value={d.enabled} onChange={(enabled) => patch({ enabled })} />}
      </FormCard>
      <MoreToggle open={more} onToggle={() => setMore((m) => !m)} />
      {more && <Field label={tr.note} value={d.note ?? ''} onChangeText={(note) => patch({ note })} />}
      {more && <FormCard>
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
      </FormCard>}
    </FormScreen>
  );
}
