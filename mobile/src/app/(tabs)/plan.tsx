import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { Text } from '@/ui/Text';
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated';
import { hmFromDate, hmToMinutes, weekday } from '@/domain/dates';
import { PRAYERS } from '@/domain/prayer';
import type { Reminder, RoutineBlock, Task } from '@/domain/types';
import { useNow, usePrayerTimes, useToday } from '@/features/hooks';
import { WeekStrip } from '@/features/WeekStrip';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { useLive } from '@/store/hooks';
import { Badge, Button, Card, EmptyState, Fab, Ionicons, PressableScale, Screen, Section, Segmented, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, useTheme } from '@/ui/theme';

type Tab = 'routine' | 'tasks' | 'reminders';

export default function Plan() {
  const tr = useT();
  const [tab, setTab] = useState<Tab>('routine');
  const todayIso = useToday();
  const [date, setDate] = useState(todayIso);

  const fab = () =>
    router.push(tab === 'routine' ? '/routine/edit' : tab === 'tasks' ? `/task/edit?date=${date}` : '/reminder/edit');

  return (
    <View style={{ flex: 1 }}>
      <Screen title={tr.tabs.plan}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'routine', label: tr.routine },
            { value: 'tasks', label: tr.tasks },
            { value: 'reminders', label: tr.reminders },
          ]}
        />
        {tab !== 'reminders' && <WeekStrip value={date} today={todayIso} onChange={setDate} />}
        {tab === 'routine' && <RoutineView date={date} isToday={date === todayIso} />}
        {tab === 'tasks' && <TasksView date={date} todayIso={todayIso} />}
        {tab === 'reminders' && <RemindersView />}
      </Screen>
      <Fab onPress={fab} />
    </View>
  );
}

// ── Routine timeline ────────────────────────────────────────────────────

type Item = { key: string; start: string; end?: string; title: string; color: string; icon: IconName; block?: RoutineBlock; prayer?: boolean };

function RoutineView({ date, isToday }: { date: string; isToday: boolean }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const blocks = useLive('routines');
  const { today: times } = usePrayerTimes(date);
  const now = useNow(60_000);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const items = useMemo<Item[]>(() => {
    const wd = weekday(date);
    const list: Item[] = blocks
      .filter((b) => b.days.length === 0 || b.days.includes(wd))
      .map((b) => ({ key: b.id, start: b.start, end: b.end, title: b.title, color: b.color, icon: b.icon as IconName, block: b }));
    for (const p of PRAYERS) {
      list.push({ key: p, start: hmFromDate(times[p]), title: `${tr.prayer[p]} ${tr.salah}`, color: t.gold, icon: 'moon', prayer: true });
    }
    return list.sort((a, b) => hmToMinutes(a.start) - hmToMinutes(b.start));
  }, [blocks, date, times, tr, t.gold]);

  if (blocks.length === 0) {
    return (
      <Section>
        <EmptyState icon="time-outline" text={tr.emptyRoutine} />
        <Timeline items={items} isToday={isToday} nowMin={nowMin} n={n} />
      </Section>
    );
  }
  return (
    <Section>
      <Timeline items={items} isToday={isToday} nowMin={nowMin} n={n} />
    </Section>
  );
}

