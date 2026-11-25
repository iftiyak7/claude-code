/**
 * Home-page banner carousel: Qur'an ayat, authentic hadith and app tips.
 * Fully offline, auto-advances, swipeable, with animated page dots.
 */
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { Ionicons, Khatam, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';
import { useData } from '@/store/data';

interface Slide {
  key: string;
  tag: { bn: string; en: string };
  arabic?: string;
  text: { bn: string; en: string };
  source?: { bn: string; en: string };
  colors: [string, string];
  icon: IconName;
  cta?: { bn: string; en: string; route: string };
}

const SLIDES: Slide[] = [
  {
    key: 'ayah-dhikr',
    tag: { bn: 'আজকের আয়াত', en: 'Ayah of the day' },
    arabic: 'فَاذْكُرُونِي أَذْكُرْكُمْ',
    text: { bn: 'তোমরা আমাকে স্মরণ করো, আমিও তোমাদের স্মরণ করব।', en: 'Remember Me; I will remember you.' },
    source: { bn: 'সূরা আল-বাকারা ২:১৫২', en: 'Al-Baqarah 2:152' },
    colors: ['#F2703F', '#E0578A'],
    icon: 'book',
  },
  {
    key: 'hadith-consistency',
    tag: { bn: 'হাদিস', en: 'Hadith' },
    arabic: 'أَحَبُّ الأَعْمَالِ إِلَى اللَّهِ أَدْوَمُهَا وَإِنْ قَلَّ',
    text: { bn: 'আল্লাহর কাছে সবচেয়ে প্রিয় আমল সেটাই, যা নিয়মিত করা হয়, যদিও তা অল্প হয়।', en: 'The most beloved deeds to Allah are the most consistent, even if small.' },
    source: { bn: 'সহিহ বুখারি ৬৪৬৪', en: 'Sahih al-Bukhari 6464' },
    colors: ['#6D5AE6', '#A855F7'],
    icon: 'repeat',
  },
  {
    key: 'tip-tasbih',
    tag: { bn: 'নতুন সুবিধা', en: 'New' },
    text: { bn: 'তসবিহ দিয়ে পড়েছেন? যিকির পাতায় এক ট্যাপে "সম্পন্ন" করুন।', en: 'Counted on a tasbih? Mark it complete in one tap.' },
    colors: ['#16151A', '#3A3346'],
    icon: 'finger-print',
    cta: { bn: 'যিকির খুলুন', en: 'Open zikr', route: '/amal' },
  },
  {
    key: 'hadith-subhanallah',
    tag: { bn: 'যিকিরের ফজিলত', en: 'Virtue of dhikr' },
    arabic: 'سُبْحَانَ اللَّهِ وَبِحَمْدِهِ',
    text: {
      bn: 'যে দিনে ১০০ বার "সুবহানাল্লাহি ওয়া বিহামদিহি" বলে, তার গুনাহ মাফ হয়ে যায়, যদিও তা সমুদ্রের ফেনার সমান হয়।',
      en: 'Whoever says “SubhanAllahi wa bihamdihi” 100 times a day, his sins are forgiven even if like the foam of the sea.',
    },
    source: { bn: 'সহিহ বুখারি ৬৪০৫', en: 'Sahih al-Bukhari 6405' },
    colors: ['#26B07A', '#14B8A6'],
    icon: 'sparkles',
  },
  {
    key: 'ayah-ease',
    tag: { bn: 'আশার বাণী', en: 'Hope' },
    arabic: 'إِنَّ مَعَ الْعُسْرِ يُسْرًا',
    text: { bn: 'নিশ্চয়ই কষ্টের সাথে স্বস্তি রয়েছে।', en: 'Indeed, with hardship comes ease.' },
    source: { bn: 'সূরা আশ-শারহ ৯৪:৬', en: 'Ash-Sharh 94:6' },
    colors: ['#3E86F5', '#6D5AE6'],
    icon: 'sunny',
  },
];

const GAP = 12;
const AUTO_MS = 6000;

function Dot({ active }: { active: boolean }) {
  const t = useTheme();
  const s = useAnimatedStyle(() => ({ width: withTiming(active ? 22 : 7, { duration: 250 }), opacity: withTiming(active ? 1 : 0.35, { duration: 250 }) }), [active]);
  return <Animated.View style={[styles.dot, { backgroundColor: t.text }, s]} />;
}

export function BannerSlider() {
  const lang = useData((s) => s.settings.language);
  const { width } = useWindowDimensions();
  const cardW = width - 40;
  const step = cardW + GAP;
  const ref = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [index, setIndex] = useState(0);
  const touching = useRef(false);

  // start on a different slide each day so it feels fresh
  const [startAt] = useState(() => Math.floor(Date.now() / 86_400_000) % SLIDES.length);
  const slides = useMemo(() => [...SLIDES.slice(startAt), ...SLIDES.slice(0, startAt)], [startAt]);

  useEffect(() => {
    const id = setInterval(() => {
      if (touching.current) return;
      const next = (index + 1) % slides.length;
      ref.current?.scrollTo({ x: next * step, animated: true });
      setIndex(next);
    }, AUTO_MS);
    return () => clearInterval(id);
  }, [index, slides.length, step]);

  const onEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / step);
    if (i !== index) {
      setIndex(i);
      haptic.tap();
    }
    touching.current = false;
  };

  return (
    <View>
      <ScrollView
        ref={ref}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        contentContainerStyle={{ paddingHorizontal: 20, gap: GAP }}
        onScrollBeginDrag={() => (touching.current = true)}
        onMomentumScrollEnd={onEnd}
        style={{ marginHorizontal: -20 }}
      >
        {slides.map((s) => (
          <Pressable
            key={s.key}
            onPress={s.cta ? () => router.push(s.cta!.route as never) : undefined}
            accessibilityRole={s.cta ? 'button' : 'text'}
          >
            <LinearGradient colors={s.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.card, { width: cardW }]}>
              {/* decorative ornaments */}
              <View style={styles.ornament} pointerEvents="none">
                <Khatam size={150} color="rgba(255,255,255,0.08)" />
              </View>
              <View style={styles.ornamentSmall} pointerEvents="none">
                <Khatam size={46} color="rgba(255,255,255,0.12)" />
              </View>

              <View style={styles.tagRow}>
                <View style={styles.tag}>
                  <Ionicons name={s.icon} size={12} color="#fff" />
                  <Text style={[font.tiny, { color: '#fff' }]}>{s.tag[lang]}</Text>
                </View>
              </View>
              {s.arabic ? (
                <Text style={[font.arabic, styles.arabic]} numberOfLines={1}>
                  {s.arabic}
                </Text>
              ) : null}
              <Text style={[font.body, styles.text, !s.arabic && { fontSize: 18, lineHeight: 28, fontWeight: '600' }]} numberOfLines={4}>
                {s.text[lang]}
              </Text>
              <View style={styles.footer}>
                {s.source ? <Text style={[font.tiny, styles.source]}>— {s.source[lang]}</Text> : <View />}
                {s.cta ? (
                  <View style={styles.cta}>
                    <Text style={[font.tiny, { color: '#16151A', fontSize: 12 }]}>{s.cta[lang]}</Text>
                    <Ionicons name="arrow-forward" size={13} color="#16151A" />
                  </View>
                ) : null}
              </View>
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>
      <View style={styles.dots}>
        {slides.map((s, i) => (
          <Dot key={s.key} active={i === index} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flex: 1, borderRadius: radius.xl, padding: 20, minHeight: 176, overflow: 'hidden', justifyContent: 'space-between' },
  ornament: { position: 'absolute', right: -40, top: -36 },
  ornamentSmall: { position: 'absolute', right: 70, bottom: 14 },
  tagRow: { flexDirection: 'row' },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(255,255,255,0.2)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
  arabic: { color: '#fff', fontSize: 24, lineHeight: 42, textAlign: 'left', marginTop: 8 },
  text: { color: 'rgba(255,255,255,0.95)', marginTop: 6, lineHeight: 23 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  source: { color: 'rgba(255,255,255,0.8)', fontWeight: '500' },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 },
  dot: { height: 7, borderRadius: 4 },
});
