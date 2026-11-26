/**
 * One adhkar collection. Each card shows the Arabic (Qur'an items straight
 * from the bundled mushaf), pronunciation, meaning, virtue and the verified
 * reference, with a tap counter that fills up and moves on to the next one.
 */
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { adhkarFor, CATEGORIES, catProgress, textFor, useAdhkar, type AdhkarCat, type Dhikr } from '@/adhkar/data';
import { useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { arabicStyle, ayahSpans } from '@/quran/ArabicAyah';
import { BISMILLAH, ensureFont, loadSurah, SURAHS, type Ayah } from '@/quran/data';
import { useSettings } from '@/store/hooks';
import { IconButton, Ionicons, PressableScale, ProgressBar } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

/** Qur'an passages for a dhikr, read from the bundled Madani mushaf. */
function useQuranPassages(q: Dhikr['quran']) {
  const [data, setData] = useState<{ surah: number; ayat: Ayah[] }[] | null>(null);
  useEffect(() => {
    if (!q) return;
    let alive = true;
    const parts = q.surahs ? q.surahs.map((s) => ({ surah: s, from: 1, to: 999 })) : [{ surah: q.surah!, from: q.from ?? 1, to: q.to ?? 999 }];
    void Promise.all([ensureFont('hafs'), ...parts.map((p) => loadSurah(p.surah, 'hafs'))]).then(([, ...lists]) => {
      if (!alive) return;
      setData(parts.map((p, i) => ({ surah: p.surah, ayat: (lists[i] as Ayah[]).filter((a) => a.ayah >= p.from && a.ayah <= p.to) })));
    });
    return () => {
      alive = false;
    };
  }, [q]);
  return data;
}

const DhikrCard = memo(function DhikrCard({ d, cat, count, onTap }: { d: Dhikr; cat: AdhkarCat; count: number; onTap: (d: Dhikr) => void }) {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const text = textFor(d, cat);
  const passages = useQuranPassages(d.quran);
  const done = count >= d.count;
  const ink = t.text;

  const pulse = useSharedValue(1);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.get() }] }));
  const tap = () => {
    pulse.set(withSequence(withTiming(0.9, { duration: 70 }), withSpring(1, { damping: 9, stiffness: 320 })));
    onTap(d);
  };

  return (
    <View style={[styles.card, { backgroundColor: t.surface, borderColor: done ? t.success : t.border }]}>
      {(d.title || d.note) && (
        <View style={styles.chips}>
          {d.title ? <Text style={[font.h3, { color: t.text, flexShrink: 1 }]}>{d.title}</Text> : null}
          {d.note ? (
            <View style={[styles.chip, { backgroundColor: t.goldSoft }]}>
              <Text style={[font.tiny, { color: t.gold, fontWeight: '700' }]}>{d.note}</Text>
            </View>
          ) : null}
        </View>
      )}

      {text.ar ? (
        <RNText style={[styles.ar, { color: ink }]}>{text.ar}</RNText>
      ) : passages ? (
        passages.map((p) => (
          <View key={p.surah} style={{ marginBottom: 8 }}>
            {d.quran?.surahs && (
              <>
                <Text style={[font.tiny, { color: t.muted, fontWeight: '600', textAlign: 'center' }]}>{SURAHS[p.surah - 1].bn}</Text>
                <RNText style={[arabicStyle('hafs', 20, ink), { textAlign: 'center' }]}>{BISMILLAH}</RNText>
              </>
            )}
            <RNText style={[arabicStyle('hafs', 23, ink), { textAlign: 'right' }]}>
              {p.ayat.map((a) => (
                <RNText key={a.ayah}>{ayahSpans(a, 'hafs', ink, 23, t.primary)} </RNText>
              ))}
            </RNText>
          </View>
        ))
      ) : (
        <View style={{ height: 60 }} />
      )}

      <Text style={[font.tiny, { color: t.primaryDeep, fontWeight: '700', marginTop: 10 }]}>{tr.adhkar.pron}</Text>
      <Text style={[styles.body, { color: t.text }]}>{text.pron}</Text>
      <Text style={[font.tiny, { color: t.primaryDeep, fontWeight: '700', marginTop: 10 }]}>{tr.adhkar.meaning}</Text>
      <Text style={[styles.body, { color: t.muted }]}>{text.bn}</Text>

      {d.virtue ? (
        <View style={[styles.virtue, { backgroundColor: t.lavenderSoft }]}>
          <Ionicons name="sparkles" size={16} color={t.lavenderInk} />
          <Text style={[font.small, { color: t.text, flex: 1, lineHeight: 21 }]}>{d.virtue}</Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={{ flex: 1 }}>
          <Row2 icon={d.verified ? 'shield-checkmark' : 'book-outline'} color={d.verified ? t.success : t.muted} text={d.ref} />
          {d.grade ? <Text style={[font.tiny, { color: t.success, fontWeight: '700', marginTop: 4 }]}>{d.grade}</Text> : null}
        </View>
        <PressableScale onPress={tap} scaleTo={0.95} accessibilityLabel={tr.adhkar.tapToCount} disabled={done}>
          <Animated.View style={[styles.counter, pulseStyle, { backgroundColor: done ? t.success : t.primary }]}>
            {done ? (
              <Animated.View entering={ZoomIn.springify()}>
                <Ionicons name="checkmark" size={26} color="#fff" />
              </Animated.View>
            ) : (
              <>
                <Text style={[font.h3, { color: '#fff' }]}>{n(count)}</Text>
                <Text style={[font.tiny, { color: 'rgba(255,255,255,0.8)', fontWeight: '600' }]}>/ {n(d.count)}</Text>
              </>
            )}
          </Animated.View>
        </PressableScale>
      </View>
    </View>
  );
});

