import Constants from 'expo-constants';
import * as Location from 'expo-location';
import React, { useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { Text } from '@/ui/Text';
import { DEFAULT_LOCATION } from '@/domain/prayer';
import type { Settings } from '@/domain/types';
import { FormCard } from '@/features/forms';
import { useNum, useT } from '@/i18n';
import { requestNotificationPermission, reschedule } from '@/notifications/scheduler';
import { authenticate, canUseBiometrics } from '@/security/LockGate';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { Button, Chip, Field, IconBadge, Row, Screen, Segmented, ToggleRow } from '@/ui/components';
import { font, useTheme } from '@/ui/theme';

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
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      let label: string | undefined;
      try {
        const [place] = await Location.reverseGeocodeAsync(pos.coords);
        label = place?.city ?? place?.subregion ?? place?.region ?? undefined;
      } catch {
        /* offline — keep coordinates only */
      }
      update({ location: { lat: pos.coords.latitude, lng: pos.coords.longitude, label } });
    } finally {
      setLocBusy(false);
    }
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
          <Button
            kind="soft"
            icon="notifications-outline"
            label={`${tr.notifications} · ${tr.enable}`}
            onPress={async () => {
              if (await requestNotificationPermission()) void reschedule();
            }}
          />
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
