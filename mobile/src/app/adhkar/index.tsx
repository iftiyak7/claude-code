/** Adhkar home: after-salah, morning and evening collections with today's progress. */
import { router, useFocusEffect } from 'expo-router';
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CAT_ORDER, CATEGORIES, catProgress, useAdhkar, type AdhkarCat } from '@/adhkar/data';
import { usePrayerTimes, useNow, useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useSettings } from '@/store/hooks';
import { Card, Ionicons, PressableScale, ProgressRing, Screen, type IconName } from '@/ui/components';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

export default function AdhkarHome() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const lang = useSettings().language;
  const date = useToday();
  const now = useNow(60_000);
  const { today: times } = usePrayerTimes(date);
  const progress = useAdhkar((s) => s.progress);
  useFocusEffect(useCallback(() => useAdhkar.getState().load(date), [date]));

  // suggest what fits the time of day: morning after Fajr until Dhuhr, evening from Asr
  const suggested: AdhkarCat = now >= times.fajr && now < times.dhuhr ? 'morning' : now >= times.asr && now < times.isha ? 'evening' : 'salah';
  const tint: Record<AdhkarCat, [string, string]> = {
    salah: [t.lavenderInk, t.lavenderSoft],
    morning: [t.gold, t.goldSoft],
    evening: [t.primary, t.primarySoft],
  };

  return (
    <Screen title={tr.adhkar.title} subtitle={tr.adhkar.sub} back>
      {CAT_ORDER.map((cat, i) => {
        const p = catProgress(progress, cat);
        const pct = p.total ? p.done / p.total : 0;
        const on = cat === suggested;
        return (
          <Animated.View key={cat} entering={FadeInDown.delay(i * 70).duration(380)}>
            <PressableScale
              onPress={() => router.push({ pathname: '/adhkar/[cat]', params: { cat } })}
              style={[styles.card, { backgroundColor: on ? t.hero : t.surface, borderColor: on ? t.hero : t.border }]}
            >
              <View style={[styles.icon, { backgroundColor: on ? 'rgba(255,255,255,0.12)' : tint[cat][1] }]}>
                <Ionicons name={CATEGORIES[cat].icon as IconName} size={26} color={on ? '#FFB48A' : tint[cat][0]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[font.h3, { color: on ? '#fff' : t.text }]}>{lang === 'bn' ? CATEGORIES[cat].bn : CATEGORIES[cat].en}</Text>
                <Text style={[font.small, { color: on ? 'rgba(255,255,255,0.7)' : t.muted }]}>{tr.adhkar.progress(n(p.done), n(p.total))}</Text>
              </View>
              <ProgressRing size={54} stroke={6} progress={pct} color={on ? '#FFB48A' : tint[cat][0]} track={on ? 'rgba(255,255,255,0.15)' : undefined}>
                {pct >= 1 ? (
                  <Ionicons name="checkmark" size={20} color={on ? '#FFB48A' : tint[cat][0]} />
                ) : (
                  <Text style={[font.tiny, { color: on ? '#fff' : t.text, fontWeight: '700' }]}>{n(Math.round(pct * 100))}%</Text>
                )}
              </ProgressRing>
            </PressableScale>
          </Animated.View>
        );
      })}
      <Animated.View entering={FadeInDown.delay(260).duration(380)}>
        <Card style={[styles.note, { backgroundColor: t.successSoft, borderColor: 'transparent' }]}>
          <Ionicons name="shield-checkmark" size={22} color={t.success} />
          <Text style={[font.small, { color: t.text, flex: 1, lineHeight: 20 }]}>{tr.adhkar.verified}</Text>
        </Card>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: radius.lg, borderWidth: 1, marginTop: 12 },
  icon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  note: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
});
