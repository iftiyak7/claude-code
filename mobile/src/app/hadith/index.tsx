/** Hadith library: the eight books, plus jump straight to a hadith number. */
import { router } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text as RNText, TextInput, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { BOOKS, chapterOf, TOTAL_HADITH } from '@/hadith/data';
import { useNum, useT } from '@/i18n';
import { useSettings } from '@/store/hooks';
import { Button, Card, Chip, Ionicons, Khatam, PressableScale, Screen } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

const TINTS = ['#26B07A', '#3E86F5', '#F2703F', '#6D5AE6', '#E0578A', '#14B8A6', '#E9A93A', '#64748B'];

export default function HadithHome() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const lang = useSettings().language;
  const [jumpBook, setJumpBook] = useState(BOOKS[0].id);
  const [num, setNum] = useState('');

  const jump = () => {
    const b = BOOKS.find((x) => x.id === jumpBook)!;
    const value = Number(num.replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))));
    const ch = value > 0 ? chapterOf(b, value) : undefined;
    if (!ch) {
      haptic.warn();
      toast(tr.hadith.notFound, 'alert-circle-outline');
      return;
    }
    router.push({ pathname: '/hadith/read', params: { book: b.id, ch: String(ch.n), num: String(value) } });
  };

  return (
    <Screen title={tr.hadith.title} subtitle={tr.hadith.sub} back>
      <Animated.View entering={FadeInDown.duration(350)}>
        <View style={[styles.hero, { backgroundColor: t.hero }]}>
          <View style={styles.heroOrn} pointerEvents="none">
            <Khatam size={150} color="rgba(255,255,255,0.06)" />
          </View>
          <RNText style={styles.heroAr}>قَالَ رَسُولُ اللَّهِ ﷺ</RNText>
          <Text style={[font.h2, { color: '#fff', marginTop: 6 }]}>{tr.hadith.total(n(TOTAL_HADITH.toLocaleString('en-US')))}</Text>
          <Text style={[font.small, { color: 'rgba(255,255,255,0.7)' }]}>{tr.hadith.chapters(n(BOOKS.reduce((s, b) => s + b.chapters.length, 0)))}</Text>
        </View>
      </Animated.View>

      {/* jump to number */}
      <Animated.View entering={FadeInDown.delay(60).duration(350)}>
        <Card style={{ marginTop: 14, gap: 12 }}>
          <Text style={[font.small, { color: t.muted, fontWeight: '600' }]}>{tr.hadith.goTo}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {BOOKS.map((b) => (
              <Chip key={b.id} label={lang === 'bn' ? b.bn : b.en} active={jumpBook === b.id} onPress={() => setJumpBook(b.id)} />
            ))}
          </View>
          <View style={styles.jumpRow}>
            <TextInput
              value={num}
              onChangeText={setNum}
              keyboardType="number-pad"
              placeholder="১২৩"
              placeholderTextColor={t.faint}
              onSubmitEditing={jump}
              returnKeyType="go"
              style={[styles.input, { color: t.text, backgroundColor: t.surface2, borderColor: t.border }]}
            />
            <Button label={tr.hadith.go} icon="arrow-forward" onPress={jump} />
          </View>
        </Card>
      </Animated.View>

      {BOOKS.map((b, i) => (
        <Animated.View key={b.id} entering={FadeInDown.delay(100 + i * 45).duration(380)}>
          <PressableScale onPress={() => router.push({ pathname: '/hadith/[book]', params: { book: b.id } })} style={[styles.book, { backgroundColor: t.surface, borderColor: t.border }]}>
            <View style={[styles.bookIcon, { backgroundColor: TINTS[i % TINTS.length] + '22' }]}>
              <Ionicons name="library" size={22} color={TINTS[i % TINTS.length]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[font.h3, { color: t.text }]}>{lang === 'bn' ? b.bn : b.en}</Text>
              <Text style={[font.small, { color: t.muted }]}>
                {tr.hadith.total(n(b.count.toLocaleString('en-US')))} · {tr.hadith.chapters(n(b.chapters.length))}
              </Text>
            </View>
            <RNText style={[styles.bookAr, { color: t.muted }]}>{b.ar}</RNText>
          </PressableScale>
        </Animated.View>
      ))}

      <Text style={[font.small, { color: t.faint, marginTop: 16, lineHeight: 20 }]}>{tr.hadith.sources}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.lg, padding: 22, overflow: 'hidden' },
  heroOrn: { position: 'absolute', right: -30, top: -30 },
  heroAr: { fontFamily: 'Amiri_700Bold', fontSize: 22, color: '#FFB48A', textAlign: 'left' },
  jumpRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  input: { flex: 1, height: 50, borderRadius: radius.md, borderWidth: 1, paddingHorizontal: 16, fontSize: 18 },
  book: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, borderWidth: 1, marginTop: 12 },
  bookIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  bookAr: { fontFamily: 'Amiri_400Regular', fontSize: 15, maxWidth: 110, textAlign: 'right' },
});
