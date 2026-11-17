import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { tap, thump } from '../lib/haptics';
import { colors } from '../lib/theme';

export type Variant = 'primary' | 'go' | 'neon' | 'pink' | 'danger' | 'ghost';

const LOOK: Record<Variant, { face: string; edge: string; text: string }> = {
  primary: { face: colors.accent, edge: colors.accentEdge, text: colors.accentText },
  go: { face: colors.win, edge: colors.winEdge, text: '#032611' },
  neon: { face: colors.neon, edge: colors.neonEdge, text: '#022A30' },
  pink: { face: colors.pink, edge: colors.pinkEdge, text: '#FFFFFF' },
  danger: { face: colors.loss, edge: colors.lossEdge, text: '#FFFFFF' },
  ghost: { face: colors.cardAlt, edge: '#0F0B29', text: colors.text },
};

const SIZE = {
  lg: { depth: 6, pad: 16, font: 18, radius: 16 },
  md: { depth: 5, pad: 12, font: 16, radius: 14 },
  sm: { depth: 4, pad: 9, font: 13, radius: 11 },
};

interface Props {
  title?: string;
  children?: ReactNode;
  onPress?: () => void;
  variant?: Variant;
  size?: keyof typeof SIZE;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  disabled?: boolean;
  busy?: boolean;
  /** Heavier buzz for big moments (confirm, forfeit). */
  heavy?: boolean;
  caps?: boolean;
  style?: StyleProp<ViewStyle>;
  faceStyle?: StyleProp<ViewStyle>;
  selected?: boolean;
}

/** A chunky arcade button: a colored face sitting on a darker edge that sinks when pressed. */
export function GameButton({ title, children, onPress, variant = 'primary', size = 'md', icon, disabled, busy, heavy, caps = true, style, faceStyle, selected }: Props) {
  const look = LOOK[variant];
  const s = SIZE[size];
  const y = useRef(new Animated.Value(0)).current;
  const off = disabled || busy;

  const press = (down: boolean) =>
    Animated.spring(y, { toValue: down ? s.depth : 0, useNativeDriver: true, speed: 40, bounciness: down ? 0 : 10 }).start();

  return (
    <Pressable
      disabled={off}
      onPressIn={() => {
        press(true);
        if (heavy) thump();
        else tap();
      }}
      onPressOut={() => press(false)}
      onPress={onPress}
      style={[{ paddingBottom: s.depth, opacity: disabled ? 0.45 : 1 }, style]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[StyleSheet.absoluteFill, { top: s.depth, backgroundColor: look.edge, borderRadius: s.radius }]} />
      <Animated.View
        style={[
          styles.face,
          {
            backgroundColor: look.face,
            borderRadius: s.radius,
            paddingVertical: s.pad,
            transform: [{ translateY: y }],
            borderColor: selected ? colors.accent : 'rgba(255,255,255,0.28)',
            borderWidth: selected ? 2 : 0,
            borderTopWidth: selected ? 2 : 2,
          },
          faceStyle,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={look.text} />
        ) : (
          children ?? (
            <View style={styles.row}>
              {icon && <Ionicons name={icon} size={s.font + 3} color={look.text} />}
              <Text style={[styles.text, { color: look.text, fontSize: s.font, textTransform: caps ? 'uppercase' : 'none' }]}>{title}</Text>
            </View>
          )
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  face: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { fontWeight: '900', letterSpacing: 0.8, textAlign: 'center' },
});
