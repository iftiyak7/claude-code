import Constants from 'expo-constants';
import React, { useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, View } from 'react-native';
import Animated, { FadeIn, LinearTransition, ZoomIn } from 'react-native-reanimated';
import { Text } from '@/ui/Text';
import { DEFAULT_LOCATION } from '@/domain/prayer';
import type { Settings } from '@/domain/types';
import { FormCard } from '@/features/forms';
import { locateMe } from '@/features/location';
import { useNum, useT } from '@/i18n';
import { router } from 'expo-router';
import { authenticate, canUseBiometrics } from '@/security/LockGate';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { Button, Chip, Field, IconBadge, Ionicons, PressableScale, Row, Screen, Segmented, ToggleRow } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

const METHODS: Settings['calcMethod'][] = ['Karachi', 'MuslimWorldLeague', 'UmmAlQura', 'Egyptian', 'Dubai', 'Qatar', 'Singapore', 'Turkey', 'NorthAmerica'];

export default function SettingsScreen() {
  const tr = useT();
  const t = useTheme();
  const n = useNum();
  const s = useSettings();
  const update = useData((x) => x.updateSettings);
  const [locBusy, setLocBusy] = useState(false);
  const [name, setName] = useState(s.name);

  const useMyLocation = async () => {
    setLocBusy(true);
    await locateMe();
    setLocBusy(false);
  };

  const toggleLock = async (on: boolean) => {
    if (on) {
      if (!(await canUseBiometrics())) {
        Alert.alert(tr.appLock, '—');
        return;
      }
      if (!(await authenticate(tr.appLock))) return;
    }
    update({ appLock: on });
  };

  const loc = s.location ?? DEFAULT_LOCATION;

  return (
    <Screen title={tr.settings} back>
      {Platform.OS !== 'web' && <MuteAllCard />}

      <Field label={tr.yourName} value={name} onChangeText={setName} onBlur={() => update({ name: name.trim() })} onSubmitEditing={() => update({ name: name.trim() })} />

      <FormCard label={tr.language} bare>
        <Segmented value={s.language} onChange={(language) => update({ language })} options={[{ value: 'bn', label: 'বাংলা' }, { value: 'en', label: 'English' }]} />
      </FormCard>

      <FormCard label={tr.theme} bare>
        <Segmented
          value={s.theme}
          onChange={(theme) => update({ theme })}
          options={(['system', 'light', 'dark'] as const).map((v) => ({ value: v, label: tr.themes[v] }))}
        />
      </FormCard>

      <FormCard label={tr.location}>
        <Row gap={10}>
          <IconBadge icon="location" color={t.primary} bg={t.primarySoft} size={36} />
          <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{loc.label ?? `${n(loc.lat.toFixed(3))}, ${n(loc.lng.toFixed(3))}`}</Text>
        </Row>
        {Platform.OS !== 'web' && <Button kind="soft" icon="locate" label={tr.useMyLocation} onPress={useMyLocation} disabled={locBusy} />}
        <Text style={[font.small, { color: t.muted }]}>{tr.calcMethod}</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {METHODS.map((m) => (
            <Chip key={m} label={m} active={s.calcMethod === m} onPress={() => update({ calcMethod: m })} />
          ))}
        </View>
        <Text style={[font.small, { color: t.muted }]}>{tr.madhab}</Text>
        <Segmented value={s.madhab} onChange={(madhab) => update({ madhab })} options={[{ value: 'hanafi', label: 'Hanafi' }, { value: 'shafi', label: "Shafi'i / Maliki / Hanbali" }]} />
      </FormCard>

      <FormCard label={tr.notifications}>
        {Platform.OS !== 'web' && (
          <Button kind="soft" icon="alarm-outline" label={tr.setup.title} onPress={() => router.push('/setup')} />
        )}
        <ToggleRow icon="phone-portrait-outline" label={tr.haptics} value={s.haptics} onChange={(haptics) => update({ haptics })} />
      </FormCard>

      {Platform.OS !== 'web' && (
        <FormCard label={tr.security}>
          <ToggleRow icon="finger-print" label={tr.appLock} value={s.appLock} onChange={toggleLock} />
        </FormCard>
      )}

      <Text style={[font.small, { color: t.faint, textAlign: 'center', marginTop: 8 }]}>
        {tr.appName} · {tr.version} {Constants.expoConfig?.version ?? '1.0.0'}
      </Text>
    </Screen>
  );
}

/** One tap silences every notification, alarm and vibration in the app. */
function MuteAllCard() {
  const t = useTheme();
  const tr = useT();
  const muted = useSettings().muteAll;
  const toggle = () => {
    const next = !muted;
    if (!next) haptic.success(); // feedback only when turning things back on
    useData.getState().updateSettings({ muteAll: next });
    toast(next ? tr.mute.turnedOff : tr.mute.turnedOn, next ? 'notifications-off' : 'notifications');
  };
  return (
    <Animated.View layout={LinearTransition.springify().damping(18)}>
      <PressableScale
        onPress={toggle}
        scaleTo={0.97}
        accessibilityRole="switch"
        accessibilityState={{ checked: muted }}
        accessibilityLabel={tr.mute.title}
        style={[styles.mute, { backgroundColor: muted ? t.hero : t.surface, borderColor: muted ? t.hero : t.border }]}
      >
        <Animated.View key={String(muted)} entering={ZoomIn.springify().damping(12)} style={[styles.muteIcon, { backgroundColor: muted ? t.primary : t.primarySoft }]}>
          <Ionicons name={muted ? 'notifications-off' : 'notifications'} size={24} color={muted ? '#fff' : t.primary} />
        </Animated.View>
        <Animated.View key={`txt${muted}`} entering={FadeIn.duration(250)} style={{ flex: 1 }}>
          <Text style={[font.h3, { color: muted ? '#fff' : t.text }]}>{muted ? tr.mute.onTitle : tr.mute.title}</Text>
          <Text style={[font.small, { color: muted ? 'rgba(255,255,255,0.72)' : t.muted, marginTop: 3, lineHeight: 20 }]}>{muted ? tr.mute.onHint : tr.mute.offHint}</Text>
        </Animated.View>
        <Switch
          value={muted}
          onValueChange={toggle}
          trackColor={{ true: t.primary, false: t.surface2 }}
          thumbColor="#fff"
          ios_backgroundColor={t.surface2}
        />
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  mute: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, borderWidth: 1, marginBottom: 16 },
  muteIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});
