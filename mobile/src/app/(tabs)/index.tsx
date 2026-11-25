import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Platform, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentPrayer, nextPrayer } from '@/domain/prayer';
import { amalDueOn, dayStats, medicineDueOn } from '@/domain/progress';
import type { Amal, PrayerName } from '@/domain/types';
import { AmalCard } from '@/features/AmalCard';
import { BannerSlider } from '@/features/BannerSlider';
import { formatClock, formatCountdown, gregorianDate, hijriDate, useNow, usePrayerTimes, useToday } from '@/features/hooks';
import { PrayerStrip } from '@/features/PrayerStrip';
import { useNum, useT } from '@/i18n';
import { unreadCount, useInbox } from '@/notifications/announcements';
import { allGranted, getSetupStatus } from '@/permissions/reminderSetup';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import {
  Avatar,
  Blob,
  Button,
  Card,
  Fab,
  IconButton,
  Ionicons,
  PressableScale,
  ProgressBar,
  ProgressRing,
  Row,
  Section,
  SeeAll,
  cardShadow,
  type IconName,
} from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { MosqueScene } from '@/ui/Illustration';
import { Text } from '@/ui/Text';
import { font, radius, space, useTheme } from '@/ui/theme';

export default function Today() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const lang = settings.language;
  const now = useNow(15_000);
  const date = useToday();
  const { today: times, tomorrow } = usePrayerTimes(date);
  const amals = useLive('amals');
  const meds = useLive('medicines');
  const tasks = useLive('tasks');
  const logs = useData((s) => s.logs);
  const unread = useInbox(unreadCount);

  const [setupOk, setSetupOk] = useState(true);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const check = () => void getSetupStatus().then((s) => setSetupOk(allGranted(s)));
    check();
    const sub = AppState.addEventListener('change', (st) => st === 'active' && check());
    return () => sub.remove();
  }, []);

  const salah = useMemo(() => {
    const m: Partial<Record<PrayerName, Amal>> = {};
    for (const a of amals) if (a.kind === 'salah' && a.prayer && !a.archived) m[a.prayer] = a;
    return m;
  }, [amals]);

  const others = useMemo(
    () => amals.filter((a) => a.kind !== 'salah' && amalDueOn(a, date)).sort((a, b) => a.order - b.order),
    [amals, date],
  );
  const stats = useMemo(() => dayStats(date, amals, meds, tasks, logs, settings.waterGoalMl), [date, amals, meds, tasks, logs, settings.waterGoalMl]);
  const next = nextPrayer(times, tomorrow.fajr, now);
  const cur = currentPrayer(times, now);
  const todayTasks = tasks.filter((x) => !x.done && x.date && x.date <= date).slice(0, 3);
  const medsDue = meds.filter((m) => medicineDueOn(m, date));
  const medDoses = medsDue.reduce((s, m) => s + m.times.length, 0);
  const medTaken = medsDue.reduce((s, m) => s + m.times.filter((tm) => (logs[`${date}|medicine|${m.id}|${tm}`]?.count ?? 0) > 0).length, 0);
  const water = logs[`${date}|water|water`]?.count ?? 0;
  const pct = stats.due ? stats.done / stats.due : 0;

  const hour = now.getHours();
  const night = hour >= 18 || hour < 5;
  const hijri = hijriDate(now, lang);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Blob size={280} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + space(4), paddingBottom: insets.bottom + 130 }} showsVerticalScrollIndicator={false}>
        <View style={{ paddingHorizontal: space(5) }}>
          {/* ── Greeting ─────────────────────────────────────── */}
          <Animated.View entering={FadeInDown.duration(400)}>
            <Row gap={12}>
              <PressableScale onPress={() => router.push('/profile')}>
                <Avatar name={settings.name} size={52} />
              </PressableScale>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, { color: t.muted }]}>{tr.greet.salam},</Text>
                <Text style={[font.h3, { color: t.text, fontSize: 19 }]} numberOfLines={1}>
                  {settings.name || tr.appName}
                </Text>
              </View>
              <View>
                <IconButton icon="notifications-outline" onPress={() => router.push('/inbox')} label={tr.inbox.title} />
                {unread > 0 && (
                  <View style={[styles.badge, { backgroundColor: t.primary, borderColor: t.bg }]} pointerEvents="none">
                    <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{n(unread > 9 ? '9+' : unread)}</Text>
                  </View>
                )}
              </View>
              <IconButton icon="options-outline" onPress={() => router.push('/settings')} label={tr.settings} />
            </Row>
          </Animated.View>

          {/* ── Next prayer hero ─────────────────────────────── */}
          <Animated.View entering={FadeInDown.delay(60).duration(450).springify().damping(18)}>
            <Card style={styles.hero}>
              <Row style={{ alignItems: 'flex-start' }}>
                <View style={{ flex: 1, paddingTop: 4 }}>
                  <Text style={[font.small, { color: t.muted }]}>{tr.nextPrayer}</Text>
                  <Text style={[font.display, { color: t.text, fontSize: 38, marginTop: 2 }]}>{tr.prayer[next.name]}</Text>
                  <Text style={[font.body, { color: t.text, marginTop: 2 }]}>{n(formatClock(next.time, lang))}</Text>
                  <View style={[styles.countdown, { backgroundColor: t.primarySoft }]}>
                    <Ionicons name="time-outline" size={14} color={t.primaryDeep} />
                    <Text style={[font.tiny, { color: t.primaryDeep, fontSize: 12 }]}>
                      {tr.in} {n(formatCountdown(next.time.getTime() - now.getTime(), lang))}
                    </Text>
                  </View>
                </View>
                <View style={{ marginRight: -10, marginTop: -6 }}>
                  <MosqueScene night={night} width={150} />
                </View>
              </Row>
              <Text style={[font.tiny, { color: t.muted, marginTop: 12, marginBottom: 14, fontWeight: '500' }]}>
                {gregorianDate(now, lang)}
                {hijri ? `  ·  ${hijri}` : ''}
              </Text>
              <PrayerStrip date={date} times={times} salah={salah} current={cur} />
            </Card>
          </Animated.View>

          {!setupOk && (
            <Animated.View entering={FadeInDown}>
              <Card style={[styles.notif, { backgroundColor: t.ink }]} onPress={() => router.push('/setup')}>
                <Ionicons name="alarm-outline" size={22} color={t.onInk} />
                <Text style={[font.small, { color: t.onInk, flex: 1 }]}>{tr.setup.banner}</Text>
                <Button small kind="accent" label={tr.setup.allow} onPress={() => router.push('/setup')} />
              </Card>
            </Animated.View>
          )}

          {/* ── Banners ────────────────────────────────────────── */}
          <Animated.View entering={FadeInDown.delay(90).duration(450)} style={{ marginTop: space(5) }}>
            <BannerSlider />
          </Animated.View>

          {/* ── Progress ───────────────────────────────────────── */}
          <Section title={tr.todayProgress} delay={100}>
            <Card style={styles.progress}>
              <ProgressRing size={104} stroke={12} progress={pct}>
                <Text style={[font.h2, { color: t.text }]}>{n(Math.round(pct * 100))}%</Text>
              </ProgressRing>
              <View style={{ flex: 1, gap: 14 }}>
                <Stat label={tr.amal} value={`${n(stats.done)}/${n(stats.due)}`} icon="checkmark-done" color={t.primary} bg={t.primarySoft} />
                <Stat label={tr.salah} value={`${n(stats.salahDone)}/${n(stats.salahDue)}`} icon="moon" color={t.lavenderInk} bg={t.lavenderSoft} />
                <Stat label={tr.points} value={n(stats.points)} icon="star" color={t.gold} bg={t.goldSoft} />
              </View>
            </Card>
          </Section>

          {/* ── Health ─────────────────────────────────────────── */}
          <Section delay={140}>
            <Row gap={12} style={{ alignItems: 'stretch' }}>
              <HealthCard
                icon="water"
                color={t.water}
                bg={t.waterSoft}
                title={tr.water}
                value={n(water)}
                unit={`/ ${n(settings.waterGoalMl)} ${tr.ml}`}
                progress={water / settings.waterGoalMl}
                actionIcon="add"
                onAction={() => {
                  useData.getState().bump('water', 'water', settings.glassMl, date);
                  haptic.light();
                }}
                onPress={() => router.push('/health')}
              />
              <HealthCard
                icon="medical"
                color={t.medicine}
                bg={t.medicineSoft}
                title={tr.medicine}
                value={n(medTaken)}
                unit={`/ ${n(medDoses)} ${tr.taken}`}
                progress={medDoses ? medTaken / medDoses : 0}
                actionIcon="arrow-forward"
                onAction={() => router.push('/health')}
                onPress={() => router.push('/health')}
              />
            </Row>
          </Section>

          {/* ── Amal ───────────────────────────────────────────── */}
          <Section title={tr.otherAmal} delay={180} action={<SeeAll label={tr.seeAll} onPress={() => router.push('/amal')} />}>
            {others.map((a, i) => (
              <AmalCard key={a.id} amal={a} date={date} index={i} />
            ))}
          </Section>

          {/* ── Tasks ──────────────────────────────────────────── */}
          {todayTasks.length > 0 && (
            <Section title={tr.todayTasks} delay={220} action={<SeeAll label={tr.seeAll} onPress={() => router.push('/plan')} />}>
              {todayTasks.map((task) => (
                <Card key={task.id} style={styles.task} onPress={() => useData.getState().toggleTask(task.id)}>
                  <View style={[styles.taskBox, { borderColor: task.date! < date ? t.danger : t.text }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text, fontWeight: '600' }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                    {task.time ? <Text style={[font.small, { color: t.muted }]}>{n(task.time)}</Text> : null}
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.faint} />
                </Card>
              ))}
            </Section>
          )}
        </View>
      </ScrollView>
      <Fab onPress={() => router.push('/add')} />
    </View>
  );
}

