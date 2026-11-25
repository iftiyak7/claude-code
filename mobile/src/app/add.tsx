/**
 * One friendly place to add anything: big "what do you want to add?" tiles,
 * then ready-made templates that are added with a single tap.
 */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import type { TemplateKind } from '@/domain/templates';
import { applyTemplate, isTemplateAdded, templateRoute, TEMPLATES } from '@/features/templates';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Card, Chip, Ionicons, PressableScale, Screen, Section, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

type Kind = { key: string; icon: IconName; route: string; color: string; bg: string; title: string; sub: string };

export default function AddScreen() {
  const t = useTheme();
  const tr = useT();
  const lang = useData((s) => s.settings.language);
  // re-render when anything is added so the ✓ state updates
  useData((s) => s.rev);
  const [filter, setFilter] = useState<'all' | TemplateKind>('all');

  const kinds: Kind[] = [
    { key: 'task', icon: 'checkbox-outline', route: '/task/edit', color: t.primary, bg: t.primarySoft, title: tr.add_.task, sub: tr.add_.taskSub },
    { key: 'zikr', icon: 'radio-button-on-outline', route: '/amal/edit?kind=zikr', color: t.success, bg: t.successSoft, title: tr.add_.zikr, sub: tr.add_.zikrSub },
    { key: 'amal', icon: 'moon-outline', route: '/amal/edit?kind=custom', color: t.lavenderInk, bg: t.lavenderSoft, title: tr.add_.amal, sub: tr.add_.amalSub },
    { key: 'reminder', icon: 'notifications-outline', route: '/reminder/edit', color: t.gold, bg: t.goldSoft, title: tr.add_.reminder, sub: tr.add_.reminderSub },
    { key: 'medicine', icon: 'medical-outline', route: '/medicine/edit', color: t.medicine, bg: t.medicineSoft, title: tr.add_.medicine, sub: tr.add_.medicineSub },
    { key: 'routine', icon: 'time-outline', route: '/routine/edit', color: t.water, bg: t.waterSoft, title: tr.add_.routine, sub: tr.add_.routineSub },
  ];

  const list = TEMPLATES.filter((x) => filter === 'all' || x.kind === filter);

  return (
    <Screen title={tr.add_.title} subtitle={tr.add_.subtitle} back>
      <View style={styles.grid}>
        {kinds.map((k, i) => (
          <Animated.View key={k.key} entering={FadeInDown.delay(i * 40).duration(350)} style={styles.cell}>
            <PressableScale
              onPress={() => {
                haptic.tap();
                router.push(k.route as never);
              }}
              style={[styles.kind, { backgroundColor: t.surface }]}
              accessibilityRole="button"
            >
              <View style={[styles.kindIcon, { backgroundColor: k.bg }]}>
                <Ionicons name={k.icon} size={26} color={k.color} />
              </View>
              <Text style={[font.h3, { color: t.text, marginTop: 12 }]}>{k.title}</Text>
              <Text style={[font.small, { color: t.muted }]} numberOfLines={2}>
                {k.sub}
              </Text>
            </PressableScale>
          </Animated.View>
        ))}
      </View>

      <Section title={tr.add_.oneTap}>
        <Text style={[font.small, { color: t.muted, marginTop: -6, marginBottom: 12 }]}>{tr.add_.oneTapSub}</Text>
        <View style={styles.filters}>
          {(['all', 'amal', 'reminder', 'routine', 'water'] as const).map((f) => (
            <Chip key={f} label={tr.add_.filters[f]} active={filter === f} onPress={() => setFilter(f)} />
          ))}
        </View>
        {list.map((tpl, i) => {
          const added = isTemplateAdded(tpl);
          return (
            <Animated.View key={tpl.id} entering={FadeInDown.delay(i * 30).duration(300)}>
              <Card style={styles.tpl} onPress={added ? () => router.push(templateRoute(tpl) as never) : undefined}>
                <View style={[styles.tplIcon, { backgroundColor: tpl.color + (t.dark ? '33' : '1F') }]}>
                  <Ionicons name={tpl.icon as IconName} size={22} color={tpl.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{tpl.title[lang]}</Text>
                  <Text style={[font.small, { color: t.muted }]}>{tpl.sub[lang]}</Text>
                </View>
                {added ? (
                  <Animated.View entering={ZoomIn.springify()} style={[styles.addBtn, { backgroundColor: t.successSoft }]}>
                    <Ionicons name="checkmark" size={20} color={t.success} />
                  </Animated.View>
                ) : (
                  <PressableScale
                    scaleTo={0.85}
                    onPress={() => {
                      applyTemplate(tpl);
                      haptic.success();
                      toast(tr.add_.added(tpl.title[lang]), 'checkmark-circle');
                    }}
                    style={[styles.addBtn, { backgroundColor: t.ink }]}
                    accessibilityLabel={`${tr.add} ${tpl.title[lang]}`}
                  >
                    <Ionicons name="add" size={22} color={t.onInk} />
                  </PressableScale>
                )}
              </Card>
            </Animated.View>
          );
        })}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginTop: 18 },
  cell: { width: '50%', padding: 6 },
  kind: { borderRadius: radius.lg, padding: 16, minHeight: 150 },
  kindIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  tpl: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 10, paddingVertical: 14 },
  tplIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
