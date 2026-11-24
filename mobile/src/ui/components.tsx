import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Stop } from 'react-native-svg';
import { haptic } from './haptics';
import { Text, TextInput } from './Text';
import { font, radius, space, useTheme, type Theme } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export { Ionicons, Text, TextInput };

// ── Decoration ──────────────────────────────────────────────────────────

/** Soft lavender corner blob — the app's ambient signature shape. */
export function Blob({ color, size = 260, style }: { color?: string; size?: number; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  const c = color ?? t.lavender;
  return (
    <View pointerEvents="none" style={[{ position: 'absolute', top: 0, right: 0, width: size, height: size * 0.62 }, style]}>
      <Svg width="100%" height="100%" viewBox="0 0 260 160">
        <Defs>
          <SvgGradient id="blob" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c} stopOpacity={t.dark ? 0.35 : 0.55} />
            <Stop offset="1" stopColor={c} stopOpacity={t.dark ? 0.15 : 0.9} />
          </SvgGradient>
        </Defs>
        <Path d="M70 0 H260 V160 C230 150 214 118 188 112 C150 103 128 128 96 104 C66 82 92 46 70 0 Z" fill="url(#blob)" />
      </Svg>
    </View>
  );
}

/** Eight-point star (khatam) — small Islamic ornament. */
export function Khatam({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Path d="M50 4 L61 25 L83 17 L75 39 L96 50 L75 61 L83 83 L61 75 L50 96 L39 75 L17 83 L25 61 L4 50 L25 39 L17 17 L39 25 Z" fill={color} />
    </Svg>
  );
}

// ── Layout ──────────────────────────────────────────────────────────────

export function Screen({
  title,
  subtitle,
  eyebrow,
  right,
  back,
  children,
  blob = true,
}: {
  title?: string;
  subtitle?: string;
  eyebrow?: string;
  right?: React.ReactNode;
  back?: boolean;
  children: React.ReactNode;
  blob?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {blob && <Blob />}
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 130 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={[styles.header, { paddingTop: insets.top + space(4) }]}>
          {back ? (
            <IconButton icon="chevron-back" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
          ) : null}
          <View style={{ flex: 1 }} />
          {right}
        </View>
        {title ? (
          <Animated.View entering={FadeInDown.duration(380)} style={styles.titleBlock}>
            {eyebrow ? <Text style={[font.small, { color: t.muted }]}>{eyebrow}</Text> : null}
            <Text style={[font.display, { color: t.text }]}>{title}</Text>
            {subtitle ? <Text style={[font.small, { color: t.muted, marginTop: 4 }]}>{subtitle}</Text> : null}
          </Animated.View>
        ) : null}
        <View style={{ paddingHorizontal: space(5) }}>{children}</View>
      </ScrollView>
    </View>
  );
}

export function Section({ title, action, children, delay = 0 }: { title?: string; action?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(420).springify().damping(20)} style={{ marginTop: space(7) }}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={[font.h2, { color: t.text }]}>{title}</Text>
          {action}
        </View>
      ) : null}
      {children}
    </Animated.View>
  );
}

export function SeeAll({ label, onPress }: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={10} style={styles.seeAll} accessibilityRole="link">
      <Text style={[font.small, { color: t.muted }]}>{label}</Text>
      <View style={[styles.seeAllIcon, { backgroundColor: t.ink }]}>
        <Ionicons name="chevron-forward" size={11} color={t.onInk} />
      </View>
    </Pressable>
  );
}

