/** Al-Asma' al-Husna: the 99 names with pronunciation and meaning. */
import React, { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useNum, useT } from '@/i18n';
import NAMES_JSON from '@/names/names.json';
import { useSettings } from '@/store/hooks';
import { Button, IconButton, Khatam, PressableScale } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { font, radius, useTheme } from '@/ui/theme';

interface Name {
  n: number;
  ar: string;
  pron: string;
  bn: string;
  en: string;
}
const NAMES = NAMES_JSON as Name[];

export default function NamesScreen() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const lang = useSettings().language;
  const [open, setOpen] = useState<Name | null>(null);
  const cols = width > 600 ? 4 : 3;
  const size = (Math.min(width, 900) - 40 - (cols - 1) * 10) / cols;

  const header = (
    <View style={{ paddingTop: insets.top + 10 }}>
      <View style={styles.top}>
        <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      </View>
      <Text style={[font.display, { color: t.text, marginTop: 14 }]}>{tr.names.title}</Text>
      <Text style={[font.body, { color: t.muted, marginTop: 4 }]}>{tr.names.sub}</Text>
      <Animated.View entering={FadeInDown.duration(400)} style={[styles.hero, { backgroundColor: t.hero }]}>
        <View style={styles.heroOrn} pointerEvents="none">
          <Khatam size={140} color="rgba(255,255,255,0.06)" />
        </View>
        <Text style={[font.body, { color: '#fff', lineHeight: 26 }]}>{tr.names.virtue}</Text>
        <Text style={[font.small, { color: '#FFB48A', marginTop: 8, fontWeight: '600' }]}>{tr.names.virtueRef}</Text>
        <Text style={[font.tiny, { color: 'rgba(255,255,255,0.65)', marginTop: 10, lineHeight: 18, fontWeight: '500' }]}>{tr.names.listNote}</Text>
      </Animated.View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <FlatList
        data={NAMES}
        key={cols}
        numColumns={cols}
        keyExtractor={(x) => String(x.n)}
        ListHeaderComponent={header}
        columnWrapperStyle={{ gap: 10 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 40, gap: 10 }}
        initialNumToRender={18}
        renderItem={({ item, index }) => (
          <Animated.View entering={index < 18 ? ZoomIn.delay(120 + index * 25).springify().damping(14) : FadeIn}>
            <PressableScale
              onPress={() => {
                haptic.tap();
                setOpen(item);
              }}
              style={[styles.tile, { width: size, height: size * 1.08, backgroundColor: t.surface, borderColor: t.border }]}
            >
              <Text style={[styles.tileNum, { color: t.faint }]}>{n(item.n)}</Text>
              <RNText style={[styles.tileAr, { color: t.text }]} numberOfLines={1} adjustsFontSizeToFit>
                {item.ar}
              </RNText>
              <Text style={[font.tiny, { color: t.primaryDeep, fontWeight: '700', textAlign: 'center' }]} numberOfLines={1}>
                {lang === 'bn' ? item.pron : item.en}
              </Text>
              <Text style={[font.tiny, { color: t.muted, textAlign: 'center', fontWeight: '500', fontSize: 11 }]} numberOfLines={2}>
                {lang === 'bn' ? item.bn : item.en}
              </Text>
            </PressableScale>
          </Animated.View>
        )}
      />

      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(null)}>
          {open && (
            <Animated.View entering={ZoomIn.springify().damping(15)} style={[styles.sheet, { backgroundColor: t.surface }]}>
              <View style={[styles.sheetNum, { backgroundColor: t.primarySoft }]}>
                <Text style={[font.small, { color: t.primaryDeep, fontWeight: '700' }]}>{n(open.n)}</Text>
              </View>
              <RNText style={[styles.sheetAr, { color: t.text }]}>{open.ar}</RNText>
              <Text style={[font.h2, { color: t.primaryDeep, textAlign: 'center' }]}>{open.pron}</Text>
              <Text style={[font.small, { color: t.muted, marginTop: 14 }]}>{tr.names.meaning}</Text>
              <Text style={[font.h3, { color: t.text, textAlign: 'center', marginTop: 2 }]}>{open.bn}</Text>
              <Text style={[font.small, { color: t.muted, textAlign: 'center', marginTop: 4 }]}>{open.en}</Text>
              <View style={{ alignSelf: 'stretch', marginTop: 20 }}>
                <Button kind="soft" label={tr.names.close} onPress={() => setOpen(null)} />
              </View>
            </Animated.View>
          )}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row' },
  hero: { borderRadius: radius.lg, padding: 20, marginTop: 18, marginBottom: 16, overflow: 'hidden' },
  heroOrn: { position: 'absolute', right: -30, bottom: -40 },
  tile: { borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', padding: 8, gap: 2 },
  tileNum: { position: 'absolute', top: 6, left: 9, fontSize: 11, fontWeight: '600' },
  tileAr: { fontFamily: 'Amiri_700Bold', fontSize: 24, lineHeight: 44, textAlign: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  sheet: { width: '100%', maxWidth: 420, borderRadius: radius.lg, padding: 24, alignItems: 'center' },
  sheetNum: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetAr: { fontFamily: 'Amiri_700Bold', fontSize: 46, lineHeight: 92, textAlign: 'center' },
});
