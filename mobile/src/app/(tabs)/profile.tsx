import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { lastNDays, weekday } from '@/domain/dates';
import { dayStats, levelFor, streak, totalPoints } from '@/domain/progress';
import { computeStats } from '@/domain/stats';
import { useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import { useSync } from '@/sync/engine';
import { Avatar, Card, Ionicons, ListRow, PressableScale, ProgressBar, Row, Screen, Section, type IconName } from '@/ui/components';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

export default function Profile() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
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
    const rates = week.map((d) => (d.due ? d.done / d.due : 0));
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const anyStreak = streak((d) => stat(d).done > 0, date);
    const salahStreak = streak((d) => {
      const x = stat(d);
      return x.salahDue > 0 && x.salahDone === x.salahDue;
    }, date);
    let completed = 0;
    const byId = new Map(amals.map((a) => [a.id, a]));
    for (const l of Object.values(logs)) {
      if (l.ref !== 'amal' || l.deleted) continue;
      const a = byId.get(l.refId);
      if (a && l.count >= a.target) completed++;
    }
    return { total, week, rates, avg, anyStreak, salahStreak, completed, lv: levelFor(total) };
  }, [amals, meds, tasks, logs, s.waterGoalMl, date]);

  const trend = useMemo(() => computeStats({ amals, meds, tasks, logs, waterGoalMl: s.waterGoalMl }, date, 14), [amals, meds, tasks, logs, s.waterGoalMl, date]);
  const name = s.name || user?.name || '';
  const levelName = s.language === 'bn' ? data.lv.level.bn : data.lv.level.en;

  return (
    <Screen>
      {/* ── Identity ─────────────────────────────────────────── */}
      <Animated.View entering={FadeInUp.springify().damping(16)} style={{ alignItems: 'center', marginTop: 4 }}>
        <Avatar name={name} size={92} />
        <Text style={[font.h1, { color: t.text, marginTop: 12 }]}>{name || tr.yourName}</Text>
        <View style={[styles.levelPill, { backgroundColor: t.ink }]}>
          <Ionicons name="ribbon" size={14} color={t.primary} />
          <Text style={[font.small, { color: t.onInk, fontWeight: '600' }]}>
            {tr.level} {n(data.lv.index + 1)} · {levelName}
          </Text>
        </View>
      </Animated.View>

      {/* ── Points ───────────────────────────────────────────── */}
      <Animated.View entering={FadeInDown.delay(60)}>
        <Card style={styles.points}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View>
              <Text style={[font.small, { color: t.muted }]}>{tr.points}</Text>
              <Text style={[font.display, { color: t.text, fontSize: 44, lineHeight: 52 }]}>{n(data.total)}</Text>
            </View>
            <View style={[styles.star, { backgroundColor: t.goldSoft }]}>
              <Ionicons name="star" size={24} color={t.gold} />
            </View>
          </Row>
          {data.lv.next && (
            <>
              <View style={{ marginTop: 14 }}>
                <ProgressBar progress={data.lv.progress} color={t.primary} height={10} />
              </View>
              <Text style={[font.small, { color: t.muted, marginTop: 8 }]}>
                {tr.nextLevel}: <Text style={{ color: t.text, fontWeight: '600' }}>{s.language === 'bn' ? data.lv.next.bn : data.lv.next.en}</Text> · {n(data.lv.next.min - data.total)} {tr.points}
              </Text>
            </>
          )}
        </Card>
      </Animated.View>

      <Animated.View entering={FadeInDown.delay(100)} style={styles.statsRow}>
        <StatTile icon="flame" color={t.primary} bg={t.primarySoft} value={n(data.anyStreak)} label={tr.streak} />
        <StatTile icon="moon" color={t.lavenderInk} bg={t.lavenderSoft} value={n(data.salahStreak)} label={tr.salahStreak} />
        <StatTile icon="checkmark-done" color={t.success} bg={t.successSoft} value={n(data.completed)} label={tr.totalAmal} />
      </Animated.View>

      {/* ── Weekly overview ─────────────────────────────────── */}
      <Section delay={140}>
        <Card>
          <Text style={[font.small, { color: t.muted }]}>{tr.last7}</Text>
          <Text style={[font.display, { color: t.text }]}>{n(Math.round(data.avg * 100))}%</Text>
          <Text style={[font.small, { color: t.muted }]}>{tr.completionRate}</Text>
          <View style={styles.chart}>
            {data.week.map((d, i) => {
              const r = data.rates[i];
              const isToday = d.date === date;
              return (
                <View key={d.date} style={styles.barCol}>
                  <View style={[styles.barTrack, { backgroundColor: t.surface2 }]}>
                    <View style={[styles.bar, { height: `${Math.max(r, 0.18) * 100}%`, backgroundColor: r > 0 ? (isToday ? t.ink : t.primary) : 'transparent' }]}>
                      {r > 0 && (
                        <View style={[styles.barDot, { backgroundColor: isToday ? t.primary : '#fff' }]}>
                          <Text style={[font.tiny, { fontSize: 9, color: isToday ? '#fff' : t.primary }]}>{n(Math.round(r * 100))}</Text>
                        </View>
                      )}
                    </View>
                  </View>
                  <Text style={[font.tiny, { color: isToday ? t.text : t.muted, fontWeight: isToday ? '700' : '500' }]}>{tr.weekdays[weekday(d.date)]}</Text>
                </View>
              );
            })}
          </View>
        </Card>
      </Section>

      {/* ── Trend → full statistics ─────────────────────────── */}
      <Section delay={160}>
        <PressableScale onPress={() => router.push('/stats')} style={[styles.trend, { backgroundColor: t.hero }]}>
          <View style={[styles.trendIcon, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
            <Ionicons
              name={trend.trend === 'up' ? 'trending-up' : trend.trend === 'down' ? 'trending-down' : 'stats-chart'}
              size={22}
              color={trend.trend === 'up' ? '#6EE7B7' : trend.trend === 'down' ? '#FCA5A5' : '#FFB48A'}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: '#fff', fontWeight: '700' }]}>
              {trend.pointsChange === null || trend.trend === 'same'
                ? trend.activeDays
                  ? tr.stats.same
                  : tr.stats.noData
                : trend.trend === 'up'
                  ? tr.stats.up(n(Math.abs(trend.pointsChange)))
                  : tr.stats.down(n(Math.abs(trend.pointsChange)))}
            </Text>
            <Text style={[font.small, { color: 'rgba(255,255,255,0.7)' }]}>{tr.stats.open}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#fff" />
        </PressableScale>
      </Section>

      <Section delay={180}>
        <Card style={[styles.private, { backgroundColor: t.lavenderSoft, borderColor: 'transparent' }]}>
          <Ionicons name="shield-checkmark" size={24} color={t.lavenderInk} />
          <Text style={[font.small, { color: t.text, flex: 1 }]}>{tr.privateNote}</Text>
        </Card>
      </Section>

      <Section delay={220}>
        <ListRow icon="cloud-outline" label={tr.account} value={user ? user.email : tr.offline} onPress={() => router.push('/account')} iconColor={t.water} iconBg={t.waterSoft} />
        <ListRow icon="settings-outline" label={tr.settings} onPress={() => router.push('/settings')} />
      </Section>
    </Screen>
  );
}

function StatTile({ icon, color, bg, value, label }: { icon: IconName; color: string; bg: string; value: string; label: string }) {
  const t = useTheme();
  return (
    <Card style={{ flex: 1, paddingHorizontal: 12, paddingVertical: 16, gap: 6 }}>
      <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[font.h2, { color: t.text }]}>{value}</Text>
      <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]} numberOfLines={2}>
        {label}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  levelPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill, marginTop: 10 },
  points: { marginTop: 22 },
  star: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  chart: { flexDirection: 'row', justifyContent: 'space-between', height: 190, alignItems: 'flex-end', marginTop: 18, gap: 8 },
  barCol: { alignItems: 'center', flex: 1, gap: 8, height: '100%' },
  barTrack: { width: '100%', flex: 1, borderRadius: 24, justifyContent: 'flex-end', overflow: 'hidden' },
  bar: { width: '100%', borderRadius: 24, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 5 },
  barDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  private: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  trend: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: radius.lg },
  trendIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
});
