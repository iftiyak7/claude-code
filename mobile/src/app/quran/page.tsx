/**
 * Mushaf page view: swipe right-to-left through the 604 pages, laid out like
 * the printed mushaf (Madani page boundaries; Warsh/Qaloon use their own).
 * Reading a page for 20 s counts it toward today's Qur'an amal.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text as RNText, useWindowDimensions, View, type ListViewToken as ViewToken } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { storage } from '@/db/storage';
import { today } from '@/domain/dates';
import type { MushafId } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { arabicStyle, ayahSpans } from '@/quran/ArabicAyah';
import { BISMILLAH, ensureFont, JUZ, loadPage, mushafInfo, PAGES, surahPage, SURAHS, type Ayah } from '@/quran/data';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { IconButton } from '@/ui/components';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

const PAGE_LIST = Array.from({ length: PAGES }, (_, i) => i + 1);
const QURAN_AMAL = 'seed-quran';
const COUNT_AFTER_MS = 20_000;

function juzOf(page: number) {
  let j = 1;
  for (let i = 0; i < JUZ.length; i++) if (JUZ[i][2] <= page) j = i + 1;
  return j;
}

const MushafPage = memo(function MushafPage({ page, mushaf, width, height }: { page: number; mushaf: MushafId; width: number; height: number }) {
  const t = useTheme();
  const n = useNum();
  const tr = useT();
  const lang = useData((s) => s.settings.language);
  const [ayat, setAyat] = useState<Ayah[] | null>(null);

  useEffect(() => {
    let alive = true;
    void loadPage(page, mushaf).then((a) => alive && setAyat(a));
    return () => {
      alive = false;
    };
  }, [page, mushaf]);

  const ink = t.dark ? '#EDE6DA' : '#1E1B16';
  const paper = t.dark ? '#1B1A20' : '#FFFCF5';
  const first = ayat?.[0];
  const surahName = first ? SURAHS[first.surah - 1] : null;
  // a rough fit: dense pages get a slightly smaller size so the whole page shows
  const chars = ayat?.reduce((s, a) => s + (a.tajweed ? a.tajweed.reduce((x, g) => x + g[0].length, 0) : a.text.length), 0) ?? 600;
  const base = Math.max(17, Math.min(26, Math.sqrt(((width - 60) * (height - 170)) / Math.max(chars, 200)) * 0.62));

  // group consecutive ayat, inserting surah headers where a surah starts
  const blocks: ({ kind: 'head'; surah: number } | { kind: 'text'; ayat: Ayah[] })[] = [];
  for (const a of ayat ?? []) {
    if (a.ayah === 1) blocks.push({ kind: 'head', surah: a.surah });
    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'text') last.ayat.push(a);
    else blocks.push({ kind: 'text', ayat: [a] });
  }

  return (
    <View style={{ width, height, padding: 12 }}>
      <View style={[styles.frame, { backgroundColor: paper, borderColor: t.primary + '55' }]}>
        <View style={[styles.innerFrame, { borderColor: t.primary + '33' }]}>
          <View style={styles.pageHead}>
            <Text style={[font.tiny, { color: t.muted }]}>
              {tr.quran.juz} {n(juzOf(page))}
            </Text>
            <Text style={[font.tiny, { color: t.muted }]}>{surahName ? (lang === 'bn' ? surahName.bn : surahName.en) : ''}</Text>
          </View>
          {!ayat ? (
            <View style={styles.center}>
              <ActivityIndicator color={t.primary} />
            </View>
          ) : (
            <View style={{ flex: 1, justifyContent: 'center' }}>
              {blocks.map((b, i) =>
                b.kind === 'head' ? (
                  <View key={`h${i}`}>
                    <View style={[styles.surahHead, { borderColor: t.primary + '66', backgroundColor: t.primarySoft }]}>
                      <RNText style={{ fontFamily: 'Amiri_700Bold', fontSize: base * 0.95, color: ink, textAlign: 'center' }}>{`سُورَةُ ${SURAHS[b.surah - 1].ar}`}</RNText>
                    </View>
                    {b.surah !== 1 && b.surah !== 9 && mushafInfo(mushaf).riwayah === 'hafs' && (
                      <RNText style={[arabicStyle(mushaf === 'indopak' || mushaf === 'tajweed' ? 'hafs' : mushaf, base, ink), { textAlign: 'center' }]}>{BISMILLAH}</RNText>
                    )}
                  </View>
                ) : (
                  <RNText key={`t${i}`} style={[arabicStyle(mushaf, base, ink), styles.justify]}>
                    {b.ayat.map((a) => (
                      <RNText key={a.ayah}>{ayahSpans(a, mushaf, ink, base, t.primary)} </RNText>
                    ))}
                  </RNText>
                ),
              )}
            </View>
          )}
          <Text style={[font.small, { color: t.muted, textAlign: 'center', marginTop: 4 }]}>{n(page)}</Text>
        </View>
      </View>
    </View>
  );
});

export default function PageReader() {
  const params = useLocalSearchParams<{ surah?: string; page?: string }>();
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const q = useSettings().quran;
  const lang = useData((s) => s.settings.language);
  const listRef = useRef<FlatList<number>>(null);
  const surahParam = Number(params.surah);
  const [start, setStart] = useState<number | null>(() =>
    params.page ? Math.min(PAGES, Math.max(1, Number(params.page))) : surahParam ? null : (useData.getState().settings.quran.lastRead?.page ?? 1),
  );
  const [current, setCurrent] = useState(1);
  const [fontOk, setFontOk] = useState(false);
  const pageH = height - insets.top - insets.bottom - 70;

  useEffect(() => {
    void ensureFont(q.mushaf).then(() => setFontOk(true));
    if (!params.page && surahParam) void surahPage(surahParam, q.mushaf).then(setStart);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // count a page toward today's Qur'an amal after reading it for a while
  useEffect(() => {
    const timer = setTimeout(() => {
      const key = `quran.pagesRead.${today()}`;
      const done = new Set<number>(JSON.parse(storage.kvGet(key) ?? '[]'));
      if (done.has(current)) return;
      done.add(current);
      storage.kvSet(key, JSON.stringify([...done]));
      const st = useData.getState();
      const amal = st.amals[QURAN_AMAL];
      if (amal && !amal.deleted) {
        const c = st.bump('amal', QURAN_AMAL, 1);
        if (c === amal.target) toast(tr.quran.goalDone, 'sparkles');
      }
    }, COUNT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [current, tr.quran.goalDone]);

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const p = viewableItems[0]?.item as number | undefined;
    if (!p) return;
    setCurrent(p);
    const st = useData.getState();
    void loadPage(p, st.settings.quran.mushaf).then((a) => {
      const f = a[0];
      if (f) st.updateSettings({ quran: { ...st.settings.quran, lastRead: { surah: f.surah, ayah: f.ayah, page: p, at: Date.now() } } });
    });
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <View style={styles.top}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/quran'))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[font.h3, { color: t.text }]}>
            {tr.quran.page} {n(current)} / {n(PAGES)}
          </Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{mushafInfo(q.mushaf).title[lang]}</Text>
        </View>
        <IconButton icon="list-outline" onPress={() => router.replace('/quran')} label={tr.quran.title} />
      </View>
      {start === null || !fontOk ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={PAGE_LIST}
          horizontal
          inverted
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          keyExtractor={(p) => String(p)}
          initialScrollIndex={start - 1}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          renderItem={({ item }) => <MushafPage page={item} mushaf={q.mushaf} width={width} height={pageH} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: { flex: 1, borderRadius: radius.lg, borderWidth: 2, padding: 6 },
  innerFrame: { flex: 1, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  pageHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  surahHead: { borderWidth: 1.5, borderRadius: radius.pill, paddingVertical: 2, marginVertical: 6 },
  justify: { textAlign: 'justify' },
});