function Timeline({ items, isToday, nowMin, n }: { items: Item[]; isToday: boolean; nowMin: number; n: (x: string | number) => string }) {
  const t = useTheme();
  return (
    <View>
      {items.map((it, i) => {
        const s = hmToMinutes(it.start);
        const e = it.end ? hmToMinutes(it.end) : s + 20;
        const active = isToday && nowMin >= s && nowMin < e;
        const past = isToday && nowMin >= e;
        return (
          <Animated.View key={it.key} entering={FadeInDown.delay(i * 30)} style={styles.tlRow}>
            <View style={styles.tlTime}>
              <Text style={[font.small, { color: active ? t.primary : t.muted, fontWeight: '700' }]}>{n(it.start)}</Text>
            </View>
            <View style={styles.tlRail}>
              <View style={[styles.tlDot, { backgroundColor: active ? t.primary : it.color, opacity: past ? 0.4 : 1 }]} />
              {i < items.length - 1 && <View style={[styles.tlLine, { backgroundColor: t.border }]} />}
            </View>
            <Card
              onPress={it.block ? () => router.push(`/routine/edit?id=${it.block!.id}`) : undefined}
              style={[
                styles.tlCard,
                it.prayer && { backgroundColor: t.goldSoft, borderColor: 'transparent' },
                active && { borderColor: t.primary, borderWidth: 1.5 },
                past && { opacity: 0.55 },
              ]}
            >
              <Ionicons name={it.icon} size={18} color={it.color} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { color: t.text, fontWeight: '700' }]} numberOfLines={1}>
                  {it.title}
                </Text>
                {it.end ? (
                  <Text style={[font.small, { color: t.muted }]}>
                    {n(it.start)} – {n(it.end)}
                  </Text>
                ) : null}
              </View>
              {it.block?.remind && <Ionicons name="notifications" size={14} color={t.faint} />}
            </Card>
          </Animated.View>
        );
      })}
    </View>
  );
}

// ── Tasks ───────────────────────────────────────────────────────────────

function TasksView({ date, todayIso }: { date: string; todayIso: string }) {
  const tr = useT();
  const tasks = useLive('tasks');
  const [showDone, setShowDone] = useState(false);

  const groups = useMemo(() => {
    const open = tasks.filter((x) => !x.done);
    const byTime = (a: Task, b: Task) => (b.priority - a.priority) || (a.time ?? '99').localeCompare(b.time ?? '99');
    return {
      overdue: date === todayIso ? open.filter((x) => x.date && x.date < todayIso).sort(byTime) : [],
      day: open.filter((x) => x.date === date).sort(byTime),
      noDate: open.filter((x) => !x.date).sort(byTime),
      upcoming: date === todayIso ? open.filter((x) => x.date && x.date > todayIso).sort((a, b) => a.date!.localeCompare(b.date!)).slice(0, 10) : [],
      done: tasks.filter((x) => x.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0)).slice(0, 30),
    };
  }, [tasks, date, todayIso]);

  const nothing = groups.overdue.length + groups.day.length + groups.noDate.length + groups.upcoming.length === 0;

  return (
    <>
      {nothing && <EmptyState icon="checkbox-outline" text={tr.emptyTasks} action={<Button label={tr.add_.oneTap} icon="flash-outline" kind="soft" onPress={() => router.push('/add')} />} />}
      {groups.overdue.length > 0 && <TaskGroup title={tr.overdue} items={groups.overdue} danger />}
      {groups.day.length > 0 && <TaskGroup title={date === todayIso ? tr.todayTasks : tr.tasks} items={groups.day} />}
      {groups.upcoming.length > 0 && <TaskGroup title={tr.upcoming} items={groups.upcoming} showDate />}
      {groups.noDate.length > 0 && <TaskGroup title={tr.noDate} items={groups.noDate} />}
      {groups.done.length > 0 && (
        <Section title={`${tr.completed} (${groups.done.length})`} action={<Text onPress={() => setShowDone((v) => !v)}>{showDone ? '▲' : '▼'}</Text>}>
          {showDone && groups.done.map((x) => <TaskRow key={x.id} task={x} />)}
        </Section>
      )}
    </>
  );
}

function TaskGroup({ title, items, danger, showDate }: { title: string; items: Task[]; danger?: boolean; showDate?: boolean }) {
  return (
    <Section title={title}>
      {items.map((x) => (
        <TaskRow key={x.id} task={x} danger={danger} showDate={showDate} />
      ))}
    </Section>
  );
}

