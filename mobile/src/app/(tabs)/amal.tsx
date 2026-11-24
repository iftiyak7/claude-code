import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { amalDueOn } from '@/domain/progress';
import type { AmalKind } from '@/domain/types';
import { AmalCard } from '@/features/AmalCard';
import { useToday } from '@/features/hooks';
import { WeekStrip } from '@/features/WeekStrip';
import { useT } from '@/i18n';
import { useLive } from '@/store/hooks';
import { EmptyState, Fab, Screen, Section, Segmented } from '@/ui/components';

type Filter = 'all' | 'salah' | 'zikr' | 'other';

export default function AmalScreen() {
  const tr = useT();
  const todayIso = useToday();
  const [date, setDate] = useState(todayIso);
  const [filter, setFilter] = useState<Filter>('all');
  const amals = useLive('amals');

  const groups = useMemo(() => {
    const due = amals.filter((a) => amalDueOn(a, date)).sort((a, b) => a.order - b.order);
    const match = (k: AmalKind) =>
      filter === 'all' || (filter === 'salah' ? k === 'salah' : filter === 'zikr' ? k === 'zikr' : k !== 'salah' && k !== 'zikr');
    const list = due.filter((a) => match(a.kind));
    return {
      salah: list.filter((a) => a.kind === 'salah'),
      zikr: list.filter((a) => a.kind === 'zikr'),
      other: list.filter((a) => a.kind !== 'salah' && a.kind !== 'zikr'),
    };
  }, [amals, date, filter]);

  const empty = groups.salah.length + groups.zikr.length + groups.other.length === 0;

  return (
    <View style={{ flex: 1 }}>
      <Screen title={tr.amal} subtitle={tr.privateNote}>
        <WeekStrip value={date} today={todayIso} onChange={setDate} />
        <View style={{ marginTop: 16 }}>
          <Segmented<Filter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: tr.allAmal },
              { value: 'salah', label: tr.salah },
              { value: 'zikr', label: tr.zikr },
              { value: 'other', label: tr.otherAmal },
            ]}
          />
        </View>
        {groups.salah.length > 0 && (
          <Section title={tr.salah}>
            {groups.salah.map((a, i) => (
              <AmalCard key={a.id} amal={a} date={date} index={i} />
            ))}
          </Section>
        )}
        {groups.zikr.length > 0 && (
          <Section title={tr.zikr} delay={60}>
            {groups.zikr.map((a, i) => (
              <AmalCard key={a.id} amal={a} date={date} index={i} />
            ))}
          </Section>
        )}
        {groups.other.length > 0 && (
          <Section title={tr.otherAmal} delay={120}>
            {groups.other.map((a, i) => (
              <AmalCard key={a.id} amal={a} date={date} index={i} />
            ))}
          </Section>
        )}
        {empty && <EmptyState icon="moon-outline" text={tr.newAmal} />}
      </Screen>
      <Fab onPress={() => router.push('/amal/edit')} />
    </View>
  );
}