export function Row({ children, style, gap = 8 }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

// ── Pressables ──────────────────────────────────────────────────────────

export function PressableScale({
  children,
  style,
  scaleTo = 0.97,
  onPress,
  ...rest
}: PressableProps & { style?: StyleProp<ViewStyle>; scaleTo?: number; children: React.ReactNode }) {
  const s = useSharedValue(1);
  const a = useAnimatedStyle(() => ({ transform: [{ scale: s.value }] }));
  // Outer layout (flex / margins / position) lives on the Pressable so it sizes
  // like a plain View; visuals stay on the animated child.
  const flat = StyleSheet.flatten(style) ?? {};
  const { flex, flexGrow, flexShrink, flexBasis, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, position, top, left, right, bottom, ...inner } = flat;
  const outer = { flex, flexGrow, flexShrink, flexBasis, alignSelf, margin, marginTop, marginBottom, marginLeft, marginRight, marginHorizontal, marginVertical, position, top, left, right, bottom };
  return (
    <Pressable
      style={outer}
      {...rest}
      onPress={onPress}
      onPressIn={(e) => {
        s.set(withSpring(scaleTo, { damping: 20, stiffness: 400 }));
        rest.onPressIn?.(e);
      }}
      onPressOut={(e) => {
        s.set(withSpring(1, { damping: 14, stiffness: 300 }));
        rest.onPressOut?.(e);
      }}
    >
      <Animated.View style={[inner, flex != null && { flexGrow: 1 }, a]}>{children}</Animated.View>
    </Pressable>
  );
}

export const cardShadow = (t: Theme): ViewStyle => ({
  shadowColor: t.shadow,
  shadowOpacity: t.dark ? 0.4 : 0.08,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: t.dark ? 0 : 3,
});

export function Card({
  children,
  style,
  onPress,
  onLongPress,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const base = [styles.card, cardShadow(t), { backgroundColor: t.surface, borderColor: t.dark ? t.border : 'transparent' }, style];
  if (!onPress && !onLongPress) return <View style={base}>{children}</View>;
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} style={base}>
      {children}
    </PressableScale>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  icon,
  disabled,
  style,
  small,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'accent' | 'ghost' | 'danger' | 'soft';
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const t = useTheme();
  const bg = { primary: t.ink, accent: t.primary, ghost: 'transparent', danger: t.dangerSoft, soft: t.primarySoft }[kind];
  const fg = { primary: t.onInk, accent: t.onPrimary, ghost: t.text, danger: t.danger, soft: t.primaryDeep }[kind];
  return (
    <PressableScale
      disabled={disabled}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={[
        styles.btn,
        small && { height: 40, paddingHorizontal: 16 },
        { backgroundColor: bg, opacity: disabled ? 0.45 : 1, borderColor: kind === 'ghost' ? t.border : 'transparent' },
        style,
      ]}
      accessibilityRole="button"
    >
      {icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />}
      <Text style={[small ? font.small : font.body, { color: fg, fontWeight: '600' }]}>{label}</Text>
    </PressableScale>
  );
}

/** Circular outlined icon button (header actions). */
export function IconButton({ icon, onPress, color, bg, size = 46, label }: { icon: IconName; onPress: () => void; color?: string; bg?: string; size?: number; label?: string }) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic.tap();
        onPress();
      }}
      hitSlop={8}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg ?? (t.dark ? t.surface : 'rgba(255,255,255,0.55)'),
        borderWidth: bg ? 0 : 1,
        borderColor: t.dark ? t.border : 'rgba(22,21,26,0.12)',
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={size * 0.44} color={color ?? t.text} />
    </PressableScale>
  );
}

export function Fab({ onPress, icon = 'add' }: { onPress: () => void; icon?: IconName }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeInDown.delay(250).springify()} style={[styles.fab, { bottom: insets.bottom + 100 }]}>
      <PressableScale
        onPress={() => {
          haptic.medium();
          onPress();
        }}
        scaleTo={0.9}
        style={[styles.fabInner, { backgroundColor: t.primary, shadowColor: t.primary }]}
        accessibilityRole="button"
      >
        <Ionicons name={icon} size={28} color="#fff" />
      </PressableScale>
    </Animated.View>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const t = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: space(4) }}>
      <Text style={[font.small, { color: t.muted, marginBottom: 8, fontWeight: '600' }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.faint}
        {...props}
        onFocus={(e) => {
          setFocus(true);
          props.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          props.onBlur?.(e);
        }}
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: error ? t.danger : focus ? t.primary : t.border, color: t.text },
          props.multiline && { minHeight: 96, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {error ? <Text style={[font.small, { color: t.danger, marginTop: 6 }]}>{error}</Text> : null}
    </View>
  );
}

