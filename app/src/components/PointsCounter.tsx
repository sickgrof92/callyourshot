import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, type StyleProp, type TextStyle } from 'react-native';

/** A number that rolls up or down to its new value and pops when it changes. */
export function PointsCounter({ value, style, suffix = '' }: { value: number; style?: StyleProp<TextStyle>; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const roll = useRef(new Animated.Value(value)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    const id = roll.addListener(({ value: v }) => setShown(Math.round(v)));
    return () => roll.removeListener(id);
  }, [roll]);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    Animated.timing(roll, { toValue: value, duration: 700, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.sequence([
      Animated.timing(pop, { toValue: 1.25, duration: 140, useNativeDriver: true }),
      Animated.spring(pop, { toValue: 1, useNativeDriver: true, bounciness: 14 }),
    ]).start();
  }, [value, roll, pop]);

  return (
    <Animated.Text style={[style, { transform: [{ scale: pop }] }]}>
      {shown}
      {suffix}
    </Animated.Text>
  );
}
