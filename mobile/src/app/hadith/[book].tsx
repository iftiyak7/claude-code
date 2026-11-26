/** Chapters of one hadith book, with a quick filter. */
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { bookById, formatNum, type Chapter } from '@/hadith/data';
import { useNum, useT } from '@/i18n';
import { useSettings } from '@/store/hooks';
import { IconButton, Ionicons, PressableScale } from '@/ui/components';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

export default function HadithBook() {
  const { book: id } = useLocalSearchParams<{ book: string }>();
  const book = bookById(id);
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const lang = useSettings().language;
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!book) return [];
    if (!k) return book.chapters;
    return book.chapters.filter((c) => c.bn.includes(k) || c.en.toLowerCase().includes(k) || String(c.n) === k);
  }, [book, q]);

  if (!book) return null;

  const renderItem = ({ item, index }: { item: Chapter; index: number }) => (
    <Animated.View entering={index < 14 ? FadeInDown.delay(index * 30).duration(300) : undefined}>
      <PressableScale
        onPress={() => router.push({ pathname: '/hadith/read', params: { book: book.id, ch: String(item.n) } })}
        style={[styles.row, { backgroundColor: t.surface, borderColor: t.border }]}
      >
        <View style={[styles.num, { backgroundColor: t.primarySoft }]}>
          <Text style={[font.small, { color: t.primaryDeep, fontWeight: '700' }]}>{n(item.n)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[font.body, { color: t.text, fontWeight: '600' }]} numberOfLines={2}>
            {lang === 'bn' ? item.bn : item.en}
          </Text>
          <Text style={[font.tiny, { color: t.muted, fontWeight: '500', marginTop: 2 }]}>
            {tr.hadith.total(n(item.count))} · {n(formatNum(item.first))}–{n(formatNum(item.last))}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.faint} />
      </PressableScale>
    </Animated.View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/hadith'))} />
        <View style={{ flex: 1 }}>
          <Text style={[font.h2, { color: t.text }]} numberOfLines={1}>
            {lang === 'bn' ? book.bn : book.en}
          </Text>
          <Text style={[font.small, { color: t.muted }]}>
            {book.author} · {tr.hadith.total(n(book.count.toLocaleString('en-US')))}
          </Text>
        </View>
      </View>
      <View style={{ paddingHorizontal: 20 }}>
        <View style={[styles.search, { backgroundColor: t.surface, borderColor: t.border }]}>
          <Ionicons name="search" size={18} color={t.muted} />
          <TextInput value={q} onChangeText={setQ} placeholder={tr.hadith.search} placeholderTextColor={t.faint} style={[styles.searchInput, { color: t.text }]} />
        </View>
      </View>
      <FlatList
        data={list}
        keyExtractor={(c) => String(c.n)}
        renderItem={renderItem}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 10, paddingTop: 12 }}
        initialNumToRender={14}
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, height: 48 },
  searchInput: { flex: 1, fontSize: 16 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: radius.md, borderWidth: 1 },
  num: { minWidth: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
});