/** Pill segmented control with an ink-black active pill. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: t.dark ? t.surface : 'rgba(255,255,255,0.7)' }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={[styles.segmentItem, active && { backgroundColor: t.ink }]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[font.small, { color: active ? t.onInk : t.muted, fontWeight: '600' }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress, icon }: { label: string; active?: boolean; onPress?: () => void; color?: string; icon?: IconName }) {
  const t = useTheme();
  return (
    <PressableScale
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: active ? t.ink : t.surface, borderColor: active ? t.ink : t.border }]}
    >
      {icon && <Ionicons name={icon} size={15} color={active ? t.onInk : t.muted} />}
      <Text style={[font.small, { color: active ? t.onInk : t.text, fontWeight: '600' }]}>{label}</Text>
    </PressableScale>
  );
}

export function IconBadge({ icon, color, bg, size = 44 }: { icon: IconName; color: string; bg: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={icon} size={size * 0.46} color={color} />
    </View>
  );
}

export function ToggleRow({ label, hint, value, onChange, icon }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={styles.toggleRow}>
      {icon && <IconBadge icon={icon} color={t.primary} bg={t.primarySoft} size={38} />}
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { color: t.text }]}>{label}</Text>
        {hint ? <Text style={[font.small, { color: t.muted, marginTop: 2 }]}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic.tap();
          onChange(v);
        }}
        trackColor={{ true: t.primary, false: t.surface2 }}
        thumbColor="#fff"
        ios_backgroundColor={t.surface2}
      />
    </View>
  );
}

/** Settings-style row card: soft icon circle, label, chevron. */
export function ListRow({
  icon,
  iconColor,
  iconBg,
  label,
  value,
  onPress,
  danger,
}: {
  icon: IconName;
  iconColor?: string;
  iconBg?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  return (
    <Card onPress={onPress} style={styles.listRow}>
      <IconBadge icon={icon} color={danger ? t.danger : iconColor ?? t.primary} bg={danger ? t.dangerSoft : iconBg ?? t.primarySoft} />
      <Text style={[font.body, { color: danger ? t.danger : t.text, flex: 1, fontWeight: '600' }]}>{label}</Text>
      {value ? (
        <Text style={[font.small, { color: t.muted, maxWidth: 150 }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {onPress && <Ionicons name="chevron-forward" size={20} color={t.text} />}
    </Card>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginVertical: 2 }} />;
}

export function EmptyState({ icon, text, action }: { icon: IconName; text: string; action?: React.ReactNode }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.duration(400)} style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.lavenderSoft }]}>
        <Ionicons name={icon} size={30} color={t.lavenderInk} />
      </View>
      <Text style={[font.body, { color: t.muted, textAlign: 'center', marginTop: space(4) }]}>{text}</Text>
      {action ? <View style={{ marginTop: space(5) }}>{action}</View> : null}
    </Animated.View>
  );
}

export function Avatar({ name, size = 52 }: { name?: string; size?: number }) {
  const t = useTheme();
  const initial = name?.trim()?.[0]?.toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: t.surface }}>
      {initial ? (
        <Text style={{ color: '#fff', fontSize: size * 0.42, fontWeight: '700' }}>{initial}</Text>
      ) : (
        <Ionicons name="person" size={size * 0.46} color="#fff" />
      )}
    </View>
  );
}

// ── Progress ────────────────────────────────────────────────────────────

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressRing({
  size = 120,
  stroke = 10,
  progress,
  color,
  track,
  children,
}: {
  size?: number;
  stroke?: number;
  progress: number;
  color?: string;
  track?: string;
  children?: React.ReactNode;
}) {
  const t = useTheme();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withTiming(Math.max(0, Math.min(1, progress)), { duration: 800, easing: Easing.out(Easing.cubic) }));
  }, [progress, p]);
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.value) }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track ?? t.surface2} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color ?? t.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={props}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

export function ProgressBar({ progress, color, track, height = 8 }: { progress: number; color?: string; track?: string; height?: number }) {
  const t = useTheme();
  const w = useSharedValue(0);
  useEffect(() => {
    w.set(withTiming(Math.max(0, Math.min(1, progress)), { duration: 700, easing: Easing.out(Easing.cubic) }));
  }, [progress, w]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track ?? t.surface2, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color ?? t.primary }, a]} />
    </View>
  );
}

export function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 }}>
      <Text style={[font.tiny, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space(5), minHeight: 46 },
  titleBlock: { paddingHorizontal: space(5), marginTop: space(3), marginBottom: space(1) },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  seeAllIcon: { width: 18, height: 18, borderRadius: 5, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, padding: space(5), borderWidth: StyleSheet.hairlineWidth },
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 54, paddingHorizontal: 24, borderRadius: radius.pill, borderWidth: 1 },
  fab: { position: 'absolute', right: 22 },
  fabInner: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  input: { borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 14, fontSize: 16 },
  segment: { flexDirection: 'row', borderRadius: radius.pill, padding: 5 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: radius.pill },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 42, borderRadius: radius.pill, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, marginBottom: 12 },
  empty: { alignItems: 'center', paddingVertical: space(10), paddingHorizontal: space(6) },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
});
