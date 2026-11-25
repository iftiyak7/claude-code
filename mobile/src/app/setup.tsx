import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useNum, useT } from '@/i18n';
import { allGranted, getSetupStatus, requestSetupItem, SETUP_ITEMS, type SetupItem, type SetupStatus } from '@/permissions/reminderSetup';
import { Button, Card, Ionicons, Screen, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

const ICON: Record<SetupItem, IconName> = { notifications: 'notifications', exactAlarm: 'alarm', battery: 'battery-charging' };

export default function ReminderSetup() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState<SetupItem | null>(null);

  const refresh = useCallback(() => getSetupStatus().then(setStatus), []);

  useEffect(() => {
    void refresh();
    // the user comes back from a system screen → re-check
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void refresh());
    return () => sub.remove();
  }, [refresh]);

  const ask = async (item: SetupItem) => {
    setBusy(item);
    try {
      await requestSetupItem(item);
    } finally {
      setBusy(null);
      const s = await getSetupStatus();
      setStatus(s);
      if (s[item]) haptic.success();
    }
  };

  const done = status ? allGranted(status) : false;
  const colors: Record<SetupItem, [string, string]> = {
    notifications: [t.primary, t.primarySoft],
    exactAlarm: [t.lavenderInk, t.lavenderSoft],
    battery: [t.success, t.successSoft],
  };

  return (
    <Screen title={tr.setup.title} subtitle={tr.setup.subtitle} back>
      {SETUP_ITEMS.map((item, i) => {
        const ok = status?.[item];
        const [fg, bg] = colors[item];
        return (
          <Animated.View key={item} entering={FadeInDown.delay(i * 70).duration(380)}>
            <Card style={styles.card}>
              <View style={styles.row}>
                <View style={[styles.icon, { backgroundColor: bg }]}>
                  <Ionicons name={ICON[item]} size={24} color={fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[font.tiny, { color: t.muted }]}>
                    {tr.setup.step} {n(i + 1)}
                  </Text>
                  <Text style={[font.h3, { color: t.text }]}>{tr.setup[item].title}</Text>
                </View>
                {ok && (
                  <Animated.View entering={ZoomIn.springify()} style={[styles.check, { backgroundColor: t.success }]}>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </Animated.View>
                )}
              </View>
              <Text style={[font.small, { color: t.muted, marginTop: 10 }]}>{tr.setup[item].body}</Text>
              {ok === false && (
                <Button
                  label={busy === item ? '…' : tr.setup.allow}
                  icon="hand-left-outline"
                  kind="accent"
                  small
                  disabled={busy !== null}
                  onPress={() => void ask(item)}
                  style={{ marginTop: 14, alignSelf: 'flex-start' }}
                />
              )}
              {ok && <Text style={[font.small, { color: t.success, marginTop: 10, fontWeight: '600' }]}>{tr.setup.enabled}</Text>}
            </Card>
          </Animated.View>
        );
      })}

      <View style={{ marginTop: 8, gap: 10 }}>
        <Button label={done ? tr.setup.done : tr.setup.later} kind={done ? 'primary' : 'ghost'} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      {done && (
        <Animated.View entering={FadeInDown} style={[styles.allSet, { backgroundColor: t.successSoft }]}>
          <Ionicons name="shield-checkmark" size={20} color={t.success} />
          <Text style={[font.small, { color: t.text, flex: 1 }]}>{tr.setup.allSet}</Text>
        </Animated.View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  check: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  allSet: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, marginTop: 14 },
});
