import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNum, useT } from '@/i18n';
import { JUZ, mushafInfo, SURAHS, type SurahMeta } from '@/quran/data';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { Blob, Card, IconButton, Ionicons, Khatam, PressableScale, Segmented, TextInput } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

type Tab = 'surah' | 'juz' | 'bookmarks';

export default function QuranHome() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const q = s.quran;
  const lang = s.language;
  const [tab, setTab] = useState<Tab>('surah');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const k = query.trim().toLowerCase();
    if (!k) return SURAHS;
    return SURAHS.filter((x) => String(x.n) === k || x.bn.includes(query.trim()) || x.en.toLowerCase().includes(k) || x.ar.includes(query.trim()) || x.mean.includes(query.trim()));
  }, [query]);

  const last = q.lastRead;
  const lastSurah = last ? SURAHS[last.surah - 1] : null;
  const open = (surah: number, ayah?: number) => {
    haptic.tap();
    router.push(`/quran/${surah}${ayah ? `?ayah=${ayah}` : ''}` as never);
  };

  const header = (
    <View>
      <View style={[styles.top, { paddingTop: insets.top + 14 }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <View style={{ flex: 1 }} />
        <IconButton icon="book-outline" onPress={() => router.push('/quran/styles')} label={tr.quran.styles} />
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <Text style={[font.display, { color: t.text, marginTop: 10 }]}>{tr.quran.title}</Text>

        {/* continue reading */}
        <PressableScale onPress={() => open(last?.surah ?? 1, last?.ayah)} style={[styles.continue, { backgroundColor: t.hero }]}>
          <View style={styles.continueOrn} pointerEvents="none">
            <Khatam size={150} color="rgba(255,255,255,0.06)" />
          </View>
          <Text style={[font.small, { color: '#FFB48A' }]}>{last ? tr.quran.continue : tr.quran.start}</Text>
          <Text style={[font.h2, { color: '#fff', marginTop: 4 }]}>{lastSurah ? lastSurah[lang === 'bn' ? 'bn' : 'en'] : tr.quran.fatiha}</Text>
          <Text style={[font.small, { color: 'rgba(255,255,255,0.7)' }]}>
            {lastSurah ? `${tr.quran.ayah} ${n(last!.ayah)} · ${tr.quran.page} ${n(last!.page ?? lastSurah.page)}` : tr.quran.startHint}
          </Text>
          <View style={styles.continueRow}>
            <View style={[styles.mushafPill, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
              <Ionicons name="book" size={13} color="#fff" />
              <Text style={[font.tiny, { color: '#fff' }]}>{mushafInfo(q.mushaf).title[lang]}</Text>
            </View>
            <View style={[styles.go, { backgroundColor: t.primary }]}>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </View>
          </View>
        </PressableScale>

        <View style={{ marginTop: 18 }}>
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'surah', label: tr.quran.surah },
              { value: 'juz', label: tr.quran.juz },
              { value: 'bookmarks', label: tr.quran.bookmarks },
            ]}
          />
        </View>
        {tab === 'surah' && (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={tr.quran.search}
            placeholderTextColor={t.faint}
            style={[styles.search, { backgroundColor: t.surface, color: t.text, borderColor: t.border }]}
          />
        )}
      </View>
    </View>
  );

  if (tab === 'juz') {
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Blob size={280} />
        <FlatList
          data={JUZ}
          keyExtractor={(_, i) => `j${i}`}
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          renderItem={({ item, index }) => {
            const sm = SURAHS[item[0] - 1];
            return (
              <Pressable onPress={() => open(item[0], item[1])} style={styles.rowWrap}>
                <Card style={styles.row}>
                  <Medal n={index + 1} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>
                      {tr.quran.juz} {n(index + 1)}
                    </Text>
                    <Text style={[font.small, { color: t.muted }]}>
                      {sm[lang === 'bn' ? 'bn' : 'en']} {n(item[1])} · {tr.quran.page} {n(item[2])}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.faint} />
                </Card>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  if (tab === 'bookmarks') {
    const bm = q.bookmarks.map((k) => k.split(':').map(Number) as [number, number]);
    return (
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        <Blob size={280} />
        <FlatList
          data={bm}
          keyExtractor={(x) => x.join(':')}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={[font.body, { color: t.muted, textAlign: 'center', padding: 40 }]}>{tr.quran.noBookmarks}</Text>}
          contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
          renderItem={({ item }) => {
            const sm = SURAHS[item[0] - 1];
            return (
              <Pressable onPress={() => open(item[0], item[1])} style={styles.rowWrap}>
                <Card style={styles.row}>
                  <Ionicons name="bookmark" size={22} color={t.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{sm[lang === 'bn' ? 'bn' : 'en']}</Text>
                    <Text style={[font.small, { color: t.muted }]}>
                      {tr.quran.ayah} {n(item[1])}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={t.faint} />
                </Card>
              </Pressable>
            );
          }}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <Blob size={280} />
      <FlatList
        data={list}
        keyExtractor={(x) => String(x.n)}
        ListHeaderComponent={header}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={14}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        renderItem={({ item, index }) => <SurahRow s={item} index={index} onPress={() => open(item.n)} />}
      />
    </View>
  );
}

function Medal({ n: num }: { n: number }) {
  const t = useTheme();
  const n = useNum();
  return (
    <View style={styles.medal}>
      <Khatam size={44} color={t.primarySoft} />
      <Text style={[font.small, styles.medalText, { color: t.primaryDeep }]}>{n(num)}</Text>
    </View>
  );
}

const SurahRow = React.memo(function SurahRow({ s, index, onPress }: { s: SurahMeta; index: number; onPress: () => void }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const lang = useData((x) => x.settings.language);
  return (
    <Animated.View entering={index < 12 ? FadeInDown.delay(index * 25).duration(300) : undefined}>
      <Pressable onPress={onPress} style={styles.rowWrap} accessibilityRole="button">
        <Card style={styles.row}>
          <Medal n={s.n} />
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{lang === 'bn' ? s.bn : s.en}</Text>
            <Text style={[font.small, { color: t.muted }]} numberOfLines={1}>
              {lang === 'bn' ? s.mean : s.en} · {s.type === 'm' ? tr.quran.makki : tr.quran.madani} · {n(s.ayahs)} {tr.quran.ayahs}
            </Text>
          </View>
          <Text style={[styles.ar, { color: t.text }]}>{s.ar}</Text>
        </Card>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20 },
  continue: { borderRadius: radius.xl, padding: 20, marginTop: 16, overflow: 'hidden' },
  continueOrn: { position: 'absolute', right: -30, top: -30 },
  continueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  mushafPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  go: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  search: { marginTop: 12, borderWidth: 1.5, borderRadius: radius.pill, paddingHorizontal: 18, paddingVertical: 12, fontSize: 16 },
  rowWrap: { paddingHorizontal: 20, marginTop: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  medal: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  medalText: { position: 'absolute', fontWeight: '700' },
  ar: { fontFamily: 'Amiri_700Bold', fontSize: 22 },
});
