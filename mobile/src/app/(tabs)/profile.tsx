import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { lastNDays, weekday } from '@/domain/dates';
import { dayStats, levelFor, streak, totalPoints } from '@/domain/progress';
import { useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import { useSync } from '@/sync/engine';
import { Card, Divider, Ionicons, IslamicPattern, ListRow, ProgressBar, Section } from '@/ui/components';
import { font, radius, space, useTheme } from '@/ui/theme';

export default function Profile() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const user = useSync((x) => x.user);
  const date = useToday();
  const amals = useLive('amals');
  const meds = useLive('medicines');
  const tasks = useLive('tasks');
  const logs = useData((x) => x.logs);

  const data = useMemo(() => {
    const total = totalPoints(amals, meds, tasks, logs, s.waterGoalMl);
    const stat = (d: string) => dayStats(d, amals, meds, tasks, logs, s.waterGoalMl);
    const week = lastNDays(7, date).map(stat);
    const anyStreak = streak((d) => stat(d).done > 0, date);
    const salahStreak = streak((d) => {
      const x = stat(d);
      return x.salahDue > 0 && x.salahDone === x.salahDue;
    }, date);
    let completed = 0;
    for (const l of Object.values(logs)) {
      if (l.ref !== 'amal' || l.deleted) continue;
      const a = amals.find((x) => x.id === l.refId);
      if (a && l.count >= a.target) completed++;
    }
    return { total, week, anyStreak, salahStreak, completed, lv: levelFor(total) };
  }, [amals, meds, tasks, logs, s.waterGoalMl, date]);

  const maxWeek = Math.max(10, ...data.week.map((d) => d.points));
  const name = s.name || user?.name || tr.yourName;
  const initials = name.trim().slice(0, 1).toUpperCase();

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingBottom: insets.bottom + 120 }} showsVerticalScrollIndicator={false}>
      <LinearGradient colors={[t.heroA, t.heroB]} style={[styles.hero, { paddingTop: insets.top + 24 }]}>
        <IslamicPattern opacity={0.07} />
        <Animated.View entering={FadeInUp.springify().damping(16)} style={{ alignItems: 'center' }}>
          <View style={styles.avatar}>
            {s.name || user?.name ? <Text style={styles.avatarText}>{initials}</Text> : <Ionicons name="person" size={38} color="#0A4A37" />}
          </View>
          <Text style={[font.h2, { color: '#fff', marginTop: 12 }]}>{name}</Text>
          <View style={styles.levelPill}>
            <Ionicons name="ribbon" size={14} color="#0A4A37" />
            <Text style={[font.small, { color: '#0A4A37', fontWeight: '800' }]}>
              {tr.level} {n(data.lv.index + 1)} · {s.language === 'bn' ? data.lv.level.bn : data.lv.level.en}
            </Text>
          </View>
        </Animated.View>
        <View style={styles.pointsBox}>
          <Text style={[font.tiny, { color: '#F3D37A' }]}>{tr.points.toUpperCase()}</Text>
          <Text style={styles.points}>{n(data.total)}</Text>
          {data.lv.next && (
            <View style={{ width: '100%', marginTop: 8 }}>
              <ProgressBar progress={data.lv.progress} color="#F3D37A" track="rgba(255,255,255,0.15)" />
              <Text style={[font.tiny, { color: 'rgba(255,255,255,0.7)', marginTop: 6, textAlign: 'center' }]}>
                {tr.nextLevel}: {s.language === 'bn' ? data.lv.next.bn : data.lv.next.en} ({n(data.lv.next.min - data.total)})
              </Text>
            </View>
          )}
        </View>
      </LinearGradient>

      <View style={{ paddingHorizontal: space(4) }}>
        <Animated.View entering={FadeInDown.delay(80)} style={styles.statsRow}>
          <StatCard icon="flame" color="#F97316" value={n(data.anyStreak)} label={`${tr.streak} (${tr.days})`} />
          <StatCard icon="moon" color={t.primary} value={n(data.salahStreak)} label={tr.salahStreak} />
          <StatCard icon="checkmark-done" color={t.gold} value={n(data.completed)} label={tr.totalAmal} />
        </Animated.View>

        <Section title={tr.last7} delay={120}>
          <Card>
            <View style={styles.chart}>
              {data.week.map((d) => (
                <View key={d.date} style={styles.barCol}>
                  <Text style={[font.tiny, { color: t.muted }]}>{d.points ? n(d.points) : ''}</Text>
                  <View style={[styles.barTrack, { backgroundColor: t.surface2 }]}>
                    <View style={[styles.bar, { height: `${(d.points / maxWeek) * 100}%`, backgroundColor: d.date === date ? t.gold : t.primary }]} />
                  </View>
                  <Text style={[font.tiny, { color: d.date === date ? t.text : t.muted }]}>{tr.weekdays[weekday(d.date)]}</Text>
                </View>
              ))}
            </View>
          </Card>
        </Section>

        <Section delay={160}>
          <Card style={[styles.private, { backgroundColor: t.primarySoft, borderColor: 'transparent' }]}>
            <Ionicons name="shield-checkmark" size={22} color={t.primary} />
            <Text style={[font.small, { color: t.text, flex: 1 }]}>{tr.privateNote}</Text>
          </Card>
        </Section>

        <Section delay={200}>
          <Card style={{ paddingVertical: 4 }}>
            <ListRow icon="cloud-outline" label={tr.account} value={user ? user.email : tr.offline} onPress={() => router.push('/account')} />
            <Divider />
            <ListRow icon="settings-outline" label={tr.settings} onPress={() => router.push('/settings')} />
          </Card>
        </Section>
      </View>
    </ScrollView>
  );
}

function StatCard({ icon, color, value, label }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; value: string; label: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, alignItems: 'center', paddingHorizontal: 8, gap: 4 }}>
      <Ionicons name={icon} size={22} color={color} />
      <Text style={[font.h2, { color: t.text }]}>{value}</Text>
      <Text style={[font.tiny, { color: t.muted, textAlign: 'center' }]} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { paddingHorizontal: space(5), paddingBottom: 48, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  avatar: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#F3D37A', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: 'rgba(255,255,255,0.25)' },
  avatarText: { fontSize: 34, fontWeight: '800', color: '#0A4A37' },
  levelPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F3D37A', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, marginTop: 10 },
  pointsBox: { alignItems: 'center', marginTop: 20, padding: 16, borderRadius: radius.lg, backgroundColor: 'rgba(255,255,255,0.08)' },
  points: { color: '#fff', fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: -30 },
  chart: { flexDirection: 'row', justifyContent: 'space-between', height: 150, alignItems: 'flex-end' },
  barCol: { alignItems: 'center', flex: 1, gap: 6, height: '100%', justifyContent: 'flex-end' },
  barTrack: { width: 18, flex: 1, borderRadius: 9, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 9 },
  private: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});

