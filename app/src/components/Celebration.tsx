import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { success } from '../lib/haptics';
import { colors, glow } from '../lib/theme';

const BITS = [colors.accent, colors.neon, colors.pink, colors.purple, colors.win];
const N = 28;

export interface CelebrationInfo {
  title: string;
  subtitle?: string;
  color?: string;
}

/** Full-screen burst of stars and confetti with a big headline. Tap or wait to dismiss. */
export function Celebration({ info, onDone }: { info: CelebrationInfo | null; onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const bits = useMemo(
    () =>
      Array.from({ length: N }, (_, i) => {
        const angle = (i / N) * Math.PI * 2 + Math.random() * 0.4;
        const dist = 120 + Math.random() * 140;
        return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, color: BITS[i % BITS.length], star: i % 3 === 0, spin: (Math.random() - 0.5) * 720, size: 10 + Math.random() * 10 };
      }),
    // A fresh burst each time a new celebration starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info],
  );

  useEffect(() => {
    if (!info) return;
    success();
    t.setValue(0);
    pop.setValue(0);
    Animated.parallel([
      Animated.timing(t, { toValue: 1, duration: 1300, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, bounciness: 16, speed: 10 }),
    ]).start();
    const id = setTimeout(onDone, 2200);
    return () => clearTimeout(id);
  }, [info, t, pop, onDone]);

  if (!info) return null;
  const color = info.color ?? colors.accent;
  return (
    <Pressable style={styles.wrap} onPress={onDone}>
      <View style={styles.center} pointerEvents="none">
        {bits.map((b, i) => (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              opacity: t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, b.dx] }) },
                { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, b.dy + 60] }) },
                { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${b.spin}deg`] }) },
              ],
            }}
          >
            {b.star ? (
              <Ionicons name="star" size={b.size + 6} color={b.color} />
            ) : (
              <View style={{ width: b.size, height: b.size / 2, backgroundColor: b.color, borderRadius: 2 }} />
            )}
          </Animated.View>
        ))}
        <Animated.View style={{ alignItems: 'center', transform: [{ scale: pop }] }}>
          <Text style={[styles.title, { color }, glow(color, 18)]}>{info.title}</Text>
          {info.subtitle && <Text style={styles.sub}>{info.subtitle}</Text>}
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(5,3,20,0.72)', zIndex: 50 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 38, fontWeight: '900', textAlign: 'center', letterSpacing: 1, paddingHorizontal: 24 },
  sub: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 8, textAlign: 'center' },
});
