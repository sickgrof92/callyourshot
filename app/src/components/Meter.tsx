import { StyleSheet, View } from 'react-native';
import { colors } from '../lib/theme';

/** A chunky progress bar, like an XP bar. */
export function Meter({ value, max, color = colors.neon, height = 10 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={[styles.track, { height, borderRadius: height / 2 }]}>
      <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: color, borderRadius: height / 2 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { backgroundColor: '#0F0B29', borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
});
