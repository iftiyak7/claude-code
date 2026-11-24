import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { currentPrayer, nextPrayer } from '@/domain/prayer';
import { amalDueOn, dayStats, medicineDueOn } from '@/domain/progress';
import type { Amal, PrayerName } from '@/domain/types';
import { AmalCard } from '@/features/AmalCard';
import { formatClock, formatCountdown, gregorianDate, hijriDate, useNow, usePrayerTimes, useToday } from '@/features/hooks';
import { PrayerStrip } from '@/features/PrayerStrip';
import { useNum, useT } from '@/i18n';
import { notificationsGranted, requestNotificationPermission, reschedule } from '@/notifications/scheduler';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import { Button, Card, Ionicons, IslamicPattern, PressableScale, ProgressRing, Row, Section, cardShadow } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, space, useTheme } from '@/ui/theme';

export default function Today() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const settings = useSettings();
  const lang = settings.language;
  const now = useNow(30_000);
  const date = useToday();
  const { today: times, tomorrow } = usePrayerTimes(date);
  const amals = useLive('amals');
  const meds = useLive('medicines');
  const tasks = useLive('tasks');
  const logs = useData((s) => s.logs);

  const [notifOk, setNotifOk] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'web') void notificationsGranted().then(setNotifOk);
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

  const hour = now.getHours();
  const greet = hour < 5 ? tr.greet.night : hour < 12 ? tr.greet.morning : hour < 17 ? tr.greet.noon : hour < 20 ? tr.greet.evening : tr.greet.night;
  const hijri = hijriDate(now, lang);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
        {/* ── Hero ─────────────────────────────────────────────── */}
        <Animated.View entering={FadeIn.duration(500)}>
          <LinearGradient colors={[t.heroA, t.heroB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.hero, { paddingTop: insets.top + 18 }]}>
            <IslamicPattern opacity={0.07} />
            <Row style={{ justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={[font.small, styles.heroMuted]}>{tr.greet.salam}</Text>
                <Text style={[font.h2, { color: '#fff', marginTop: 2 }]} numberOfLines={1}>
                  {settings.name ? settings.name : greet}
                </Text>
              </View>
              <PressableScale onPress={() => router.push('/settings')} style={styles.heroBtn} accessibilityLabel={tr.settings}>
                <Ionicons name="settings-outline" size={20} color="#fff" />
              </PressableScale>
            </Row>
            <Text style={[font.small, styles.heroMuted, { marginTop: 6 }]}>
              {gregorianDate(now, lang)}
              {hijri ? `  ·  ${hijri}` : ''}
            </Text>

            <View style={styles.nextBox}>
              <View style={{ flex: 1 }}>
                <Text style={[font.tiny, { color: '#F3D37A', textTransform: 'uppercase' }]}>{tr.nextPrayer}</Text>
                <Text style={[font.h1, { color: '#fff', marginTop: 2 }]}>{tr.prayer[next.name]}</Text>
                <Text style={[font.small, styles.heroMuted]}>
                  {n(formatClock(next.time))} · {tr.in} {n(formatCountdown(next.time.getTime() - now.getTime(), lang))}
                </Text>
              </View>
              <View style={styles.moon}>
                <Ionicons name={hour >= 18 || hour < 5 ? 'moon' : 'sunny'} size={34} color="#F3D37A" />
              </View>
            </View>
            <PrayerStrip date={date} times={times} salah={salah} current={cur} />
          </LinearGradient>
        </Animated.View>

        <View style={{ paddingHorizontal: space(4) }}>
          {/* ── Progress ───────────────────────────────────────── */}
          <Animated.View entering={FadeInDown.delay(80).springify().damping(18)}>
            <Card style={[styles.progress, { marginTop: -28 }]}>
              <ProgressRing size={96} stroke={10} progress={stats.due ? stats.done / stats.due : 0}>
                <Text style={[font.h2, { color: t.text }]}>{n(stats.due ? Math.round((stats.done / stats.due) * 100) : 0)}%</Text>
              </ProgressRing>
              <View style={{ flex: 1, gap: 10 }}>
                <Text style={[font.h3, { color: t.text }]}>{tr.todayProgress}</Text>
                <Row gap={16}>
                  <Stat icon="checkmark-done" color={t.primary} value={`${n(stats.done)}/${n(stats.due)}`} label={tr.amal} />
                  <Stat icon="star" color={t.gold} value={n(stats.points)} label={tr.points} />
                </Row>
                <Row gap={16}>
                  <Stat icon="moon" color={t.primary} value={`${n(stats.salahDone)}/${n(stats.salahDue)}`} label={tr.salah} />
                </Row>
              </View>
            </Card>
          </Animated.View>

          {!notifOk && (
            <Animated.View entering={FadeInDown}>
              <Card style={[styles.notif, { backgroundColor: t.goldSoft, borderColor: t.gold + '55' }]}>
                <Ionicons name="notifications-off-outline" size={22} color={t.gold} />
                <Text style={[font.small, { color: t.text, flex: 1 }]}>{tr.notifOff}</Text>
                <Button
                  small
                  label={tr.enable}
                  onPress={async () => {
                    const ok = await requestNotificationPermission();
                    setNotifOk(ok);
                    if (ok) void reschedule();
                  }}
                />
              </Card>
            </Animated.View>
          )}

          {/* ── Quick health ───────────────────────────────────── */}
          <Section delay={120}>
            <Row gap={12}>
              <MiniCard
                icon="water"
                color={t.water}
                bg={t.waterSoft}
                title={tr.water}
                value={`${n(water)} / ${n(settings.waterGoalMl)}`}
                sub={tr.ml}
                progress={water / settings.waterGoalMl}
                onPress={() => {
                  useData.getState().bump('water', 'water', settings.glassMl, date);
                  haptic.light();
                }}
                actionIcon="add"
              />
              <MiniCard
                icon="medkit"
                color={t.medicine}
                bg={t.medicineSoft}
                title={tr.medicine}
                value={`${n(medTaken)} / ${n(medDoses)}`}
                sub={tr.taken}
                progress={medDoses ? medTaken / medDoses : 0}
                onPress={() => router.push('/health')}
                actionIcon="chevron-forward"
              />
            </Row>
          </Section>

          {/* ── Amal ───────────────────────────────────────────── */}
          <Section title={tr.otherAmal} delay={160} action={<Link label={tr.seeAll} onPress={() => router.push('/amal')} />}>
            {others.map((a, i) => (
              <AmalCard key={a.id} amal={a} date={date} index={i} />
            ))}
          </Section>

          {/* ── Tasks ──────────────────────────────────────────── */}
          {todayTasks.length > 0 && (
            <Section title={tr.todayTasks} delay={200} action={<Link label={tr.seeAll} onPress={() => router.push('/plan')} />}>
              {todayTasks.map((task) => (
                <Card key={task.id} style={styles.task} onPress={() => useData.getState().toggleTask(task.id)}>
                  <View style={[styles.taskBox, { borderColor: task.date! < date ? t.danger : t.primary }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                      {task.title}
                    </Text>
                    {task.time ? <Text style={[font.small, { color: t.muted }]}>{n(task.time)}</Text> : null}
                  </View>
                </Card>
              ))}
            </Section>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, color, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; value: string; label: string }) {
  const t = useTheme();
  return (
    <Row gap={6}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={[font.body, { color: t.text, fontWeight: '800' }]}>{value}</Text>
      <Text style={[font.small, { color: t.muted }]}>{label}</Text>
    </Row>
  );
}

function MiniCard(p: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  color: string;
  bg: string;
  title: string;
  value: string;
  sub: string;
  progress: number;
  onPress: () => void;
  actionIcon: React.ComponentProps<typeof Ionicons>['name'];
}) {
  const t = useTheme();
  return (
    <PressableScale onPress={p.onPress} style={[styles.mini, cardShadow(t), { backgroundColor: t.surface, borderColor: t.border }]}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={[styles.miniIcon, { backgroundColor: p.bg }]}>
          <Ionicons name={p.icon} size={18} color={p.color} />
        </View>
        <View style={[styles.miniAct, { backgroundColor: p.bg }]}>
          <Ionicons name={p.actionIcon} size={16} color={p.color} />
        </View>
      </Row>
      <Text style={[font.small, { color: t.muted, marginTop: 10 }]}>{p.title}</Text>
      <Text style={[font.h3, { color: t.text }]}>{p.value}</Text>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: p.bg, marginTop: 8, overflow: 'hidden' }}>
        <View style={{ width: `${Math.min(1, p.progress) * 100}%`, height: 6, backgroundColor: p.color, borderRadius: 3 }} />
      </View>
    </PressableScale>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Text onPress={onPress} style={[font.small, { color: t.primary, fontWeight: '700' }]}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space(5), paddingBottom: 52, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  heroMuted: { color: 'rgba(255,255,255,0.75)' },
  heroBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  nextBox: { flexDirection: 'row', alignItems: 'center', marginTop: 18, padding: 16, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.09)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  moon: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(243,211,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  notif: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: space(4) },
  mini: { flex: 1, borderRadius: radius.lg, padding: 14, borderWidth: StyleSheet.hairlineWidth },
  miniIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  miniAct: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  task: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8, paddingVertical: 12 },
  taskBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 2 },
});
