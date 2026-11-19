// Choose how many points to use: any whole number from 1 up to `max`.
// The - and + buttons move by 1, and the chips jump to common amounts.

import { Pressable, StyleSheet, Text, View } from 'react-native';
import { tap } from '../lib/haptics';
import { colors, glow, space } from '../lib/theme';
import { GameButton } from './GameButton';
import { PointsCounter } from './PointsCounter';

const CHIPS = [1, 5, 10, 25, 50, 100];

export function PointsPicker({ value, max: rawMax, onChange, suffix = ' pts' }: { value: number; max: number; onChange: (n: number) => void; suffix?: string }) {
  // Picks are whole points, even when the balance has hundredths (16.66 -> up to 16).
  const max = Math.floor(rawMax);
  const set = (n: number) => onChange(Math.max(1, Math.min(max, n)));
  const chips = [...CHIPS.filter((c) => c < max), max].filter((v, i, a) => v >= 1 && a.indexOf(v) === i);
  return (
    <View style={{ gap: space.md }}>
      <View style={styles.stepper}>
        <GameButton variant="neon" size="sm" style={styles.step} disabled={value <= 1} onPress={() => set(value - 1)}>
          <Text style={styles.stepText}>-</Text>
        </GameButton>
        <PointsCounter value={value} suffix={suffix} style={[styles.points, glow(colors.accent, 10)]} />
        <GameButton variant="neon" size="sm" style={styles.step} disabled={value >= max} onPress={() => set(value + 1)}>
          <Text style={styles.stepText}>+</Text>
        </GameButton>
      </View>
      <View style={styles.chips}>
        {chips.map((c) => (
          <Pressable
            key={c}
            style={[styles.chip, value === c && styles.chipOn]}
            onPress={() => {
              tap();
              set(c);
            }}
            accessibilityRole="button"
            accessibilityLabel={c === max ? `Max, ${c} points` : `${c} points`}
          >
            <Text style={[styles.chipText, value === c && styles.chipTextOn]}>{c === max ? `Max ${c}` : c}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: space.sm },
  step: { width: 52 },
  stepText: { color: '#022A30', fontSize: 24, fontWeight: '900' },
  points: { color: colors.accent, fontSize: 32, fontWeight: '900', minWidth: 130, textAlign: 'center' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardAlt },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '800' },
  chipTextOn: { color: colors.accentText, fontWeight: '900' },
});
