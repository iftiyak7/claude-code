/** Pick a mushaf style. Every style is already inside the app — no downloads. */
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import type { MushafId } from '@/domain/types';
import { useT } from '@/i18n';
import { arabicStyle, ayahSpans } from '@/quran/ArabicAyah';
import { ensureFont, loadSurah, MUSHAFS, type Ayah } from '@/quran/data';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { Button, Card, Ionicons, Screen } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

function Preview({ id }: { id: MushafId }) {
  const t = useTheme();
  const [ayat, setAyat] = useState<Ayah[] | null>(null);
  useEffect(() => {
    let alive = true;
    // Surah al-Ikhlas — short and recognisable in every style
    void Promise.all([ensureFont(id), loadSurah(112, id)]).then(([, a]) => alive && setAyat(a));
    return () => {
      alive = false;
    };
  }, [id]);
  const ink = t.dark ? '#EDE6DA' : '#1E1B16';
  return (
    <View style={[styles.preview, { backgroundColor: t.dark ? '#1B1A20' : '#FFFCF5', borderColor: t.border }]}>
      {ayat ? (
        <RNText style={[arabicStyle(id, 22, ink), { textAlign: 'center' }]}>
          {ayat.map((a) => (
            <RNText key={a.ayah}>{ayahSpans(a, id, ink, 22, t.primary)} </RNText>
          ))}
        </RNText>
      ) : (
        <View style={{ height: 120 }} />
      )}
    </View>
  );
}

export default function MushafStyles() {
  const t = useTheme();
  const tr = useT();
  const s = useSettings();
  const lang = s.language;

  return (
    <Screen title={tr.quran.styles} subtitle={tr.quran.stylesSub} back>
      {MUSHAFS.map((m, i) => {
        const on = s.quran.mushaf === m.id;
        return (
          <Animated.View key={m.id} entering={FadeInDown.delay(i * 60).duration(350)}>
            <Card style={[styles.card, on && { borderColor: t.primary, borderWidth: 2 }]}>
              <Preview id={m.id} />
              <Text style={[font.h3, { color: t.text, marginTop: 14 }]}>{m.title[lang]}</Text>
              <Text style={[font.small, { color: t.muted, marginTop: 4, lineHeight: 21 }]}>{m.desc[lang]}</Text>
              <View style={styles.row}>
                <View style={[styles.badge, { backgroundColor: t.successSoft }]}>
                  <Ionicons name="checkmark-circle" size={14} color={t.success} />
                  <Text style={[font.tiny, { color: t.success }]}>{tr.quran.inApp}</Text>
                </View>
                {on ? (
                  <View style={[styles.badge, { backgroundColor: t.primary }]}>
                    <Text style={[font.tiny, { color: '#fff' }]}>{tr.quran.selected}</Text>
                  </View>
                ) : (
                  <Button
                    small
                    label={tr.quran.choose}
                    onPress={() => {
                      haptic.success();
                      useData.getState().updateSettings({ quran: { ...useData.getState().settings.quran, mushaf: m.id } });
                      router.back();
                    }}
                  />
                )}
              </View>
            </Card>
          </Animated.View>
        );
      })}
      <Text style={[font.small, { color: t.faint, marginTop: 8, lineHeight: 20 }]}>{tr.quran.sources}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 14 },
  preview: { borderRadius: radius.md, borderWidth: 1, padding: 14 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
});