function Row2({ icon, color, text }: { icon: 'shield-checkmark' | 'book-outline'; color: string; text: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={14} color={color} style={{ marginTop: 2 }} />
      <Text style={[font.tiny, { color: t.muted, flex: 1, fontWeight: '500', lineHeight: 17 }]}>{text}</Text>
    </View>
  );
}

export default function AdhkarList() {
  const { cat: raw } = useLocalSearchParams<{ cat: string }>();
  const cat = (['salah', 'morning', 'evening'].includes(raw) ? raw : 'salah') as AdhkarCat;
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const lang = useSettings().language;
  const date = useToday();
  const progress = useAdhkar((s) => s.progress);
  useFocusEffect(useCallback(() => useAdhkar.getState().load(date), [date]));
  const items = adhkarFor(cat);
  const p = catProgress(progress, cat);
  const listRef = useRef<FlatList<Dhikr>>(null);

  const onTap = useCallback(
    (d: Dhikr) => {
      const st = useAdhkar.getState();
      const cur = st.progress[`${cat}:${d.id}`] ?? 0;
      if (cur >= d.count) return;
      const next = cur + 1;
      st.set(cat, d.id, next);
      if (next < d.count) {
        haptic.tap();
        return;
      }
      haptic.success();
      const idx = items.findIndex((x) => x.id === d.id);
      const after = catProgress(useAdhkar.getState().progress, cat);
      if (after.done === after.total) toast(tr.adhkar.allDone, 'sparkles');
      else if (idx + 1 < items.length) setTimeout(() => listRef.current?.scrollToIndex({ index: idx + 1, animated: true, viewPosition: 0 }), 350);
    },
    [cat, items, tr.adhkar.allDone],
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + 10, borderBottomColor: t.border }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/adhkar'))} />
        <View style={{ flex: 1 }}>
          <Text style={[font.h3, { color: t.text }]}>{lang === 'bn' ? CATEGORIES[cat].bn : CATEGORIES[cat].en}</Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{tr.adhkar.progress(n(p.done), n(p.total))}</Text>
        </View>
        <IconButton
          icon="refresh"
          label={tr.adhkar.reset}
          onPress={() => {
            haptic.tap();
            useAdhkar.getState().reset(cat);
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          }}
        />
      </View>
      <View style={{ paddingHorizontal: 16, paddingTop: 10 }}>
        <ProgressBar progress={p.total ? p.done / p.total : 0} color={t.success} height={6} />
      </View>
      <Animated.View entering={FadeIn.duration(250)} style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(d) => d.id}
          extraData={progress}
          renderItem={({ item, index }) => (
            <Animated.View entering={index < 4 ? FadeInDown.delay(index * 60).duration(350) : undefined}>
              <DhikrCard d={item} cat={cat} count={progress[`${cat}:${item.id}`] ?? 0} onTap={onTap} />
            </Animated.View>
          )}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 14 }}
          initialNumToRender={4}
          onScrollToIndexFailed={(e) => listRef.current?.scrollToOffset({ offset: e.averageItemLength * e.index, animated: true })}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  card: { borderRadius: radius.lg, borderWidth: 1.5, padding: 18 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  ar: { fontFamily: 'Amiri_400Regular', fontSize: 24, lineHeight: 46, writingDirection: 'rtl', textAlign: 'right' },
  body: { fontSize: 15.5, lineHeight: 26, marginTop: 2 },
  virtue: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: radius.md, marginTop: 14 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  counter: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
