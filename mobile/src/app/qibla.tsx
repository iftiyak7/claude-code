/**
 * Qibla compass + sunrise/sunset. Everything is computed on the device from
 * the saved location, so it works with no internet. The phone's compass
 * (magnetometer) drives the dial; GPS sets the location without a network.
 */
import * as Location from 'expo-location';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import { addDays } from '@/domain/dates';
import { DEFAULT_LOCATION, distanceToKaabaKm, prayerTimesFor, qiblaDirection } from '@/domain/prayer';
import { locateMe } from '@/features/location';
import { formatClock, useNow, useToday } from '@/features/hooks';
import { useNum, useT } from '@/i18n';
import { useSettings } from '@/store/hooks';
import { Button, Card, Ionicons, Row, Screen, type IconName } from '@/ui/components';
import { haptic } from '@/ui/haptics';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/toast';
import { font, radius, useTheme } from '@/ui/theme';

const DIAL = 290;
const ALIGNED_DEG = 4;

/** Smallest signed difference a − b in degrees, in (−180, 180]. */
const angleDiff = (a: number, b: number) => ((((a - b) % 360) + 540) % 360) - 180;

function useHeading() {
  const [heading, setHeading] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState(3);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let sub: Location.LocationSubscription | null = null;
    let alive = true;
    void (async () => {
      try {
        // trueHeading (geographic north) needs location permission; magnetic heading works without it
        await Location.requestForegroundPermissionsAsync().catch(() => null);
        const s = await Location.watchHeadingAsync((h) => {
          const v = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
          setHeading(v);
          setAccuracy(h.accuracy);
        });
        if (alive) sub = s;
        else s.remove();
      } catch {
        /* no compass sensor */
      }
    })();
    return () => {
      alive = false;
      sub?.remove();
    };
  }, []);
  return { heading, accuracy };
}

