/**
 * Surah reader: ayah-by-ayah with optional Bangla translation, in any of the
 * bundled mushaf styles. Remembers where you stopped; bookmark / share per ayah.
 */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, Share, StyleSheet, Text as RNText, View, type ListViewToken as ViewToken } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { MushafId, TranslationId } from '@/domain/types';
import { useNum, useT } from '@/i18n';
import { arabicStyle, ayahSpans } from '@/quran/ArabicAyah';
import { BISMILLAH, ensureFont, loadSurah, loadTranslation, MUSHAFS, mushafInfo, SURAHS, TAJWEED_COLORS, TAJWEED_LEGEND, type Ayah } from '@/quran/data';
import { useData } from '@/store/data';
import { useSettings } from '@/store/hooks';
import { Button, Chip, IconButton, Ionicons, Khatam, Segmented } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

export default function SurahReader() {
  const params = useLocalSearchParams<{ surah: string; ayah?: string }>();
  const surah = Math.min(114, Math.max(1, Number(params.surah) || 1));
  const startAyah = Number(params.ayah) || 0;
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const s = useSettings();
  const q = s.quran;
  const lang = s.language;
  const meta = SURAHS[surah - 1];
  const info = mushafInfo(q.mushaf);
  const hafsBased = info.riwayah === 'hafs';

  // loaded data is tagged with what it was loaded for, so a change of surah /
  // style shows the spinner without resetting state inside an effect
  const loadKey = `${surah}|${q.mushaf}`;
  const [loaded, setLoaded] = useState<{ key: string; ayat: Ayah[] } | null>(null);
  const ayat = loaded?.key === loadKey ? loaded.ayat : null;
  const fontReady = !!ayat;
  const transKey = hafsBased && q.translation !== 'none' ? `${surah}|${q.translation}` : '';
  const [transLoaded, setTransLoaded] = useState<{ key: string; lines: string[] } | null>(null);
  const trans = transKey && transLoaded?.key === transKey ? transLoaded.lines : [];
  const [sheet, setSheet] = useState(false);
  const [selected, setSelected] = useState<Ayah | null>(null);
  const listRef = useRef<FlatList<Ayah>>(null);

  const setQuran = useCallback((patch: Partial<typeof q>) => {
    const cur = useData.getState().settings.quran;
    useData.getState().updateSettings({ quran: { ...cur, ...patch } });
  }, []);

  useEffect(() => {
    let alive = true;
    void Promise.all([ensureFont(q.mushaf), loadSurah(surah, q.mushaf)]).then(([, a]) => {
      if (alive) setLoaded({ key: `${surah}|${q.mushaf}`, ayat: a });
    });
    return () => {
      alive = false;
    };
  }, [surah, q.mushaf]);

  useEffect(() => {
    if (!transKey) return;
    let alive = true;
    void loadTranslation(q.translation, surah).then((lines) => alive && setTransLoaded({ key: transKey, lines }));
    return () => {
      alive = false;
    };
  }, [transKey, q.translation, surah]);

  // jump to the requested ayah once loaded
  useEffect(() => {
    if (!ayat || startAyah < 2) return;
    const idx = ayat.findIndex((a) => a.ayah === startAyah);
    if (idx > 0) setTimeout(() => listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.1 }), 350);
  }, [ayat, startAyah]);

  // remember where the reader is
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((v) => v.isViewable)?.item as Ayah | undefined;
    if (!first) return;
    const cur = useData.getState().settings.quran;
    if (cur.lastRead?.surah === first.surah && cur.lastRead?.ayah === first.ayah) return;
    useData.getState().updateSettings({ quran: { ...cur, lastRead: { surah: first.surah, ayah: first.ayah, page: first.page, at: Date.now() } } });
  }, []);

  const color = t.text;
  const size = q.fontSize;
  const bookmarked = (a: Ayah) => q.bookmarks.includes(`${a.surah}:${a.ayah}`);
  const showBismillah = surah !== 9 && surah !== 1 && hafsBased;

  const header = useMemo(
    () => (
      <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 20 }}>
        <View style={[styles.banner, { backgroundColor: t.hero }]}>
          <View style={styles.bannerOrnL} pointerEvents="none">
            <Khatam size={90} color="rgba(255,255,255,0.07)" />
          </View>
          <View style={styles.bannerOrnR} pointerEvents="none">
            <Khatam size={90} color="rgba(255,255,255,0.07)" />
          </View>
          <RNText style={[styles.bannerAr, { fontFamily: 'Amiri_700Bold' }]}>{`سُورَةُ ${meta.ar}`}</RNText>
          <Text style={[font.h3, { color: '#fff', textAlign: 'center' }]}>
            {lang === 'bn' ? meta.bn : meta.en} · {lang === 'bn' ? meta.mean : ''}
          </Text>
          <Text style={[font.small, { color: 'rgba(255,255,255,0.7)', textAlign: 'center' }]}>
            {meta.type === 'm' ? tr.quran.makki : tr.quran.madani} · {n(meta.ayahs)} {tr.quran.ayahs} · {tr.quran.page} {n(meta.page)}
          </Text>
        </View>
        {showBismillah && fontReady && (
          <RNText style={[arabicStyle(q.mushaf === 'indopak' || q.mushaf === 'tajweed' ? 'hafs' : q.mushaf, size * 0.95, color), styles.bismillah]}>{BISMILLAH}</RNText>
        )}
        {q.mushaf === 'tajweed' && <TajweedLegend />}
      </Animated.View>
    ),
    [meta, lang, t.hero, tr, n, showBismillah, fontReady, q.mushaf, size, color],
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + 10, backgroundColor: t.bg, borderBottomColor: t.border }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/quran'))} />
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={[font.h3, { color: t.text }]} numberOfLines={1}>
            {n(surah)}. {lang === 'bn' ? meta.bn : meta.en}
          </Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{info.title[lang]}</Text>
        </View>
        <IconButton
          icon="document-text-outline"
          label={tr.quran.pageMode}
          onPress={() => router.push(`/quran/page?surah=${surah}` as never)}
        />
        <IconButton icon="options-outline" onPress={() => setSheet(true)} label={tr.settings} />
      </View>

      {!ayat ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
          <Text style={[font.small, { color: t.muted, marginTop: 10 }]}>{tr.quran.loading}</Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={ayat}
          keyExtractor={(a) => `${a.surah}:${a.ayah}`}
          ListHeaderComponent={header}
          initialNumToRender={8}
          windowSize={7}
          onViewableItemsChanged={onViewable}
          viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
          onScrollToIndexFailed={(e) => setTimeout(() => listRef.current?.scrollToIndex({ index: e.index, animated: false }), 300)}
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          ListFooterComponent={<NextSurah surah={surah} />}
          renderItem={({ item, index }) => (
            <Pressable
              onPress={() => {
                haptic.tap();
                setSelected(item);
              }}
              style={({ pressed }) => [styles.ayah, { borderBottomColor: t.border }, pressed && { backgroundColor: t.surface2 }]}
            >
              <View style={styles.ayahTop}>
                <View style={[styles.num, { backgroundColor: t.primarySoft }]}>
                  <Text style={[font.tiny, { color: t.primaryDeep, fontSize: 12 }]}>
                    {n(surah)}:{n(item.ayah)}
                  </Text>
                </View>
                {bookmarked(item) && <Ionicons name="bookmark" size={16} color={t.primary} />}
              </View>
              <RNText style={arabicStyle(q.mushaf, size, color)}>{ayahSpans(item, q.mushaf, color, size, t.primary)}</RNText>
              {trans[index] ? <Text style={[styles.trans, { color: t.muted, fontSize: 16 }]}>{trans[index]}</Text> : null}
            </Pressable>
          )}
        />
      )}

      {/* ayah actions */}
      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)} />
        {selected && (
          <Animated.View entering={FadeIn} style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + 18 }]}>
            <Text style={[font.h3, { color: t.text, marginBottom: 12 }]}>
              {lang === 'bn' ? meta.bn : meta.en} {n(selected.surah)}:{n(selected.ayah)}
            </Text>
            <ActionRow
              icon={bookmarked(selected) ? 'bookmark' : 'bookmark-outline'}
              label={bookmarked(selected) ? tr.quran.unbookmark : tr.quran.bookmark}
              onPress={() => {
                const key = `${selected.surah}:${selected.ayah}`;
                const has = q.bookmarks.includes(key);
                setQuran({ bookmarks: has ? q.bookmarks.filter((x) => x !== key) : [key, ...q.bookmarks] });
                toast(has ? tr.quran.unbookmarked : tr.quran.bookmarked, 'bookmark');
                setSelected(null);
              }}
            />
            <ActionRow
              icon="flag-outline"
              label={tr.quran.markLast}
              onPress={() => {
                setQuran({ lastRead: { surah: selected.surah, ayah: selected.ayah, page: selected.page, at: Date.now() } });
                toast(tr.quran.markedLast, 'flag');
                setSelected(null);
              }}
            />
            <ActionRow
              icon="share-outline"
              label={tr.quran.share}
              onPress={() => {
                const ti = ayat?.indexOf(selected) ?? -1;
                const body = `${selected.tajweed ? selected.tajweed.map((x) => x[0]).join('') : selected.text}\n\n${ti >= 0 && trans[ti] ? `${trans[ti]}\n\n` : ''}— ${lang === 'bn' ? meta.bn : meta.en} ${selected.surah}:${selected.ayah}`;
                void Share.share({ message: body });
                setSelected(null);
              }}
            />
          </Animated.View>
        )}
      </Modal>

      {/* reader settings */}
      <Modal visible={sheet} transparent animationType="slide" onRequestClose={() => setSheet(false)}>
        <Pressable style={styles.backdrop} onPress={() => setSheet(false)} />
        <View style={[styles.sheet, { backgroundColor: t.surface, paddingBottom: insets.bottom + 18 }]}>
          <Text style={[font.small, { color: t.muted, fontWeight: '600', marginBottom: 8 }]}>{tr.quran.styles}</Text>
          <View style={styles.wrap}>
            {MUSHAFS.map((m) => (
              <Chip key={m.id} label={m.title[lang]} active={q.mushaf === m.id} onPress={() => setQuran({ mushaf: m.id as MushafId })} />
            ))}
          </View>
          {hafsBased ? (
            <>
              <Text style={[font.small, { color: t.muted, fontWeight: '600', marginTop: 16, marginBottom: 8 }]}>{tr.quran.translation}</Text>
              <Segmented<TranslationId>
                value={q.translation}
                onChange={(translation) => setQuran({ translation })}
                options={[
                  { value: 'zakaria', label: tr.quran.zakaria },
                  { value: 'muhiuddin', label: tr.quran.muhiuddin },
                  { value: 'none', label: tr.quran.noTranslation },
                ]}
              />
            </>
          ) : (
            <Text style={[font.small, { color: t.muted, marginTop: 14 }]}>{tr.quran.riwayahNote}</Text>
          )}
          <Text style={[font.small, { color: t.muted, fontWeight: '600', marginTop: 16, marginBottom: 8 }]}>{tr.quran.fontSize}</Text>
          <View style={styles.sizeRow}>
            <IconButton icon="remove" onPress={() => setQuran({ fontSize: Math.max(20, q.fontSize - 2) })} />
            <RNText style={{ fontFamily: info.font, fontSize: Math.min(q.fontSize, 34), color: t.text }}>بِسْمِ اللَّهِ</RNText>
            <IconButton icon="add" onPress={() => setQuran({ fontSize: Math.min(44, q.fontSize + 2) })} />
          </View>
          <Button label={tr.setup.done} onPress={() => setSheet(false)} style={{ marginTop: 18 }} />
        </View>
      </Modal>
    </View>
  );
}

