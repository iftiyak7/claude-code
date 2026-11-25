import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useT } from '@/i18n';
import { useData } from '@/store/data';
import { checkAnnouncements, markInboxRead, useInbox } from '@/notifications/announcements';
import { Card, EmptyState, Ionicons, Screen } from '@/ui/components';
import { Text } from '@/ui/Text';
import { font, useTheme } from '@/ui/theme';

function ago(iso: string, lang: 'bn' | 'en') {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  const bn = (x: number) => String(x).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
  if (lang === 'en') return m < 60 ? `${Math.max(1, m)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
  return m < 60 ? `${bn(Math.max(1, m))} মিনিট আগে` : m < 1440 ? `${bn(Math.round(m / 60))} ঘণ্টা আগে` : `${bn(Math.round(m / 1440))} দিন আগে`;
}

export default function Inbox() {
  const t = useTheme();
  const tr = useT();
  const lang = useData((s) => s.settings.language);
  const { items, readAt } = useInbox();

  useEffect(() => {
    void checkAnnouncements();
    return () => markInboxRead();
  }, []);

  return (
    <Screen title={tr.inbox.title} back>
      {items.length === 0 ? (
        <EmptyState icon="notifications-outline" text={tr.inbox.empty} />
      ) : (
        <View style={{ marginTop: 16 }}>
          {items.map((a, i) => {
            const unread = new Date(a.createdAt).getTime() > readAt;
            const open = a.url
              ? () => (a.url.startsWith('https://') ? void Linking.openURL(a.url) : router.push(a.url as never))
              : undefined;
            return (
              <Animated.View key={a.id} entering={FadeInDown.delay(i * 40).duration(300)}>
                <Card style={styles.row} onPress={open}>
                  <View style={[styles.icon, { backgroundColor: unread ? t.primary : t.primarySoft }]}>
                    <Ionicons name="megaphone" size={18} color={unread ? '#fff' : t.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text, fontWeight: '700' }]}>{a.title}</Text>
                    {a.body ? <Text style={[font.small, { color: t.muted, marginTop: 2 }]}>{a.body}</Text> : null}
                    <Text style={[font.tiny, { color: t.faint, marginTop: 6, fontWeight: '500' }]}>{ago(a.createdAt, lang)}</Text>
                  </View>
                  {open && <Ionicons name="chevron-forward" size={18} color={t.faint} />}
                </Card>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 10 },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
});
