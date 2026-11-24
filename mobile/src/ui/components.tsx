import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  FadeInDown,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Path, Pattern, Rect, Stop } from 'react-native-svg';
import { haptic } from './haptics';
import { font, radius, space, useTheme, type Theme } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
export { Ionicons };

// ── Layout ──────────────────────────────────────────────────────────────

export function Screen({
  title,
  subtitle,
  right,
  back,
  children,
  scroll = true,
  padded = true,
}: {
  title?: string;
  subtitle?: string;
  right?: React.ReactNode;
  back?: boolean;
  children: React.ReactNode;
  scroll?: boolean;
  padded?: boolean;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const header = title ? (
    <View style={[styles.header, { paddingTop: insets.top + space(3) }]}>
      {back && (
        <Pressable
          hitSlop={12}
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          style={[styles.backBtn, { backgroundColor: t.surface, borderColor: t.border }]}
          accessibilityRole="button"
        >
          <Ionicons name="chevron-back" size={20} color={t.text} />
        </Pressable>
      )}
      <View style={{ flex: 1 }}>
        <Text style={[back ? font.h2 : font.h1, { color: t.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? <Text style={[font.small, { color: t.muted, marginTop: 2 }]}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  ) : (
    <View style={{ height: insets.top }} />
  );
  const body = padded ? <View style={{ paddingHorizontal: space(4) }}>{children}</View> : children;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + 120 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {header}
          {body}
        </ScrollView>
      ) : (
        <>
          {header}
          <View style={{ flex: 1 }}>{body}</View>
        </>
      )}
    </View>
  );
}

export function Section({ title, action, children, delay = 0 }: { title?: string; action?: React.ReactNode; children: React.ReactNode; delay?: number }) {
  const t = useTheme();
  return (
    <Animated.View entering={FadeInDown.delay(delay).duration(380).springify().damping(18)} style={{ marginTop: space(5) }}>
      {title ? (
        <View style={styles.sectionHead}>
          <Text style={[font.h3, { color: t.text }]}>{title}</Text>
          {action}
        </View>
      ) : null}
      {children}
    </Animated.View>
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
  // Outer layout (flex / margins / alignment) must live on the Pressable so the
  // component sizes like a plain View; visuals stay on the animated child.
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
  const base = [styles.card, cardShadow(t), { backgroundColor: t.surface, borderColor: t.border }, style];
  if (!onPress && !onLongPress) return <View style={base}>{children}</View>;
  return (
    <PressableScale onPress={onPress} onLongPress={onLongPress} style={base}>
      {children}
    </PressableScale>
  );
}

export const cardShadow = (t: Theme): ViewStyle => ({
  shadowColor: t.dark ? '#000' : '#0B3B2C',
  shadowOpacity: t.dark ? 0.3 : 0.06,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
});

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
  kind?: 'primary' | 'ghost' | 'danger' | 'soft';
  icon?: IconName;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, ghost: 'transparent', danger: t.dangerSoft, soft: t.primarySoft }[kind];
  const fg = { primary: t.onPrimary, ghost: t.primary, danger: t.danger, soft: t.primary }[kind];
  return (
    <PressableScale
      disabled={disabled}
      onPress={() => {
        haptic.light();
        onPress();
      }}
      style={[
        styles.btn,
        small && { paddingVertical: 8, paddingHorizontal: 14 },
        { backgroundColor: bg, opacity: disabled ? 0.5 : 1, borderColor: kind === 'ghost' ? t.border : 'transparent' },
        style,
      ]}
      accessibilityRole="button"
    >
      {icon && <Ionicons name={icon} size={small ? 16 : 18} color={fg} />}
      <Text style={[font.body, { color: fg, fontWeight: '700' }]}>{label}</Text>
    </PressableScale>
  );
}

export function IconButton({ icon, onPress, color, bg, size = 40 }: { icon: IconName; onPress: () => void; color?: string; bg?: string; size?: number }) {
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
        backgroundColor: bg ?? t.surface,
        borderWidth: bg ? 0 : StyleSheet.hairlineWidth,
        borderColor: t.border,
      }}
      accessibilityRole="button"
    >
      <Ionicons name={icon} size={size * 0.5} color={color ?? t.text} />
    </PressableScale>
  );
}

export function Fab({ onPress, icon = 'add' }: { onPress: () => void; icon?: IconName }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Animated.View entering={FadeInDown.delay(250).springify()} style={[styles.fab, { bottom: insets.bottom + 92 }]}>
      <PressableScale
        onPress={() => {
          haptic.medium();
          onPress();
        }}
        scaleTo={0.9}
        style={[styles.fabInner, { backgroundColor: t.primary, shadowColor: t.primary }]}
        accessibilityRole="button"
      >
        <Ionicons name={icon} size={28} color={t.onPrimary} />
      </PressableScale>
    </Animated.View>
  );
}

