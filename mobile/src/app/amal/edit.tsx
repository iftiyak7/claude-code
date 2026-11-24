import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { AMAL_ICONS, noReminder, PALETTE } from '@/domain/defaults';
import type { Amal, AmalKind } from '@/domain/types';
import { ColorPicker, FormCard, FormScreen, NumberInput, RecurrenceEditor, ReminderEditor } from '@/features/forms';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Chip, Field, Ionicons, PressableScale, Row, ToggleRow, type IconName } from '@/ui/components';
import { DateField } from '@/ui/pickers';
import { font, useTheme } from '@/ui/theme';

type Draft = Omit<Amal, 'id' | 'updatedAt'> & { id?: string };

const KINDS: AmalKind[] = ['zikr', 'quran', 'dua', 'sadaqah', 'fasting', 'salah', 'custom'];

export default function EditAmal() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useData((s) => (id ? s.amals[id] : undefined));
  const t = useTheme();
  const tr = useT();
  const [d, setD] = useState<Draft>(
    () =>
      existing ?? {
        kind: 'zikr',
        title: '',
        target: 100,
        unit: useData.getState().settings.language === 'bn' ? 'বার' : 'times',
        recurrence: { type: 'daily' },
        reminder: { ...noReminder(), mode: 'interval', intervalMinutes: 60 },
        points: 10,
        color: PALETTE[1],
        icon: 'leaf-outline',
        order: Date.now() / 1e10 + 30,
      },
  );
  const [err, setErr] = useState<string>();
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const isFard = !!d.prayer;

  const save = () => {
    if (!d.title.trim()) return setErr(tr.required);
    useData.getState().upsert('amals', { ...d, title: d.title.trim(), target: Math.max(1, d.target) });
    router.back();
  };

  return (
    <FormScreen
      title={existing ? tr.editAmal : tr.newAmal}
      onSave={save}
      onDelete={
        existing && !isFard
          ? () => {
              useData.getState().remove('amals', existing.id);
              router.back();
            }
          : undefined
      }
    >
      {!isFard && (
        <FormCard label={tr.kind}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {KINDS.filter((k) => k !== 'salah').map((k) => (
              <Chip key={k} label={tr.kinds[k]} active={d.kind === k} onPress={() => patch({ kind: k })} />
            ))}
          </View>
        </FormCard>
      )}

      <Field label={tr.title} value={d.title} onChangeText={(title) => (patch({ title }), setErr(undefined))} error={err} placeholder="সুবহানাল্লাহ" />
      <Field label={tr.arabic} value={d.arabic ?? ''} onChangeText={(arabic) => patch({ arabic })} style={{ textAlign: 'right', fontSize: 20 }} placeholder="سُبْحَانَ ٱللَّٰهِ" />
      <Field label={tr.meaning} value={d.meaning ?? ''} onChangeText={(meaning) => patch({ meaning })} />

      {!isFard && (
        <FormCard label={tr.target}>
          <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <NumberInput value={d.target} onChange={(target) => patch({ target })} step={d.target >= 100 ? 10 : 1} />
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {[33, 100, 200, 1000].map((x) => (
                <Chip key={x} label={String(x)} active={d.target === x} onPress={() => patch({ target: x })} />
              ))}
            </View>
          </Row>
          <Field label={tr.unit} value={d.unit ?? ''} onChangeText={(unit) => patch({ unit })} />
        </FormCard>
      )}

      {!isFard && (
        <FormCard label={tr.repeat}>
          <RecurrenceEditor value={d.recurrence} onChange={(recurrence) => patch({ recurrence })} />
          <Row style={{ flexWrap: 'wrap' }}>
            <Text style={[font.small, { color: t.muted }]}>{tr.startDate}</Text>
            <DateField value={d.startDate} onChange={(startDate) => patch({ startDate })} placeholder="—" />
            <Text style={[font.small, { color: t.muted }]}>{tr.endDate}</Text>
            <DateField value={d.endDate} onChange={(endDate) => patch({ endDate })} placeholder="—" />
          </Row>
        </FormCard>
      )}

      <FormCard label={tr.remindMode}>
        {isFard ? (
          <>
            <Text style={[font.small, { color: t.muted }]}>{tr.minutesAfter}</Text>
            <NumberInput value={d.prayerOffset ?? 0} min={0} max={120} step={5} onChange={(prayerOffset) => patch({ prayerOffset })} />
            <ToggleRow
              icon="notifications-outline"
              label={tr.remindAtTime}
              value={d.reminder.mode !== 'none'}
              onChange={(on) => patch({ reminder: { ...d.reminder, mode: on ? 'times' : 'none', times: [] } })}
            />
            <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={d.reminder.alarm} onChange={(alarm) => patch({ reminder: { ...d.reminder, alarm } })} />
          </>
        ) : (
          <ReminderEditor value={d.reminder} onChange={(reminder) => patch({ reminder })} />
        )}
      </FormCard>

      <FormCard label={tr.pointsEach}>
        <NumberInput value={d.points} min={0} max={500} onChange={(points) => patch({ points })} />
      </FormCard>

      {!isFard && (
        <FormCard>
          <ColorPicker colors={PALETTE} value={d.color} onChange={(color) => patch({ color })} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {AMAL_ICONS.map((ic) => (
              <PressableScale
                key={ic}
                onPress={() => patch({ icon: ic })}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: d.icon === ic ? d.color : t.surface2,
                }}
              >
                <Ionicons name={ic as IconName} size={20} color={d.icon === ic ? '#fff' : t.muted} />
              </PressableScale>
            ))}
          </View>
        </FormCard>
      )}
    </FormScreen>
  );
}
