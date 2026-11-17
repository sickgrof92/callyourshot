// A two-handle slider for picking a whole-number range, e.g. 1 to 30+ days.
// Built on PanResponder so it needs no extra package and works on iOS,
// Android and web.

import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { tap } from '../lib/haptics';
import { colors } from '../lib/theme';

const THUMB = 28;

export function RangeSlider({
  min,
  max,
  low,
  high,
  onChange,
  accessibilityLabel,
}: {
  min: number;
  max: number;
  low: number;
  high: number;
  onChange: (low: number, high: number) => void;
  accessibilityLabel?: string;
}) {
  const [width, setWidth] = useState(0);
  // Latest values for the gesture handlers, which are created once.
  const state = useRef({ low, high, width, onChange });
  state.current = { low, high, width, onChange };
  const steps = max - min;

  const toValue = (x: number) => {
    const w = Math.max(state.current.width - THUMB, 1);
    return Math.round(min + (Math.min(Math.max(x, 0), w) / w) * steps);
  };
  const toX = (v: number) => ((v - min) / steps) * Math.max(width - THUMB, 0);

  const handle = (which: 'low' | 'high') => {
    let startX = 0;
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const s = state.current;
        const w = Math.max(s.width - THUMB, 1);
        startX = (((which === 'low' ? s.low : s.high) - min) / steps) * w;
      },
      onPanResponderMove: (_e, g) => {
        const s = state.current;
        const v = toValue(startX + g.dx);
        if (which === 'low') {
          const next = Math.min(v, s.high);
          if (next !== s.low) {
            tap();
            s.onChange(next, s.high);
          }
        } else {
          const next = Math.max(v, s.low);
          if (next !== s.high) {
            tap();
            s.onChange(s.low, next);
          }
        }
      },
    });
  };
  const lowPan = useRef(handle('low')).current;
  const highPan = useRef(handle('high')).current;

  const step = (which: 'low' | 'high', by: number) => {
    if (which === 'low') onChange(Math.min(Math.max(low + by, min), high), high);
    else onChange(low, Math.max(Math.min(high + by, max), low));
  };

  return (
    <View style={styles.wrap} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)} accessibilityLabel={accessibilityLabel}>
      <View style={styles.track} />
      <View style={[styles.fill, { left: toX(low) + THUMB / 2, width: Math.max(toX(high) - toX(low), 0) }]} />
      <View
        {...lowPan.panHandlers}
        style={[styles.thumb, { left: toX(low) }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Shortest length"
        accessibilityValue={{ min, max, now: low }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step('low', e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      />
      <View
        {...highPan.panHandlers}
        style={[styles.thumb, { left: toX(high) }]}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Longest length"
        accessibilityValue={{ min, max, now: high }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step('high', e.nativeEvent.actionName === 'increment' ? 1 : -1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: THUMB + 12, justifyContent: 'center' },
  track: { position: 'absolute', left: THUMB / 2, right: THUMB / 2, height: 6, borderRadius: 3, backgroundColor: colors.border },
  fill: { position: 'absolute', height: 6, borderRadius: 3, backgroundColor: colors.neon },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.text,
    borderWidth: 4,
    borderColor: colors.neon,
    shadowColor: colors.neon,
    shadowOpacity: 0.7,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
});
