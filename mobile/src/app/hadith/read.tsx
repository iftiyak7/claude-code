/** Read one chapter of a hadith book: Arabic original + Bangla, with grades. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Share, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookById, formatNum, GRADE_INFO, loadChapter, type Hadith } from '@/hadith/data';
import { useNum, useT } from '@/i18n';
import { useSettings } from '@/store/hooks';
import { IconButton, Ionicons, PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

export default function HadithReader() {
  const params = useLocalSearchParams<{ book: string; ch: string; num?: string }>();
  const book = bookById(params.book);
  const chNum = Number(params.ch);
  const chapter = book?.chapters.find((c) => c.n === chNum);
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const lang = useSettings().language;
  const key = `${params.book}|${chNum}`;
  const [loaded, setLoaded] = useState<{ key: string; list: Hadith[] } | null>(null);
  const [showAr, setShowAr] = useState(true);
  const listRef = useRef<FlatList<Hadith>>(null);

  useEffect(() => {
    let alive = true;
    void loadChapter(params.book, chNum).then((list) => alive && setLoaded({ key, list }));
    return () => {
      alive = false;
    };
  }, [params.book, chNum, key]);

  const list = loaded?.key === key ? loaded.list : null;
  const target = useMemo(() => {
    if (!list || !params.num) return -1;
    const v = Number(params.num);
    return list.findIndex((h) => Math.floor(Number(h.num)) === v);
  }, [list, params.num]);

  if (!book || !chapter) return null;
  const bookName = lang === 'bn' ? book.bn : book.en;

  const share = (h: Hadith) => {
    haptic.tap();
    void Share.share({ message: `${h.ar ? `${h.ar}\n\n` : ''}${h.bn}\n\n— ${bookName} ${formatNum(h.num)}` });
  };

  const renderItem = ({ item, index }: { item: Hadith; index: number }) => renderCard(item, index === target && target >= 0);

  const renderCard = (item: Hadith, highlight: boolean) => {
    const g = item.grade ? GRADE_INFO[item.grade] : null;
    const tone = g ? { success: [t.success, t.successSoft], gold: [t.gold, t.goldSoft], danger: [t.danger, t.dangerSoft] }[g.tone] : [t.muted, t.surface2];
    return (
      <View style={[styles.card, { backgroundColor: t.surface, borderColor: highlight ? t.primary : t.border, borderWidth: highlight ? 2 : 1 }]}>
        <View style={styles.cardTop}>
          <View style={[styles.pill, { backgroundColor: t.primarySoft }]}>
            <Text style={[font.tiny, { color: t.primaryDeep, fontWeight: '700' }]}>
              {bookName} {n(formatNum(item.num))}
            </Text>
          </View>
          <View style={[styles.pill, { backgroundColor: tone[1] }]}>
            <Text style={[font.tiny, { color: tone[0], fontWeight: '700' }]}>{g ? (lang === 'bn' ? g.bn : g.en) : tr.hadith.ungraded}</Text>
          </View>
          <View style={{ flex: 1 }} />
          <PressableScale onPress={() => share(item)} hitSlop={10} scaleTo={0.85} accessibilityLabel={tr.hadith.share}>
            <Ionicons name="share-social-outline" size={19} color={t.muted} />
          </PressableScale>
        </View>
        {showAr && item.ar ? <RNText style={[styles.ar, { color: t.text }]}>{item.ar}</RNText> : null}
        {item.bn ? <Text style={[styles.bn, { color: t.text }]}>{item.bn}</Text> : null}
        {(item.grade === 'D' || item.grade === 'M') && (
          <Text style={[font.tiny, { color: t.danger, marginTop: 10, fontWeight: '500' }]}>{tr.hadith.weakNote}</Text>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + 10, borderBottomColor: t.border }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/hadith'))} />
        <View style={{ flex: 1 }}>
          <Text style={[font.h3, { color: t.text }]} numberOfLines={1}>
            {lang === 'bn' ? chapter.bn : chapter.en}
          </Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]} numberOfLines={1}>
            {bookName} · {tr.hadith.chapter} {n(chapter.n)} · {tr.hadith.total(n(chapter.count))}
          </Text>
        </View>
        <PressableScale
          onPress={() => {
            haptic.tap();
            setShowAr((v) => !v);
          }}
          style={[styles.arToggle, { backgroundColor: showAr ? t.hero : t.surface2 }]}
        >
          <RNText style={{ fontFamily: 'Amiri_700Bold', fontSize: 16, color: showAr ? '#fff' : t.muted }}>ع</RNText>
          <Text style={[font.tiny, { color: showAr ? '#fff' : t.muted, fontWeight: '600' }]}>{tr.hadith.showArabic}</Text>
        </PressableScale>
      </View>
      {!list ? (
        <View style={styles.center}>
          <ActivityIndicator color={t.primary} />
        </View>
      ) : (
        <Animated.View entering={FadeIn.duration(250)} style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={list}
            keyExtractor={(h, i) => `${h.num}-${i}`}
            renderItem={renderItem}
            extraData={showAr}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 40, gap: 12 }}
            initialNumToRender={6}
            windowSize={7}
            ListHeaderComponent={
              target >= 0 ? (
                <Animated.View entering={FadeIn.duration(300)} style={{ gap: 8, marginBottom: 4 }}>
                  <Text style={[font.small, { color: t.primaryDeep, fontWeight: '700' }]}>{tr.hadith.found}</Text>
                  {renderCard(list[target], true)}
                  <Text style={[font.small, { color: t.muted, fontWeight: '600', marginTop: 10 }]}>{tr.hadith.wholeChapter}</Text>
                </Animated.View>
              ) : undefined
            }
          />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderWidth: 1, padding: 16 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  pill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  ar: { fontFamily: 'Amiri_400Regular', fontSize: 20, lineHeight: 38, writingDirection: 'rtl', textAlign: 'right', marginBottom: 12 },
  bn: { fontSize: 16, lineHeight: 28, writingDirection: 'ltr', textAlign: 'left' },
  arToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 40, borderRadius: radius.pill },
});