function TajweedLegend() {
  const t = useTheme();
  const lang = useData((s) => s.settings.language);
  return (
    <View style={[styles.legend, { backgroundColor: t.surface }]}>
      {TAJWEED_LEGEND.map((l) => (
        <View key={l.key} style={styles.legendItem}>
          <View style={[styles.dot, { backgroundColor: TAJWEED_COLORS[l.key] ?? t.faint }]} />
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{l[lang]}</Text>
        </View>
      ))}
    </View>
  );
}

function ActionRow({ icon, label, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]}>
      <View style={[styles.actionIc, { backgroundColor: t.primarySoft }]}>
        <Ionicons name={icon} size={18} color={t.primary} />
      </View>
      <Text style={[font.body, { color: t.text, fontWeight: '600' }]}>{label}</Text>
    </Pressable>
  );
}

function NextSurah({ surah }: { surah: number }) {
  const tr = useT();
  const lang = useData((s) => s.settings.language);
  if (surah >= 114) return null;
  const next = SURAHS[surah];
  return (
    <View style={{ padding: 20 }}>
      <Button
        kind="soft"
        icon="arrow-forward"
        label={`${tr.quran.next}: ${lang === 'bn' ? next.bn : next.en}`}
        onPress={() => router.replace(`/quran/${surah + 1}` as never)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { borderRadius: radius.xl, paddingVertical: 22, paddingHorizontal: 18, marginTop: 16, overflow: 'hidden', gap: 2 },
  bannerOrnL: { position: 'absolute', left: -24, top: -20 },
  bannerOrnR: { position: 'absolute', right: -24, bottom: -20 },
  bannerAr: { color: '#FFB48A', fontSize: 30, textAlign: 'center', lineHeight: 52 },
  bismillah: { textAlign: 'center', marginTop: 18 },
  ayah: { paddingHorizontal: 20, paddingVertical: 18, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  ayahTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  num: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  trans: { lineHeight: 26 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { padding: 20, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sizeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, padding: 14, borderRadius: radius.lg, marginTop: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  actionIc: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
});