// ── Inputs ──────────────────────────────────────────────────────────────

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const t = useTheme();
  return (
    <View style={{ marginBottom: space(3) }}>
      <Text style={[font.small, { color: t.muted, marginBottom: 6 }]}>{label}</Text>
      <TextInput
        placeholderTextColor={t.faint}
        {...props}
        style={[
          styles.input,
          { backgroundColor: t.surface, borderColor: error ? t.danger : t.border, color: t.text },
          props.multiline && { minHeight: 80, textAlignVertical: 'top' },
          props.style,
        ]}
      />
      {error ? <Text style={[font.small, { color: t.danger, marginTop: 4 }]}>{error}</Text> : null}
    </View>
  );
}

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
    <View style={[styles.segment, { backgroundColor: t.surface2 }]}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => {
              haptic.tap();
              onChange(o.value);
            }}
            style={[styles.segmentItem, active && [{ backgroundColor: t.surface }, cardShadow(t)]]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text style={[font.small, { color: active ? t.text : t.muted, fontWeight: active ? '700' : '600' }]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, active, onPress, color, icon }: { label: string; active?: boolean; onPress?: () => void; color?: string; icon?: IconName }) {
  const t = useTheme();
  const c = color ?? t.primary;
  return (
    <PressableScale
      onPress={() => {
        haptic.tap();
        onPress?.();
      }}
      style={[styles.chip, { backgroundColor: active ? c : t.surface, borderColor: active ? c : t.border }]}
    >
      {icon && <Ionicons name={icon} size={14} color={active ? '#fff' : t.muted} />}
      <Text style={[font.small, { color: active ? '#fff' : t.text, fontWeight: '600' }]}>{label}</Text>
    </PressableScale>
  );
}

export function ToggleRow({ label, hint, value, onChange, icon }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void; icon?: IconName }) {
  const t = useTheme();
  return (
    <View style={styles.toggleRow}>
      {icon && (
        <View style={[styles.rowIcon, { backgroundColor: t.primarySoft }]}>
          <Ionicons name={icon} size={18} color={t.primary} />
        </View>
      )}
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
        trackColor={{ true: t.primary, false: t.border }}
        thumbColor="#fff"
      />
    </View>
  );
}

export function ListRow({
  icon,
  iconColor,
  label,
  value,
  onPress,
  danger,
}: {
  icon: IconName;
  iconColor?: string;
  label: string;
  value?: string;
  onPress?: () => void;
  danger?: boolean;
}) {
  const t = useTheme();
  const c = danger ? t.danger : iconColor ?? t.primary;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.toggleRow, pressed && { opacity: 0.6 }]} accessibilityRole="button">
      <View style={[styles.rowIcon, { backgroundColor: danger ? t.dangerSoft : t.primarySoft }]}>
        <Ionicons name={icon} size={18} color={c} />
      </View>
      <Text style={[font.body, { color: danger ? t.danger : t.text, flex: 1 }]}>{label}</Text>
      {value ? <Text style={[font.small, { color: t.muted }]}>{value}</Text> : null}
      {onPress && <Ionicons name="chevron-forward" size={18} color={t.faint} />}
    </Pressable>
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
      <View style={[styles.emptyIcon, { backgroundColor: t.primarySoft }]}>
        <Ionicons name={icon} size={30} color={t.primary} />
      </View>
      <Text style={[font.body, { color: t.muted, textAlign: 'center', marginTop: space(3) }]}>{text}</Text>
      {action ? <View style={{ marginTop: space(4) }}>{action}</View> : null}
    </Animated.View>
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
    p.set(withTiming(Math.max(0, Math.min(1, progress)), { duration: 700, easing: Easing.out(Easing.cubic) }));
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
    w.set(withTiming(Math.max(0, Math.min(1, progress)), { duration: 600, easing: Easing.out(Easing.cubic) }));
  }, [progress, w]);
  const a = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track ?? t.surface2, overflow: 'hidden' }}>
      <Animated.View style={[{ height, borderRadius: height, backgroundColor: color ?? t.primary }, a]} />
    </View>
  );
}

// ── Decoration ──────────────────────────────────────────────────────────

/** Subtle eight-point star (Rub el Hizb) lattice used behind hero cards. */
export function IslamicPattern({ color = '#ffffff', opacity = 0.08 }: { color?: string; opacity?: number }) {
  const s = 44;
  const h = s / 2;
  const q = s * 0.29;
  const star = `M${h} ${h - q} L${h + q * 0.38} ${h - q * 0.38} L${h + q} ${h} L${h + q * 0.38} ${h + q * 0.38} L${h} ${h + q} L${h - q * 0.38} ${h + q * 0.38} L${h - q} ${h} L${h - q * 0.38} ${h - q * 0.38} Z`;
  const sq = `M${h - q * 0.7} ${h - q * 0.7} H${h + q * 0.7} V${h + q * 0.7} H${h - q * 0.7} Z`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <Pattern id="rub" patternUnits="userSpaceOnUse" width={s} height={s}>
          <Path d={star} stroke={color} strokeWidth={1} fill="none" opacity={opacity * 10} />
          <Path d={sq} stroke={color} strokeWidth={1} fill="none" opacity={opacity * 10} />
        </Pattern>
        <SvgGradient id="fade" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#fff" stopOpacity={opacity} />
          <Stop offset="1" stopColor="#fff" stopOpacity={0} />
        </SvgGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#rub)" opacity={opacity} />
    </Svg>
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
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: space(4), paddingBottom: space(2) },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  card: { borderRadius: radius.lg, padding: space(4), borderWidth: StyleSheet.hairlineWidth },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  fab: { position: 'absolute', right: 20 },
  fabInner: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 4 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: radius.sm + 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.pill, borderWidth: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  empty: { alignItems: 'center', paddingVertical: space(10), paddingHorizontal: space(6) },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
});