function TaskRow({ task, danger, showDate }: { task: Task; danger?: boolean; showDate?: boolean }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const prColor = task.priority === 3 ? t.danger : task.priority === 2 ? t.gold : t.faint;
  return (
    <Animated.View layout={LinearTransition.springify().damping(18)} entering={FadeInDown.duration(250)}>
      <Card onPress={() => router.push(`/task/edit?id=${task.id}`)} style={styles.taskRow}>
        <PressableScale
          scaleTo={0.8}
          onPress={() => {
            useData.getState().toggleTask(task.id);
            if (task.done) haptic.tap();
            else haptic.success();
          }}
          hitSlop={10}
          style={[styles.check, task.done ? { backgroundColor: t.success, borderColor: t.success } : { borderColor: danger ? t.danger : prColor }]}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: task.done }}
        >
          {task.done && <Ionicons name="checkmark" size={16} color="#fff" />}
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={[font.body, { color: task.done ? t.muted : t.text, textDecorationLine: task.done ? 'line-through' : 'none' }]} numberOfLines={2}>
            {task.title}
          </Text>
          {(task.time || (showDate && task.date) || task.note) && (
            <Text style={[font.small, { color: t.muted, marginTop: 2 }]} numberOfLines={1}>
              {[showDate && task.date ? n(task.date) : null, task.time ? n(task.time) : null, task.note].filter(Boolean).join(' · ')}
            </Text>
          )}
        </View>
        {task.remind && task.time && !task.done && <Ionicons name={task.alarm ? 'alarm' : 'notifications'} size={16} color={t.faint} />}
        {task.priority === 3 && !task.done && <Badge label={tr.pr[3]} color={t.danger} bg={t.dangerSoft} />}
      </Card>
    </Animated.View>
  );
}

// ── Reminders ───────────────────────────────────────────────────────────

function RemindersView() {
  const tr = useT();
  const t = useTheme();
  const n = useNum();
  const reminders = useLive('reminders');
  const describe = (r: Reminder) => {
    const rec = r.recurrence;
    const when =
      rec.type === 'weekly' ? rec.days.map((d) => tr.weekdays[d]).join(', ') : rec.type === 'once' ? n(rec.date) : rec.type === 'everyNDays' ? `${tr.every} ${n(rec.every)} ${tr.days}` : rec.type === 'monthly' ? `${tr.rec.monthly} ${n(rec.day)}` : tr.rec.daily;
    return `${when} · ${r.times.map((x) => n(x)).join(', ')}`;
  };
  if (reminders.length === 0) return <EmptyState icon="notifications-outline" text={tr.emptyReminders} />;
  return (
    <Section>
      {reminders.map((r, i) => (
        <Animated.View key={r.id} entering={FadeInDown.delay(i * 40)}>
          <Card onPress={() => router.push(`/reminder/edit?id=${r.id}`)} style={styles.remRow}>
            <View style={[styles.remIcon, { backgroundColor: r.color + '22' }]}>
              <Ionicons name={r.icon as IconName} size={20} color={r.color} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { color: t.text, fontWeight: '700' }]} numberOfLines={1}>
                {r.title}
              </Text>
              <Text style={[font.small, { color: t.muted }]} numberOfLines={1}>
                {describe(r)}
              </Text>
            </View>
            <Switch
              value={r.enabled}
              onValueChange={(enabled) => {
                haptic.tap();
                useData.getState().upsert('reminders', { ...r, enabled });
              }}
              trackColor={{ true: t.primary, false: t.border }}
              thumbColor="#fff"
            />
          </Card>
        </Animated.View>
      ))}
    </Section>
  );
}

const styles = StyleSheet.create({
  tlRow: { flexDirection: 'row', alignItems: 'stretch', minHeight: 64 },
  tlTime: { width: 52, paddingTop: 14 },
  tlRail: { width: 20, alignItems: 'center' },
  tlDot: { width: 12, height: 12, borderRadius: 6, marginTop: 18 },
  tlLine: { width: 2, flex: 1, marginTop: 4 },
  tlCard: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10, paddingVertical: 12, marginLeft: 6 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingVertical: 12 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  remRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  remIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});

