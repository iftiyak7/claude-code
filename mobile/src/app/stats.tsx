/** Full statistics: is the user's amal rising or falling, day by day. */
import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { weekday } from '@/domain/dates';
import { computeStats, type Trend } from '@/domain/stats';
import { useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import { Card, Ionicons, ProgressBar, Screen, Segmented, type IconName } from '@/ui/components';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

type Range = 7 | 30 | 90;

export default function StatsScreen() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const s = useSettings();
  const date = useToday();
  const amals = useLive('amals');
  const meds = useLive('medicines');
  const tasks = useLive('tasks');
  const logs = useData((x) => x.logs);
  const [range, setRange] = useState<Range>(30);

  const st = useMemo(() => computeStats({ amals, meds, tasks, logs, waterGoalMl: s.waterGoalMl }, date, range), [amals, meds, tasks, logs, s.waterGoalMl, date, range]);
  const maxPts = Math.max(1, ...st.days.map((d) => d.points));
  const weakest = st.salah.filter((x) => x.due > 0).sort((a, b) => a.rate - b.rate)[0];
  const hasData = st.activeDays > 0;

  return (
    <Screen title={tr.stats.title} subtitle={tr.stats.sub} back>
      {/* week over week */}
      <Animated.View entering={FadeInDown.duration(380)}>
        <View style={[styles.hero, { backgroundColor: t.hero }]}>
          <TrendBadge trend={st.trend} />
          <Text style={[font.h2, { color: '#fff', marginTop: 10 }]}>
            {st.pointsChange === null || st.trend === 'same'
              ? hasData
                ? tr.stats.same
                : tr.stats.noData
              : st.trend === 'up'
                ? tr.stats.up(n(Math.abs(st.pointsChange)))
                : tr.stats.down(n(Math.abs(st.pointsChange)))}
          </Text>
          <View style={styles.weekRow}>
            <WeekCol label={tr.stats.thisWeek} points={n(st.thisWeek.points)} rate={n(Math.round(st.thisWeek.rate * 100))} strong />
            <View style={styles.weekDivider} />
            <WeekCol label={tr.stats.lastWeek} points={n(st.lastWeek.points)} rate={n(Math.round(st.lastWeek.rate * 100))} />
          </View>
        </View>
      </Animated.View>

      <View style={{ marginTop: 18 }}>
        <Segmented<Range> value={range} onChange={setRange} options={([7, 30, 90] as Range[]).map((r) => ({ value: r, label: tr.stats.range[r] }))} />
      </View>

      {/* daily points chart */}
      <Animated.View key={range} entering={FadeInDown.duration(350)}>
        <Card style={{ marginTop: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <View>
              <Text style={[font.small, { color: t.muted }]}>{tr.stats.dailyPoints}</Text>
              <Text style={[font.display, { color: t.text, fontSize: 32 }]}>{n(st.days.reduce((a, d) => a + d.points, 0))}</Text>
            </View>
            <Text style={[font.small, { color: t.muted }]}>
              {tr.stats.avgPerDay}: <Text style={{ color: t.text, fontWeight: '700' }}>{n(st.avgPoints)}</Text>
            </Text>
          </View>
          <View style={styles.chart}>
            <View style={[styles.avgLine, { bottom: `${(st.avgPoints / maxPts) * 100}%`, borderColor: t.primary + '66' }]} />
            {st.days.map((d, i) => {
              const h = d.points / maxPts;
              const isToday = d.date === date;
              const rate = d.due ? d.done / d.due : 0;
              return (
                <Animated.View
                  key={d.date}
                  entering={range <= 30 ? FadeInUp.delay(i * (range === 7 ? 40 : 12)).duration(300) : undefined}
                  style={[styles.barCol, { marginHorizontal: range === 90 ? 0.5 : range === 30 ? 1.5 : 6 }]}
                >
                  <View
                    style={[
                      styles.bar,
                      {
                        height: `${Math.max(h, d.points > 0 ? 0.04 : 0.015) * 100}%`,
                        backgroundColor: d.points === 0 ? t.surface2 : isToday ? t.hero : rate >= 1 ? t.success : t.primary,
                        borderRadius: range === 90 ? 2 : 6,
                      },
                    ]}
                  />
                </Animated.View>
              );
            })}
          </View>
          {range === 7 && (
            <View style={styles.dayLabels}>
              {st.days.map((d) => (
                <Text key={d.date} style={[font.tiny, { flex: 1, textAlign: 'center', color: d.date === date ? t.text : t.muted }]}>
                  {tr.weekdays[weekday(d.date)]}
                </Text>
              ))}
            </View>
          )}
          <View style={styles.legend}>
            <Legend color={t.success} label={`${n(100)}%`} />
            <Legend color={t.primary} label={tr.stats.completion} />
            <Legend color={t.hero} label={tr.tabs.today} />
          </View>
        </Card>
      </Animated.View>

      {/* tiles */}
      <View style={styles.tiles}>
        <Tile icon="trophy" color={t.gold} bg={t.goldSoft} label={tr.stats.bestDay} value={st.best ? `${n(st.best.points)} ${tr.stats.points}` : '—'} delay={60} />
        <Tile icon="calendar" color={t.water} bg={t.waterSoft} label={tr.stats.activeDays} value={`${n(st.activeDays)}/${n(st.days.length)}`} delay={100} />
        <Tile icon="flame" color={t.primary} bg={t.primarySoft} label={tr.stats.current} value={tr.stats.days(n(st.currentStreak))} delay={140} />
        <Tile icon="ribbon" color={t.lavenderInk} bg={t.lavenderSoft} label={tr.stats.longest} value={tr.stats.days(n(st.longestStreak))} delay={180} />
      </View>

      {/* salah by prayer */}
      <Animated.View entering={FadeInDown.delay(120).duration(380)}>
        <Card style={{ marginTop: 12, gap: 12 }}>
          <Text style={[font.h3, { color: t.text }]}>{tr.stats.salahByPrayer}</Text>
          {st.salah.map((x) => (
            <View key={x.prayer} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{tr.prayer[x.prayer]}</Text>
                <Text style={[font.small, { color: t.muted }]}>
                  {n(x.done)}/{n(x.due)} · <Text style={{ color: t.text, fontWeight: '700' }}>{n(Math.round(x.rate * 100))}%</Text>
                </Text>
              </View>
              <ProgressBar progress={x.rate} color={x.rate >= 0.8 ? t.success : x.rate >= 0.5 ? t.gold : t.danger} height={8} />
            </View>
          ))}
          {hasData && weakest && (
            <View style={[styles.hint, { backgroundColor: weakest.rate >= 0.9 ? t.successSoft : t.goldSoft }]}>
              <Ionicons name={weakest.rate >= 0.9 ? 'checkmark-circle' : 'bulb'} size={18} color={weakest.rate >= 0.9 ? t.success : t.gold} />
              <Text style={[font.small, { color: t.text, flex: 1 }]}>{weakest.rate >= 0.9 ? tr.stats.allGood : tr.stats.weakest(tr.prayer[weakest.prayer])}</Text>
            </View>
          )}
        </Card>
      </Animated.View>

      {/* per amal */}
      <Animated.View entering={FadeInDown.delay(160).duration(380)}>
        <Card style={{ marginTop: 12, gap: 14 }}>
          <Text style={[font.h3, { color: t.text }]}>{tr.stats.perAmal}</Text>
          {st.perAmal.map((x) => (
            <View key={x.amal.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={[styles.dot, { backgroundColor: x.amal.color }]} />
                <Text style={[font.body, { color: t.text, fontWeight: '600', flex: 1 }]} numberOfLines={1}>
                  {x.amal.title}
                </Text>
                <Text style={[font.small, { color: t.muted }]}>
                  {n(x.lastWeek)} → <Text style={{ color: t.text, fontWeight: '700' }}>{n(x.thisWeek)}</Text>
                </Text>
                <TrendBadge trend={x.trend} small />
              </View>
              <View style={styles.dots}>
                {x.dots.map((d, i) => (
                  <View key={i} style={[styles.dayDot, { backgroundColor: d === null ? 'transparent' : d ? x.amal.color : t.surface2, borderColor: d === null ? t.border : 'transparent' }]} />
                ))}
              </View>
            </View>
          ))}
        </Card>
      </Animated.View>
    </Screen>
  );
}

function TrendBadge({ trend, small }: { trend: Trend; small?: boolean }) {
  const t = useTheme();
  const tr = useT();
  const cfg: Record<Trend, [IconName, string, string, string]> = {
    up: ['trending-up', t.success, t.successSoft, tr.stats.improving],
    down: ['trending-down', t.danger, t.dangerSoft, tr.stats.declining],
    same: ['remove', t.muted, t.surface2, tr.stats.steady],
  };
  const [icon, color, bg, label] = cfg[trend];
  return (
    <View style={[styles.badge, { backgroundColor: small ? bg : 'rgba(255,255,255,0.12)', alignSelf: small ? 'auto' : 'flex-start' }]}>
      <Ionicons name={icon} size={small ? 14 : 16} color={small ? color : trend === 'up' ? '#6EE7B7' : trend === 'down' ? '#FCA5A5' : '#fff'} />
      {!small && <Text style={[font.tiny, { color: '#fff', fontWeight: '700' }]}>{label}</Text>}
    </View>
  );
}

function WeekCol({ label, points, rate, strong }: { label: string; points: string; rate: string; strong?: boolean }) {
  const tr = useT();
  return (
    <View style={{ flex: 1 }}>
      <Text style={[font.tiny, { color: strong ? '#FFB48A' : 'rgba(255,255,255,0.6)', fontWeight: '600' }]}>{label}</Text>
      <Text style={[font.h2, { color: strong ? '#fff' : 'rgba(255,255,255,0.75)' }]}>{points}</Text>
      <Text style={[font.tiny, { color: 'rgba(255,255,255,0.6)', fontWeight: '500' }]}>
        {tr.stats.points} · {rate}% {tr.stats.completion}
      </Text>
    </View>
  );
}

function Tile({ icon, color, bg, label, value, delay }: { icon: IconName; color: string; bg: string; label: string; value: string; delay: number }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(350)} style={styles.tileWrap}>
      <Card style={{ gap: 6 }}>
        <View style={[styles.tileIcon, { backgroundColor: bg }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{label}</Text>
        <Text style={[font.h3, { color: t.text }]}>{value}</Text>
      </Card>
    </Animated.View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color }} />
      <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 20 },
  weekRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 16 },
  weekDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.15)' },
  chart: { height: 170, flexDirection: 'row', alignItems: 'flex-end', marginTop: 16 },
  avgLine: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1.5, borderStyle: 'dashed' },
  barCol: { flex: 1, height: '100%', justifyContent: 'flex-end' },
  bar: { width: '100%' },
  dayLabels: { flexDirection: 'row', marginTop: 8 },
  legend: { flexDirection: 'row', gap: 14, marginTop: 12, flexWrap: 'wrap' },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 12 },
  tileWrap: { width: '48%', flexGrow: 1 },
  tileIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dots: { flexDirection: 'row', gap: 4, paddingLeft: 18 },
  dayDot: { flex: 1, height: 8, borderRadius: 4, borderWidth: 1 },
});
