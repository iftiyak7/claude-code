import React, { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { useTheme } from './theme';

const Sparkle = ({ x, y, s, c }: { x: number; y: number; s: number; c: string }) => (
  <Path d={`M${x} ${y - s} Q${x} ${y} ${x + s} ${y} Q${x} ${y} ${x} ${y + s} Q${x} ${y} ${x - s} ${y} Q${x} ${y} ${x} ${y - s} Z`} fill={c} />
);

/** Mosque under a sun (day) or crescent (night). Pure SVG, gently floating. */
export function MosqueScene({ night, width = 170 }: { night: boolean; width?: number }) {
  const t = useTheme();
  const float = useSharedValue(0);
  useEffect(() => {
    float.set(withRepeat(withSequence(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), withTiming(0, { duration: 2600, easing: Easing.inOut(Easing.sin) })), -1));
  }, [float]);
  const orb = useAnimatedStyle(() => ({ transform: [{ translateY: -3 * float.value }] }));

  const h = width * 0.85;
  const body = t.dark ? '#2B2833' : '#16151A';
  const window = t.dark ? '#FFB48A' : '#FFD9C2';
  return (
    <Animated.View style={orb}>
    <Svg width={width} height={h} viewBox="0 0 200 170">
      <Defs>
        <LinearGradient id="sun" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={night ? '#D9CCFF' : '#FFB37A'} />
          <Stop offset="1" stopColor={night ? '#8E79F0' : '#F2703F'} />
        </LinearGradient>
        <LinearGradient id="dome" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={t.lavender} />
          <Stop offset="1" stopColor={t.dark ? '#5B47C9' : '#A893F5'} />
        </LinearGradient>
      </Defs>

      {/* sky orb */}
      <G>
        <Circle cx="128" cy="62" r="46" fill="url(#sun)" opacity={0.95} />
        {night && <Circle cx="146" cy="50" r="40" fill={t.surface} />}
      </G>
      <Sparkle x={40} y={30} s={7} c={night ? t.lavender : t.gold} />
      <Sparkle x={178} y={112} s={5} c={night ? t.lavender : t.primary} />
      <Sparkle x={62} y={58} s={4} c={t.primary} />

      {/* minarets */}
      <Rect x="26" y="74" width="16" height="86" rx="3" fill={body} />
      <Path d="M24 76 L34 50 L44 76 Z" fill="url(#dome)" />
      <Rect x="24" y="96" width="20" height="5" rx="2" fill="url(#dome)" />
      <Rect x="158" y="74" width="16" height="86" rx="3" fill={body} />
      <Path d="M156 76 L166 50 L176 76 Z" fill="url(#dome)" />
      <Rect x="156" y="96" width="20" height="5" rx="2" fill="url(#dome)" />

      {/* main hall + dome */}
      <Path d="M58 112 C58 78 82 64 100 52 C118 64 142 78 142 112 Z" fill="url(#dome)" />
      <Path d="M100 52 L100 38" stroke={body} strokeWidth="2.5" strokeLinecap="round" />
      <Path d="M104 33 A6 6 0 1 1 97 28 A4.5 4.5 0 1 0 104 33 Z" fill={night ? t.lavender : t.gold} />
      <Rect x="50" y="110" width="100" height="50" rx="4" fill={body} />
      {/* arches */}
      <Path d="M88 160 V138 C88 128 112 128 112 138 V160 Z" fill={window} />
      <Path d="M62 150 V134 C62 127 76 127 76 134 V150 Z" fill={window} opacity={0.85} />
      <Path d="M124 150 V134 C124 127 138 127 138 134 V150 Z" fill={window} opacity={0.85} />
      <Rect x="20" y="158" width="160" height="6" rx="3" fill={body} />
    </Svg>
    </Animated.View>
  );
}
