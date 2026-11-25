import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, View } from 'react-native';
import { today } from '@/domain/dates';
import type { Task } from '@/domain/types';
import { FormCard, FormScreen } from '@/features/forms';
import { QuickDate, QuickTime } from '@/features/QuickWhen';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Field, Ionicons, Segmented, ToggleRow } from '@/ui/components';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, useTheme } from '@/ui/theme';

type Draft = Omit<Task, 'id' | 'updatedAt'> & { id?: string };

export default function EditTask() {
  const { id, date } = useLocalSearchParams<{ id?: string; date?: string }>();
  const existing = useData((s) => (id ? s.tasks[id] : undefined));
  const tr = useT();
  const t = useTheme();
  const [d, setD] = useState<Draft>(() => existing ?? { title: '', priority: 2, done: false, remind: true, alarm: false, date: date ?? today() });
  const [err, setErr] = useState<string>();
  const [more, setMore] = useState(!!existing && (!!existing.note || existing.priority !== 2 || existing.alarm));
  const patch = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));

  const save = () => {
    if (!d.title.trim()) return setErr(tr.required);
    // a time without a date means "today at that time"
    const date = d.time && !d.date ? today() : d.date;
    useData.getState().upsert('tasks', { ...d, date, title: d.title.trim(), remind: d.remind && !!d.time });
    if (!existing) toast(tr.quick.savedTask, 'checkmark-circle');
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
      <Field
        label={tr.title}
        value={d.title}
        autoFocus={!existing}
        placeholder={tr.quick.taskPh}
        onChangeText={(title) => (patch({ title }), setErr(undefined))}
        error={err}
        returnKeyType="done"
        style={{ fontSize: 18, paddingVertical: 16 }}
      />

      <FormCard>
        <QuickDate value={d.date} onChange={(date) => patch({ date })} />
        <QuickTime value={d.time} onChange={(time) => patch({ time, remind: time ? true : d.remind })} />
        {d.time ? <ToggleRow icon="notifications-outline" label={tr.remindAtTime} hint={tr.quick.remindHint} value={d.remind} onChange={(remind) => patch({ remind })} /> : null}
      </FormCard>

      <Pressable onPress={() => setMore((m) => !m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', padding: 10 }} accessibilityRole="button">
        <Text style={[font.body, { color: t.primary, fontWeight: '600' }]}>{more ? tr.quick.less : tr.quick.more}</Text>
        <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={18} color={t.primary} />
      </Pressable>

      {more && (
        <View>
          <Field label={tr.note} value={d.note ?? ''} onChangeText={(note) => patch({ note })} multiline />
          <FormCard label={tr.priority}>
            <Segmented<1 | 2 | 3> value={d.priority} onChange={(priority) => patch({ priority })} options={[1, 2, 3].map((p) => ({ value: p as 1 | 2 | 3, label: tr.pr[p as 1 | 2 | 3] }))} />
          </FormCard>
          {d.time && d.remind ? (
            <FormCard>
              <ToggleRow icon="alarm-outline" label={tr.alarm} hint={tr.alarmHint} value={d.alarm} onChange={(alarm) => patch({ alarm })} />
            </FormCard>
          ) : null}
        </View>
      )}
    </FormScreen>
  );
}
