import React, { useState } from 'react';
import { Alert, Platform, Text } from 'react-native';
import { FormCard } from '@/features/forms';
import { useNum, useT } from '@/i18n';
import { useData } from '@/store/data';
import { ApiError } from '@/sync/api';
import { deleteAccount, login, logout, register, syncNow, useSync } from '@/sync/engine';
import { Button, Field, Ionicons, Row, Screen, Segmented } from '@/ui/components';
import { font, useTheme } from '@/ui/theme';

const ERRORS: Record<string, { bn: string; en: string }> = {
  invalid_credentials: { bn: 'ইমেইল বা পাসওয়ার্ড ভুল', en: 'Wrong email or password' },
  email_taken: { bn: 'এই ইমেইলে আগেই অ্যাকাউন্ট আছে', en: 'An account with this email exists' },
  validation_error: { bn: 'তথ্য সঠিক নয় (পাসওয়ার্ড কমপক্ষে ৮ অক্ষর)', en: 'Invalid input (password ≥ 8 chars)' },
  rate_limited: { bn: 'অনেকবার চেষ্টা হয়েছে, একটু পরে আবার চেষ্টা করুন', en: 'Too many attempts, try later' },
  network: { bn: 'ইন্টারনেট সংযোগ নেই — অ্যাপ অফলাইনে ঠিকমতো চলবে', en: 'No connection — the app keeps working offline' },
};

export default function Account() {
  const tr = useT();
  const t = useTheme();
  const n = useNum();
  const sync = useSync();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const lang = useData((x) => x.settings.language);

  const submit = async () => {
    setError(undefined);
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || password.length < 8) {
      setError(ERRORS.validation_error[lang]);
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await register(email, password, name);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'network';
      setError((ERRORS[code] ?? ERRORS.network)[lang]);
    } finally {
      setBusy(false);
    }
  };

  if (sync.user) {
    return (
      <Screen title={tr.account} back>
        <FormCard>
          <Row>
            <Ionicons name="person-circle" size={40} color={t.primary} />
            <Text style={[font.body, { color: t.text, flex: 1 }]}>{sync.user.email}</Text>
          </Row>
          <Text style={[font.small, { color: t.muted }]}>
            {tr.lastSync}: {sync.lastSync ? n(new Date(sync.lastSync).toLocaleString()) : tr.never}
            {sync.status === 'offline' ? ` · ${tr.offline}` : ''}
          </Text>
          <Button icon="sync" label={sync.status === 'syncing' ? '…' : tr.syncNow} onPress={() => void syncNow()} disabled={sync.status === 'syncing'} />
          <Button kind="ghost" icon="log-out-outline" label={tr.logout} onPress={() => void logout()} />
          <Button
            kind="danger"
            icon="trash-outline"
            label={tr.deleteAccount}
            onPress={() => {
              const run = () => void deleteAccount().catch(() => Alert.alert(tr.offline));
              if (Platform.OS === 'web') return run();
              Alert.alert(tr.deleteAccount, tr.deleteAccountHint, [
                { text: tr.cancel, style: 'cancel' },
                { text: tr.delete, style: 'destructive', onPress: run },
              ]);
            }}
          />
        </FormCard>
        <Text style={[font.small, { color: t.muted }]}>{tr.privateNote}</Text>
      </Screen>
    );
  }

  return (
    <Screen title={tr.account} subtitle={tr.accountHint} back>
      <Segmented value={mode} onChange={setMode} options={[{ value: 'login', label: tr.login }, { value: 'register', label: tr.register }]} />
      <Text style={{ height: 16 }} />
      {mode === 'register' && <Field label={tr.name} value={name} onChangeText={setName} autoComplete="name" />}
      <Field label={tr.email} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field label={tr.password} value={password} onChangeText={setPassword} secureTextEntry autoComplete={mode === 'login' ? 'password' : 'new-password'} />
      {error ? <Text style={[font.small, { color: t.danger, marginBottom: 12 }]}>{error}</Text> : null}
      <Button label={busy ? '…' : mode === 'login' ? tr.login : tr.register} onPress={submit} disabled={busy} />
    </Screen>
  );
}
