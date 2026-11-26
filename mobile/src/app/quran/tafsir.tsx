/** Tafsir Ibn Kathir (Bangla) for one passage, with the ayat it explains. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNum, useT } from '@/i18n';
import { arabicStyle, ayahSpans } from '@/quran/ArabicAyah';
import { ensureFont, loadSurah, loadTranslation, SURAHS, type Ayah } from '@/quran/data';
import { loadTafsir, type TafsirPassage } from '@/quran/tafsir';
import { useSettings } from '@/store/hooks';
import { Button, IconButton } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

interface Loaded {
  key: string;
  passages: TafsirPassage[];
  ayat: Ayah[];
  trans: string[];
}

export default function TafsirScreen() {
  const params = useLocalSearchParams<{ surah: string; ayah: string }>();
  const surah = Math.min(114, Math.max(1, Number(params.surah) || 1));
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const lang = s.language;
  const meta = SURAHS[surah - 1];
  const [ayah, setAyah] = useState(Math.max(1, Number(params.ayah) || 1));
  const [data, setData] = useState<Loaded | null>(null);
  const key = `${surah}|${s.quran.translation}`;

  useEffect(() => {
    let alive = true;
    const tId = s.quran.translation === 'none' ? 'zakaria' : s.quran.translation;
    void Promise.all([ensureFont('hafs'), loadTafsir(surah), loadSurah(surah, 'hafs'), loadTranslation(tId, surah)]).then(([, passages, ayat, trans]) => {
      if (alive) setData({ key, passages, ayat, trans });
    });
    return () => {
      alive = false;
    };
  }, [surah, key, s.quran.translation]);

  const ready = data?.key === key ? data : null;
  const idx = ready ? ready.passages.findIndex((p) => p.from <= ayah && ayah <= p.to) : -1;
  const passage = ready && idx >= 0 ? ready.passages[idx] : null;
  const ink = t.text;

  const go = (d: -1 | 1) => {
    if (!ready || idx < 0) return;
    const next = ready.passages[idx + d];
    if (!next) return;
    haptic.tap();
    setAyah(next.from);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + 10, borderBottomColor: t.border }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/quran'))} />
        <View style={{ flex: 1 }}>
          <Text style={[font.h3, { color: t.text }]}>{tr.quran.tafsirTitle}</Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>
            {lang === 'bn' ? meta.bn : meta.en} · {passage ? tr.quran.tafsirRange(n(passage.from), n(passage.to)) : ''}
          </Text>
        </View>
      </View>
      {!passage || !ready ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      ) : (
        <ScrollView key={passage.from} contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 120 }}>
          <Animated.View entering={FadeIn.duration(280)} style={[styles.ayatCard, { backgroundColor: t.surface, borderColor: t.border }]}>
            {ready.ayat
              .filter((a) => a.ayah >= passage.from && a.ayah <= passage.to)
              .map((a) => (
                <View key={a.ayah} style={{ marginBottom: 10 }}>
                  <RNText style={[arabicStyle('hafs', 24, ink), { textAlign: 'right' }]}>{ayahSpans(a, 'hafs', ink, 24, t.primary)}</RNText>
                  {ready.trans[a.ayah - 1] ? (
                    <Text style={[font.small, { color: t.muted, lineHeight: 22, marginTop: 4 }]}>
                      {n(a.ayah)}. {ready.trans[a.ayah - 1]}
                    </Text>
                  ) : null}
                </View>
              ))}
          </Animated.View>
          {passage.paragraphs.map((p, i) => (
            <Animated.View key={i} entering={i < 6 ? FadeInDown.delay(80 + i * 40).duration(320) : undefined}>
              <Text style={[styles.para, { color: t.text }]}>{p}</Text>
            </Animated.View>
          ))}
          <Text style={[font.tiny, { color: t.faint, marginTop: 18, lineHeight: 18, fontWeight: '500' }]}>{tr.quran.tafsirSource}</Text>
        </ScrollView>
      )}
      {passage && ready && (
        <View style={[styles.nav, { paddingBottom: insets.bottom + 12, backgroundColor: t.bg, borderTopColor: t.border }]}>
          <View style={{ flex: 1 }}>
            <Button kind="soft" icon="chevron-back" label={tr.quran.prevPassage} onPress={() => go(-1)} disabled={idx <= 0} />
          </View>
          <View style={{ flex: 1 }}>
            <Button icon="chevron-forward" label={tr.quran.nextPassage} onPress={() => go(1)} disabled={idx >= ready.passages.length - 1} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ayatCard: { borderRadius: radius.lg, borderWidth: 1, padding: 16, marginBottom: 16 },
  para: { fontSize: 16.5, lineHeight: 30, marginBottom: 14 },
  nav: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