function Stat({ icon, color, bg, value, label }: { icon: IconName; color: string; bg: string; value: string; label: string }) {
  const t = useTheme();
  return (
    <Row gap={10}>
      <View style={[styles.statIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={14} color={color} />
      </View>
      <Text style={[font.small, { color: t.muted, flex: 1 }]}>{label}</Text>
      <Text style={[font.body, { color: t.text, fontWeight: '700' }]}>{value}</Text>
    </Row>
  );
}

function HealthCard(p: {
  icon: IconName;
  color: string;
  bg: string;
  title: string;
  value: string;
  unit: string;
  progress: number;
  actionIcon: IconName;
  onAction: () => void;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <PressableScale onPress={p.onPress} style={[styles.health, cardShadow(t), { backgroundColor: t.surface }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={[styles.healthIcon, { backgroundColor: p.bg }]}>
          <Ionicons name={p.icon} size={20} color={p.color} />
        </View>
        <PressableScale onPress={p.onAction} scaleTo={0.85} hitSlop={8} style={[styles.healthAct, { backgroundColor: t.ink }]}>
          <Ionicons name={p.actionIcon} size={16} color={t.onInk} />
        </PressableScale>
      </Row>
      <Text style={[font.small, { color: t.muted, marginTop: 14 }]}>{p.title}</Text>
      <Text style={[font.h2, { color: t.text, marginTop: 2 }]}>{p.value}</Text>
      <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]} numberOfLines={1}>
        {p.unit}
      </Text>
      <View style={{ marginTop: 12 }}>
        <ProgressBar progress={p.progress} color={p.color} track={p.bg} height={6} />
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  hero: { marginTop: space(5), padding: space(5), borderRadius: radius.xl },
  countdown: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, marginTop: 10 },
  notif: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space(4), paddingVertical: 12 },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 22 },
  statIcon: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  health: { flex: 1, borderRadius: radius.lg, padding: 16 },
  healthIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  healthAct: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10, paddingVertical: 16 },
  taskBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2 },
});
