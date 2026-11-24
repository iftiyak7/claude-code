import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '@/ui/Text';
import Animated, { Easing, FadeInDown, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { medicineDueOn } from '@/domain/progress';
import type { Medicine } from '@/domain/types';
import { FormCard, NumberInput, ReminderEditor } from '@/features/forms';
import { useLogCount, useToday } from '@/features/hooks';
import { WeekStrip } from '@/features/WeekStrip';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { useLive, useSettings } from '@/store/hooks';
import { Button, Card, Chip, EmptyState, Fab, Ionicons, PressableScale, Row, Screen, Section, Segmented } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { font, radius, useTheme } from '@/ui/theme';

type Tab = 'water' | 'medicine';

export default function Health() {
  const tr = useT();
  const [tab, setTab] = useState<Tab>('water');
  const todayIso = useToday();
  const [date, setDate] = useState(todayIso);
  const logs = useData((s) => s.logs);
  const waterGoal = useData((s) => s.settings.waterGoalMl);
  return (
    <View style={{ flex: 1 }}>
      <Screen title={tr.tabs.health}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'water', label: tr.water },
            { value: 'medicine', label: tr.medicine },
          ]}
        />
        <WeekStrip value={date} today={todayIso} onChange={setDate} complete={(d) => (logs[`${d}|water|water`]?.count ?? 0) / waterGoal} />
        {tab === 'water' ? <WaterView date={date} /> : <MedicineView date={date} />}
      </Screen>
      {tab === 'medicine' && <Fab onPress={() => router.push('/medicine/edit')} />}
    </View>
  );
}

// ── Water ───────────────────────────────────────────────────────────────

function WaterGlass({ progress }: { progress: number }) {
  const t = useTheme();
  const H = 220;
  const fill = useSharedValue(0);
  const wave = useSharedValue(0);
  useEffect(() => {
    fill.set(withTiming(Math.min(1, progress), { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [progress, fill]);
  useEffect(() => {
    wave.set(withRepeat(withTiming(1, { duration: 2600, easing: Easing.linear }), -1, false));
  }, [wave]);
  const level = useAnimatedStyle(() => ({ height: H * fill.value }));
  const waveStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -160 * wave.value }] }));
  return (
    <View style={[styles.glass, { borderColor: t.water + '55', backgroundColor: t.waterSoft, height: H }]}>
      <Animated.View style={[styles.level, level]}>
        <Animated.View style={[styles.waveWrap, waveStyle]}>
          <Svg width={320} height={16} viewBox="0 0 320 16">
            <Path d="M0 8 Q 20 0 40 8 T 80 8 T 120 8 T 160 8 T 200 8 T 240 8 T 280 8 T 320 8 V16 H0 Z" fill={t.water} />
          </Svg>
        </Animated.View>
        <View style={{ flex: 1, backgroundColor: t.water }} />
      </Animated.View>
    </View>
  );
}

function WaterView({ date }: { date: string }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const s = useSettings();
  const ml = useLogCount('water', 'water', date);
  const progress = ml / s.waterGoalMl;
  const glasses = Math.round(ml / s.glassMl);
  const add = (delta: number) => {
    useData.getState().bump('water', 'water', delta, date);
    if (delta <= 0) haptic.tap();
    else if (ml < s.waterGoalMl && ml + delta >= s.waterGoalMl) haptic.success();
    else haptic.light();
  };
  return (
    <>
      <Section>
        <Card style={{ alignItems: 'center', gap: 16 }}>
          <Row gap={28} style={{ alignItems: 'center' }}>
            <WaterGlass progress={progress} />
            <View style={{ gap: 6 }}>
              <Text style={[font.h1, { color: t.water }]}>{n(ml)}</Text>
              <Text style={[font.small, { color: t.muted }]}>
                / {n(s.waterGoalMl)} {tr.ml}
              </Text>
              <Text style={[font.body, { color: t.text, marginTop: 8 }]}>
                {n(glasses)} {tr.glass}
              </Text>
              <Text style={[font.small, { color: progress >= 1 ? t.success : t.muted }]}>{n(Math.min(100, Math.round(progress * 100)))}%</Text>
            </View>
          </Row>
          <Row gap={10}>
            <PressableScale onPress={() => add(-s.glassMl)} style={[styles.round, { backgroundColor: t.surface2 }]} accessibilityLabel="-">
              <Ionicons name="remove" size={22} color={t.text} />
            </PressableScale>
            <PressableScale onPress={() => add(s.glassMl)} scaleTo={0.92} style={[styles.big, { backgroundColor: t.water }]}>
              <Ionicons name="water" size={20} color="#fff" />
              <Text style={[font.body, { color: '#fff', fontWeight: '800' }]}>
                +{n(s.glassMl)} {tr.ml}
              </Text>
            </PressableScale>
            <PressableScale onPress={() => add(500)} style={[styles.round, { backgroundColor: t.waterSoft }]} accessibilityLabel="+500">
              <Text style={[font.small, { color: t.water, fontWeight: '800' }]}>{n(500)}</Text>
            </PressableScale>
          </Row>
        </Card>
      </Section>

      <Section title={tr.settings}>
        <FormCard label={`${tr.dailyGoal} (${tr.ml})`}>
          <NumberInput value={s.waterGoalMl} min={500} max={8000} step={250} onChange={(waterGoalMl) => useData.getState().updateSettings({ waterGoalMl })} />
          <Text style={[font.small, { color: t.muted }]}>
            {tr.glass} ({tr.ml})
          </Text>
          <Row style={{ flexWrap: 'wrap' }}>
            {[150, 200, 250, 300, 500].map((g) => (
              <Chip key={g} label={n(g)} active={s.glassMl === g} onPress={() => useData.getState().updateSettings({ glassMl: g })} />
            ))}
          </Row>
        </FormCard>
        <FormCard label={tr.waterReminder}>
          <ReminderEditor value={s.waterReminder} onChange={(waterReminder) => useData.getState().updateSettings({ waterReminder })} />
        </FormCard>
      </Section>
    </>
  );
}

