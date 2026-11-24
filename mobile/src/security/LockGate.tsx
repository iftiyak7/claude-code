/**
 * Optional biometric/PIN app lock. When enabled, the app content is hidden
 * on launch and whenever it returns from background for > 30 s.
 */
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { Button, Ionicons } from '@/ui/components';
import { font, useTheme } from '@/ui/theme';

const RELOCK_AFTER_MS = 30_000;

export async function canUseBiometrics(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const [hw, enrolled] = await Promise.all([LocalAuthentication.hasHardwareAsync(), LocalAuthentication.isEnrolledAsync()]);
  return hw && enrolled;
}

export async function authenticate(prompt: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const r = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false });
  return r.success;
}

export function LockGate({ children }: { children: React.ReactNode }) {
  const enabled = useData((s) => s.settings.appLock);
  // Locked at launch; enabling the lock later doesn't lock the current session.
  const [locked, setLocked] = useState(true);
  const bgAt = useRef<number | null>(null);
  const t = useTheme();
  const tr = useT();
  const isLocked = enabled && locked;

  const unlock = useCallback(async () => {
    if (await authenticate(tr.unlock)) setLocked(false);
  }, [tr.unlock]);

  useEffect(() => {
    if (!enabled) return;
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'background') bgAt.current = Date.now();
      if (st === 'active' && bgAt.current && Date.now() - bgAt.current > RELOCK_AFTER_MS) setLocked(true);
    });
    return () => sub.remove();
  }, [enabled]);

  // prompt automatically whenever we become locked
  useEffect(() => {
    if (!isLocked) return;
    let cancelled = false;
    authenticate(tr.unlock).then((ok) => {
      if (ok && !cancelled) setLocked(false);
    });
    return () => {
      cancelled = true;
    };
  }, [isLocked, tr.unlock]);

  if (!isLocked) return <>{children}</>;
  return (
    <View style={[StyleSheet.absoluteFill, styles.wrap, { backgroundColor: t.bg }]}>
      <View style={[styles.icon, { backgroundColor: t.primarySoft }]}>
        <Ionicons name="lock-closed" size={36} color={t.primary} />
      </View>
      <Text style={[font.h2, { color: t.text, marginTop: 20, textAlign: 'center' }]}>{tr.locked}</Text>
      <Button label={tr.unlock} icon="finger-print" onPress={unlock} style={{ marginTop: 28, minWidth: 200 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  icon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
});
