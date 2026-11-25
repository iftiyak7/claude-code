/**
 * First-run setup wizard: name & language → city (prayer times) → pick what
 * to track → reminder permissions. Everything is pre-filled with good
 * defaults, so a brand-new user can just keep tapping "পরের ধাপ".
 */
import * as Location from 'expo-location';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInRight, useAnimatedStyle, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TEMPLATES } from '@/domain/templates';
import { applyTemplate } from '@/features/templates';
import { useNum, useT } from '@/i18n';
import { getSetupStatus, requestSetupItem, SETUP_ITEMS, type SetupItem, type SetupStatus } from '@/permissions/reminderSetup';
import { useData } from '@/store/data';
import { Blob, Button, Chip, Field, Ionicons, Khatam, Segmented, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

const CITIES: { bn: string; en: string; lat: number; lng: number }[] = [
  { bn: 'ঢাকা', en: 'Dhaka', lat: 23.8103, lng: 90.4125 },
  { bn: 'চট্টগ্রাম', en: 'Chattogram', lat: 22.3569, lng: 91.7832 },
  { bn: 'খুলনা', en: 'Khulna', lat: 22.8456, lng: 89.5403 },
  { bn: 'রাজশাহী', en: 'Rajshahi', lat: 24.3745, lng: 88.6042 },
  { bn: 'সিলেট', en: 'Sylhet', lat: 24.8949, lng: 91.8687 },
  { bn: 'বরিশাল', en: 'Barishal', lat: 22.701, lng: 90.3535 },
  { bn: 'রংপুর', en: 'Rangpur', lat: 25.7439, lng: 89.2752 },
  { bn: 'ময়মনসিংহ', en: 'Mymensingh', lat: 24.7471, lng: 90.4203 },
  { bn: 'কুমিল্লা', en: 'Cumilla', lat: 23.4607, lng: 91.1809 },
  { bn: 'যশোর', en: 'Jashore', lat: 23.1664, lng: 89.2081 },
  { bn: 'বগুড়া', en: 'Bogura', lat: 24.8481, lng: 89.3730 },
  { bn: 'কক্সবাজার', en: "Cox's Bazar", lat: 21.4272, lng: 92.0058 },
];

const STEPS = 4;
const PERM_ICON: Record<SetupItem, IconName> = { notifications: 'notifications', exactAlarm: 'alarm', battery: 'battery-charging' };

function Progress({ step }: { step: number }) {
  const t = useTheme();
  return (
    <View style={styles.progress}>
      {Array.from({ length: STEPS }, (_, i) => (
        <Dot key={i} on={i <= step} color={t.primary} track={t.surface2} wide={i === step} />
      ))}
    </View>
  );
}
function Dot({ on, wide, color, track }: { on: boolean; wide: boolean; color: string; track: string }) {
  const s = useAnimatedStyle(() => ({ width: withTiming(wide ? 34 : 10, { duration: 250 }), backgroundColor: on ? color : track }), [on, wide, color, track]);
  return <Animated.View style={[styles.dot, s]} />;
}

export default function Welcome() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const settings = useData((s) => s.settings);
  const update = useData((s) => s.updateSettings);
  const lang = settings.language;
  const w = tr.welcome;

  const [step, setStep] = useState(0);
  const [name, setName] = useState(settings.name);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(TEMPLATES.filter((x) => x.suggested).map((x) => x.id)));
  const [locBusy, setLocBusy] = useState(false);
  const [perm, setPerm] = useState<SetupStatus | null>(null);

  useEffect(() => {
    if (step !== 3) return;
    void getSetupStatus().then(setPerm);
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void getSetupStatus().then(setPerm));
    return () => sub.remove();
  }, [step]);

  const loc = settings.location;
  const cityLabel = loc?.label;

  const useGps = async () => {
    setLocBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let label: string | undefined;
      try {
        const [p] = await Location.reverseGeocodeAsync(pos.coords);
        label = p?.city ?? p?.subregion ?? p?.region ?? undefined;
      } catch {
        /* offline */
      }
      update({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude, label: label ?? w.myLocation } });
      haptic.success();
    } finally {
      setLocBusy(false);
    }
  };

  const finish = () => {
    for (const tpl of TEMPLATES) if (picked.has(tpl.id)) applyTemplate(tpl);
    update({ name: name.trim(), onboarded: true });
    haptic.success();
    router.replace('/');
  };

  const next = () => {
    haptic.light();
    if (step === 0) update({ name: name.trim() });
    if (step < STEPS - 1) setStep(step + 1);
    else finish();
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Blob size={300} />
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <Progress step={step} />
        <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
          <Text style={[font.small, { color: t.muted, fontWeight: '600' }]}>{w.skip}</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 30 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Animated.View key={step} entering={FadeInRight.duration(320)}>
          {step === 0 && (
            <>
              <Animated.View entering={ZoomIn.springify().damping(14)} style={[styles.logo, { backgroundColor: t.primary }]}>
                <Text style={styles.logoText}>ت</Text>
              </Animated.View>
              <Text style={[font.small, { color: t.muted, marginTop: 24 }]}>{tr.greet.salam}</Text>
              <Text style={[font.display, { color: t.text, marginTop: 4 }]}>{w.hello}</Text>
              <Text style={[font.body, { color: t.muted, marginTop: 8, lineHeight: 24 }]}>{w.intro}</Text>
              <View style={{ marginTop: 26 }}>
                <Field label={w.nameLabel} value={name} onChangeText={setName} placeholder={w.namePh} autoComplete="name" returnKeyType="next" onSubmitEditing={next} style={{ fontSize: 18 }} />
              </View>
              <Text style={[font.small, { color: t.muted, marginBottom: 8, fontWeight: '600' }]}>{tr.language}</Text>
              <Segmented value={lang} onChange={(language) => update({ language })} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'English' }]} />
            </>
          )}

          {step === 1 && (
            <>
              <StepIcon icon="location" color={t.lavenderInk} bg={t.lavenderSoft} />
              <Text style={[font.h1, { color: t.text, marginTop: 18 }]}>{w.cityTitle}</Text>
              <Text style={[font.body, { color: t.muted, marginTop: 8, lineHeight: 24 }]}>{w.cityIntro}</Text>
              {Platform.OS !== 'web' && (
                <Button kind="soft" icon="locate" label={locBusy ? '…' : w.useGps} onPress={useGps} disabled={locBusy} style={{ marginTop: 22 }} />
              )}
              <Text style={[font.small, { color: t.muted, marginTop: 22, marginBottom: 10, fontWeight: '600' }]}>{w.orPick}</Text>
              <View style={styles.wrap}>
                {CITIES.map((c) => (
                  <Chip
                    key={c.en}
                    label={c[lang]}
                    active={cityLabel === c.bn || cityLabel === c.en}
                    onPress={() => update({ location: { lat: c.lat, lng: c.lng, label: c[lang] } })}
                  />
                ))}
              </View>
              {cityLabel ? (
                <Animated.View entering={FadeIn} style={[styles.note, { backgroundColor: t.successSoft }]}>
                  <Ionicons name="checkmark-circle" size={18} color={t.success} />
                  <Text style={[font.small, { color: t.text, flex: 1 }]}>{w.cityChosen(cityLabel)}</Text>
                </Animated.View>
              ) : null}
            </>
          )}

          {step === 2 && (
            <>
              <StepIcon icon="sparkles" color={t.primary} bg={t.primarySoft} />
              <Text style={[font.h1, { color: t.text, marginTop: 18 }]}>{w.goalsTitle}</Text>
              <Text style={[font.body, { color: t.muted, marginTop: 8, lineHeight: 24 }]}>{w.goalsIntro}</Text>
              <View style={[styles.note, { backgroundColor: t.lavenderSoft, marginTop: 16 }]}>
                <Ionicons name="moon" size={18} color={t.lavenderInk} />
                <Text style={[font.small, { color: t.text, flex: 1 }]}>{w.salahIncluded}</Text>
              </View>
              <View style={{ marginTop: 14, gap: 10 }}>
                {TEMPLATES.map((tpl) => {
                  const on = picked.has(tpl.id);
                  return (
                    <Pressable
                      key={tpl.id}
                      onPress={() => {
                        haptic.tap();
                        setPicked((p) => {
                          const n = new Set(p);
                          if (on) n.delete(tpl.id);
                          else n.add(tpl.id);
                          return n;
                        });
                      }}
                      style={[styles.goal, { backgroundColor: t.surface, borderColor: on ? t.primary : 'transparent' }]}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                    >
                      <View style={[styles.goalIcon, { backgroundColor: tpl.color + (t.dark ? '33' : '1F') }]}>
                        <Ionicons name={tpl.icon as IconName} size={20} color={tpl.color} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{tpl.title[lang]}</Text>
                        <Text style={[font.small, { color: t.muted }]}>{tpl.sub[lang]}</Text>
                      </View>
                      <View style={[styles.check, on ? { backgroundColor: t.primary, borderColor: t.primary } : { borderColor: t.border }]}>
                        {on && <Ionicons name="checkmark" size={16} color="#fff" />}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          {step === 3 && (
            <>
              <StepIcon icon="notifications" color={t.success} bg={t.successSoft} />
              <Text style={[font.h1, { color: t.text, marginTop: 18 }]}>{w.permTitle}</Text>
              <Text style={[font.body, { color: t.muted, marginTop: 8, lineHeight: 24 }]}>{w.permIntro}</Text>
              <View style={{ marginTop: 20, gap: 10 }}>
                {SETUP_ITEMS.map((item) => {
                  const ok = perm?.[item] ?? Platform.OS === 'web';
                  return (
                    <View key={item} style={[styles.goal, { backgroundColor: t.surface, borderColor: 'transparent' }]}>
                      <View style={[styles.goalIcon, { backgroundColor: ok ? t.successSoft : t.primarySoft }]}>
                        <Ionicons name={PERM_ICON[item]} size={20} color={ok ? t.success : t.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{tr.setup[item].title}</Text>
                        <Text style={[font.small, { color: t.muted }]} numberOfLines={3}>
                          {tr.setup[item].body}
                        </Text>
                      </View>
                      {ok ? (
                        <Animated.View entering={ZoomIn.springify()} style={[styles.check, { backgroundColor: t.success, borderColor: t.success }]}>
                          <Ionicons name="checkmark" size={16} color="#fff" />
                        </Animated.View>
                      ) : (
                        <Button
                          small
                          kind="accent"
                          label={tr.setup.allow}
                          onPress={async () => {
                            await requestSetupItem(item);
                            setPerm(await getSetupStatus());
                          }}
                        />
                      )}
                    </View>
                  );
                })}
              </View>
            </>
          )}
        </Animated.View>
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: Math.max(insets.bottom, 16) + 4 }]}>
        {step > 0 ? (
          <Pressable onPress={() => setStep(step - 1)} style={[styles.back, { borderColor: t.border }]} accessibilityRole="button" accessibilityLabel={w.back}>
            <Ionicons name="arrow-back" size={22} color={t.text} />
          </Pressable>
        ) : null}
        <Button
          label={step === STEPS - 1 ? w.finish : step === 2 ? n(w.addN(picked.size)) : w.next}
          icon={step === STEPS - 1 ? 'checkmark' : 'arrow-forward'}
          onPress={next}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

function StepIcon({ icon, color, bg }: { icon: IconName; color: string; bg: string }) {
  return (
    <Animated.View entering={ZoomIn.springify().damping(14)} style={[styles.stepIcon, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={30} color={color} />
      <View style={{ position: 'absolute', right: -6, top: -6 }}>
        <Khatam size={20} color={color} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22 },
  progress: { flexDirection: 'row', gap: 6 },
  dot: { height: 10, borderRadius: 5 },
  logo: { width: 84, height: 84, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  logoText: { color: '#fff', fontSize: 46, fontFamily: 'Amiri_700Bold', lineHeight: 70 },
  stepIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, marginTop: 18 },
  goal: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: 2 },
  goalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  bottom: { flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingTop: 10 },
  back: { width: 54, height: 54, borderRadius: 27, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