// ── Medicine ────────────────────────────────────────────────────────────

function MedicineView({ date }: { date: string }) {
  const tr = useT();
  const meds = useLive('medicines');
  const due = useMemo(() => meds.filter((m) => medicineDueOn(m, date)), [meds, date]);
  const others = useMemo(() => meds.filter((m) => !medicineDueOn(m, date)), [meds, date]);
  if (meds.length === 0) {
    return <EmptyState icon="medkit-outline" text={tr.emptyMeds} action={<Button label={tr.newMedicine} icon="add" onPress={() => router.push('/medicine/edit')} />} />;
  }
  return (
    <>
      <Section title={tr.todayMeds}>
        {due.map((m, i) => (
          <MedicineCard key={m.id} med={m} date={date} index={i} />
        ))}
      </Section>
      {others.length > 0 && (
        <Section title={tr.medicine}>
          {others.map((m, i) => (
            <MedicineCard key={m.id} med={m} date={date} index={i} inactive />
          ))}
        </Section>
      )}
    </>
  );
}

function MedicineCard({ med, date, index, inactive }: { med: Medicine; date: string; index: number; inactive?: boolean }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const logs = useData((s) => s.logs);
  return (
    <Animated.View entering={FadeInDown.delay(index * 40)}>
      <Card onPress={() => router.push(`/medicine/edit?id=${med.id}`)} style={[{ marginBottom: 10, gap: 12 }, inactive && { opacity: 0.6 }]}>
        <Row gap={12}>
          <View style={[styles.medIcon, { backgroundColor: med.color + '22' }]}>
            <Ionicons name="medical" size={20} color={med.color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: t.text, fontWeight: '700' }]}>{med.name}</Text>
            <Text style={[font.small, { color: t.muted }]}>
              {med.dose} · {tr.meal[med.meal]}
              {med.stock != null ? ` · ${tr.stock.split(' ')[0]}: ${n(med.stock)}` : ''}
            </Text>
          </View>
          {med.alarm && <Ionicons name="alarm" size={16} color={t.faint} />}
        </Row>
        {!inactive && (
          <Row style={{ flexWrap: 'wrap' }}>
            {med.times.map((tm) => {
              const taken = (logs[`${date}|medicine|${med.id}|${tm}`]?.count ?? 0) > 0;
              return (
                <PressableScale
                  key={tm}
                  scaleTo={0.92}
                  onPress={() => {
                    const st = useData.getState();
                    st.setCount('medicine', med.id, taken ? 0 : 1, date, tm);
                    if (med.stock != null) st.upsert('medicines', { ...med, stock: Math.max(0, med.stock + (taken ? 1 : -1)) });
                    if (taken) haptic.tap();
                    else haptic.success();
                  }}
                  style={[styles.dose, taken ? { backgroundColor: t.success } : { backgroundColor: t.medicineSoft }]}
                >
                  <Ionicons name={taken ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={taken ? '#fff' : t.medicine} />
                  <Text style={[font.small, { color: taken ? '#fff' : t.medicine, fontWeight: '700' }]}>{n(tm)}</Text>
                </PressableScale>
              );
            })}
          </Row>
        )}
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  glass: { width: 110, borderRadius: 26, borderWidth: 3, overflow: 'hidden', justifyContent: 'flex-end' },
  level: { width: '100%', overflow: 'hidden' },
  waveWrap: { width: 320, height: 16 },
  round: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  big: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 22, height: 52, borderRadius: radius.pill },
  medIcon: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  dose: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill },
});