export default function QiblaScreen() {
  const t = useTheme();
  const tr = useT();
  const n = useNum();
  const s = useSettings();
  const lang = s.language;
  const date = useToday();
  const now = useNow(30_000);
  const { heading, accuracy } = useHeading();
  const [busy, setBusy] = useState(false);

  const qibla = useMemo(() => qiblaDirection(s), [s]);
  const km = useMemo(() => distanceToKaabaKm(s), [s]);
  const loc = s.location ?? DEFAULT_LOCATION;
  const hasCompass = heading !== null;
  const diff = hasCompass ? angleDiff(qibla, heading) : 0;
  const aligned = hasCompass && Math.abs(diff) <= ALIGNED_DEG;

  // continuous rotation (no 359°→0° jump): accumulate the shortest step
  const rot = useSharedValue(0);
  const last = useRef(0);
  useEffect(() => {
    if (heading === null) return;
    const step = angleDiff(-heading, last.current);
    last.current += step;
    rot.set(withSpring(last.current, { damping: 22, stiffness: 120, mass: 0.6 }));
  }, [heading, rot]);
  const dialStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.get()}deg` }] }));

  const glow = useSharedValue(0);
  const wasAligned = useRef(false);
  useEffect(() => {
    glow.set(withTiming(aligned ? 1 : 0, { duration: 250 }));
    if (aligned && !wasAligned.current) haptic.success();
    wasAligned.current = aligned;
  }, [aligned, glow]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: glow.get(), transform: [{ scale: 0.96 + glow.get() * 0.04 }] }));

  const sun = prayerTimesFor(date, s);
  const sunTomorrow = prayerTimesFor(addDays(date, 1), s);
  const dayMin = Math.round((sun.sunset.getTime() - sun.sunrise.getTime()) / 60_000);
  const isDay = now >= sun.sunrise && now < sun.sunset;
  const nextSun = isDay ? { label: tr.qibla.sunsetIn, at: sun.sunset } : { label: tr.qibla.sunriseIn, at: now < sun.sunrise ? sun.sunrise : sunTomorrow.sunrise };
  const mins = Math.max(0, Math.round((nextSun.at.getTime() - now.getTime()) / 60_000));

  const relocate = async () => {
    setBusy(true);
    const r = await locateMe();
    setBusy(false);
    if (r === 'ok') {
      haptic.success();
      toast(tr.qibla.updated, 'location');
    } else toast(r === 'denied' ? tr.qibla.denied : tr.qibla.failed, 'alert-circle-outline');
  };

  const cardinal = [tr.qibla.n, tr.qibla.e, tr.qibla.s, tr.qibla.w];

  return (
    <Screen title={tr.qibla.title} subtitle={tr.qibla.sub} back>
      {/* location */}
      <Animated.View entering={FadeInDown.duration(350)}>
        <Card style={styles.locCard}>
          <View style={[styles.locIcon, { backgroundColor: t.primarySoft }]}>
            <Ionicons name="location" size={20} color={t.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: t.text, fontWeight: '600' }]} numberOfLines={1}>
              {s.location ? (loc.label ?? `${n(loc.lat.toFixed(3))}, ${n(loc.lng.toFixed(3))}`) : tr.qibla.defaultLoc}
            </Text>
            <Text style={[font.tiny, { color: t.muted, fontWeight: '500' }]}>{tr.qibla.offlineNote}</Text>
          </View>
          {Platform.OS !== 'web' && <Button small kind="soft" icon="locate" label={busy ? '…' : tr.qibla.setLoc} onPress={relocate} disabled={busy} />}
        </Card>
      </Animated.View>

      {/* compass */}
      <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.compassWrap}>
        <View style={[styles.pointer, { borderBottomColor: aligned ? t.success : t.primary }]} />
        <View style={{ width: DIAL, height: DIAL }}>
          <Animated.View style={[StyleSheet.absoluteFill, styles.ring, { borderColor: t.success }, ringStyle]} pointerEvents="none" />
          <Animated.View style={[StyleSheet.absoluteFill, dialStyle]}>
            <Dial qibla={qibla} cardinal={cardinal} />
          </Animated.View>
        </View>
        <View style={[styles.status, { backgroundColor: aligned ? t.successSoft : t.surface2 }]}>
          <Ionicons name={aligned ? 'checkmark-circle' : hasCompass ? 'navigate' : 'compass-outline'} size={18} color={aligned ? t.success : t.muted} />
          <Text style={[font.small, { color: aligned ? t.success : t.text, fontWeight: '600' }]}>
            {!hasCompass
              ? tr.qibla.noSensor
              : aligned
                ? tr.qibla.facing
                : diff > 0
                  ? tr.qibla.turnRight(n(Math.round(Math.abs(diff))))
                  : tr.qibla.turnLeft(n(Math.round(Math.abs(diff))))}
          </Text>
        </View>
        <Text style={[font.small, { color: t.muted, marginTop: 10, textAlign: 'center' }]}>
          {tr.qibla.bearing(n(qibla.toFixed(1)))} · {tr.qibla.distance(n(Math.round(km).toLocaleString('en-US')))}
        </Text>
        {hasCompass && accuracy < 2 && (
          <Text style={[font.tiny, { color: t.gold, marginTop: 6, textAlign: 'center', fontWeight: '600' }]}>{tr.qibla.calibrate}</Text>
        )}
      </Animated.View>

      {/* sun times */}
      <Animated.View entering={FadeInDown.delay(140).duration(400)}>
        <Text style={[font.h3, { color: t.text, marginTop: 26, marginBottom: 12 }]}>{tr.qibla.sunTitle}</Text>
        <Card style={[styles.sunHero, { backgroundColor: t.hero }]}>
          <Text style={[font.small, { color: '#FFB48A' }]}>{nextSun.label}</Text>
          <Text style={[font.display, { color: '#fff', fontSize: 34 }]}>
            {n(Math.floor(mins / 60))}{tr.qibla.h} {n(mins % 60)}{tr.qibla.m}
          </Text>
          <SunArc sunrise={sun.sunrise} sunset={sun.sunset} now={now} />
        </Card>
        <View style={styles.sunGrid}>
          <SunTile icon="sunny" label={tr.qibla.sunrise} value={n(formatClock(sun.sunrise, lang))} color={t.gold} bg={t.goldSoft} />
          <SunTile icon="moon" label={tr.qibla.sunset} value={n(formatClock(sun.sunset, lang))} color={t.primary} bg={t.primarySoft} />
          <SunTile icon="sunny-outline" label={tr.qibla.noon} value={n(formatClock(sun.noon, lang))} color={t.lavenderInk} bg={t.lavenderSoft} />
          <SunTile icon="hourglass-outline" label={tr.qibla.dayLength} value={`${n(Math.floor(dayMin / 60))}${tr.qibla.h} ${n(dayMin % 60)}${tr.qibla.m}`} color={t.success} bg={t.successSoft} />
        </View>
        <Card style={{ marginTop: 10 }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text style={[font.small, { color: t.muted }]}>{tr.qibla.tomorrow}</Text>
            <Text style={[font.small, { color: t.text, fontWeight: '600' }]}>
              ☀ {n(formatClock(sunTomorrow.sunrise, lang))}   ·   ☾ {n(formatClock(sunTomorrow.sunset, lang))}
            </Text>
          </Row>
        </Card>
      </Animated.View>
    </Screen>
  );
}

/** Compass rose. Rotated as a whole by −heading so north stays north. */
const Dial = React.memo(function Dial({ qibla, cardinal }: { qibla: number; cardinal: string[] }) {
  const t = useTheme();
  const c = DIAL / 2;
  const r = c - 8;
  const ticks = [];
  for (let i = 0; i < 72; i++) {
    const a = i * 5;
    const major = a % 30 === 0;
    const len = major ? 14 : 7;
    ticks.push(
      <Line
        key={i}
        x1={c}
        y1={c - r + 4}
        x2={c}
        y2={c - r + 4 + len}
        stroke={major ? t.text : t.faint}
        strokeWidth={major ? 2.4 : 1.4}
        strokeLinecap="round"
        transform={`rotate(${a} ${c} ${c})`}
      />,
    );
  }
  const labelR = r - 34;
  return (
    <Svg width={DIAL} height={DIAL}>
      <Circle cx={c} cy={c} r={r} fill={t.surface} stroke={t.border} strokeWidth={2} />
      <Circle cx={c} cy={c} r={r - 52} fill={t.bg} />
      {ticks}
      {cardinal.map((label, i) => {
        const a = (i * 90 * Math.PI) / 180;
        return (
          <SvgText
            key={label}
            x={c + labelR * Math.sin(a)}
            y={c - labelR * Math.cos(a) + 7}
            fontSize={i === 0 ? 20 : 17}
            fontWeight="700"
            fill={i === 0 ? t.primary : t.text}
            textAnchor="middle"
          >
            {label}
          </SvgText>
        );
      })}
      {/* qibla needle + Ka'bah on the rim */}
      <G transform={`rotate(${qibla} ${c} ${c})`}>
        <Line x1={c} y1={c} x2={c} y2={c - r + 46} stroke={t.primary} strokeWidth={4} strokeLinecap="round" />
        <G transform={`translate(${c - 15} ${c - r + 10})`}>
          <Rect x={0} y={4} width={30} height={26} rx={3} fill="#16151A" />
          <Rect x={0} y={10} width={30} height={4} fill="#E9A93A" />
          <Path d="M0 7 L15 0 L30 7" fill="#2A2830" />
        </G>
      </G>
      <Circle cx={c} cy={c} r={9} fill={t.primary} />
      <Circle cx={c} cy={c} r={4} fill="#fff" />
    </Svg>
  );
});

/** Sun position along today's daylight arc. */
function SunArc({ sunrise, sunset, now }: { sunrise: Date; sunset: Date; now: Date }) {
  const w = 280;
  const h = 70;
  const p = Math.min(1, Math.max(0, (now.getTime() - sunrise.getTime()) / (sunset.getTime() - sunrise.getTime())));
  const x = 10 + p * (w - 20);
  const y = h - 6 - Math.sin(p * Math.PI) * (h - 20);
  return (
    <Svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ marginTop: 10 }}>
      <Path d={`M10 ${h - 6} Q ${w / 2} ${-h + 30} ${w - 10} ${h - 6}`} stroke="rgba(255,255,255,0.25)" strokeWidth={2} strokeDasharray="4 6" fill="none" />
      <Line x1={0} y1={h - 6} x2={w} y2={h - 6} stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
      <Circle cx={x} cy={y} r={11} fill="#FFB48A" opacity={0.35} />
      <Circle cx={x} cy={y} r={7} fill="#FFB48A" />
    </Svg>
  );
}

function SunTile({ icon, label, value, color, bg }: { icon: IconName; label: string; value: string; color: string; bg: string }) {
  const t = useTheme();
  return (
    <Card style={styles.sunTile}>
      <View style={[styles.sunIcon, { backgroundColor: bg }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <Text style={[font.tiny, { color: t.muted, fontWeight: '500', marginTop: 10 }]}>{label}</Text>
      <Text style={[font.h3, { color: t.text }]}>{value}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  locCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  locIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  compassWrap: { alignItems: 'center', marginTop: 22 },
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 18,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginBottom: 6,
  },
  ring: { borderRadius: DIAL / 2, borderWidth: 6 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.pill, marginTop: 18 },
  sunHero: { borderWidth: 0 },
  sunGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  sunTile: { width: '48.5%', flexGrow: 1, flexBasis: '45%' },
  sunIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
