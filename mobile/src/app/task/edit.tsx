import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Text } from 'react-native';
import { today } from '@/domain/dates';
import type { Task } from '@/domain/types';
import { FormCard, FormScreen } from '@/features/forms';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Field, Row, Segmented, ToggleRow } from '@/ui/components';
import { DateField, PickerPill } from '@/ui/pickers';
import { font, useTheme } from '@/ui/theme';

type Draft = Omit<Task, 'id' | 'updatedAt'> & { id?: string };

export default function EditTask() {
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const existing = useData((s) => (id ? s.tasks[id] : undefined));
  const tr = useT();
  const t = useTheme();
  const [d, setD] = useState<Draft>(() => existing ?? { title: '', priority: 2, done: false, remind: true, alarm: false, date: date ?? today() });
  const [err, setErr] = useState<string>();
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = () => {
    if (!d.title.trim()) return setErr(tr.required);
    useData.getState().upsert('tasks', { ...d, title: d.title.trim() });
    router.back();
  };

  return (
    <FormScreen
      title={existing ? tr.edit : tr.newTask}
      onSave={save}
      onDelete={
        existing
          ? () => {
              useData.getState().remove('tasks', existing.id);
              router.back();
            }
          : undefined
      }
    >
      <Field label={tr.title} value={d.title} autoFocus={!existing} onChangeText={(title) => (patch({ title }), setErr(undefined))} error={err} />
      <Field label={tr.note} value={d.note ?? ''} onChangeText={(note) => patch({ note })} multiline />
      <FormCard label={`${tr.date} · ${tr.time}`}>
        <Row style={{ flexWrap: 'wrap' }}>
          <DateField value={d.date} onChange={(v) => patch({ date: v })} placeholder={tr.noDate} />
          <PickerPill mode="time" value={d.time} onChange={(time) => patch({ time })} placeholder={tr.time} onRemove={d.time ? () => patch({ time: undefined }) : undefined} />
        </Row>
        {d.date && d.time ? (
          <>
            <ToggleRow icon="notifications-outline" label={tr.remindAtTime} value={d.remind} onChange={(remind) => patch({ remind })} />
            {d.remind && <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={d.alarm} onChange={(alarm) => patch({ alarm })} />}
          </>
        ) : (
          <Text style={[font.small, { color: t.muted }]}>{tr.remindAtTime}: {tr.date} + {tr.time}</Text>
        )}
      </FormCard>
      <FormCard label={tr.priority}>
        <Segmented<1 | 2 | 3> value={d.priority} onChange={(priority) => patch({ priority })} options={[1, 2, 3].map((p) => ({ value: p as 1 | 2 | 3, label: tr.pr[p as 1 | 2 | 3] }))} />
      </FormCard>
    </FormScreen>
  );
}
