import { router } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useContests } from '../lib/contests';
import { tap } from '../lib/haptics';
import { colors, kindColor, space } from '../lib/theme';
import { GameButton } from './GameButton';

/** The bar at the top of Games, Points and My Picks: which contest you're playing. */
export function ContestSwitcher() {
  const { playable, active, setActive, loaded } = useContests();
  if (!loaded) return null;
  if (playable.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Everything happens inside a contest. Join one to get points and make picks.</Text>
        <GameButton title="Find a contest" variant="pink" size="sm" icon="trophy" onPress={() => router.push('/contests')} />
      </View>
    );
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bar} contentContainerStyle={styles.inner}>
      <Text style={styles.label}>PLAYING</Text>
      {playable.map((c) => {
        const on = c.id === active?.id;
        const color = kindColor[c.kind];
        return (
          <Pressable
            key={c.id}
            onPress={() => {
              tap();
              setActive(c.id);
            }}
            style={[styles.chip, { borderColor: on ? color : colors.border }, on && { backgroundColor: `${color}22` }]}
          >
            <Text style={[styles.chipName, { color: on ? color : colors.muted }]} numberOfLines={1}>
              {c.name}
            </Text>
            <Text style={[styles.chipPts, { color: on ? colors.accent : colors.muted }]}>{c.mine?.balance ?? 0} pts</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, flexShrink: 0, borderBottomWidth: 2, borderBottomColor: colors.border, backgroundColor: colors.bg },
  inner: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm, alignItems: 'center' },
  label: { color: colors.muted, fontWeight: '900', fontSize: 11, letterSpacing: 1.5 },
  chip: { borderWidth: 2, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 12, maxWidth: 220 },
  chipName: { fontWeight: '900', fontSize: 13 },
  chipPts: { fontWeight: '800', fontSize: 12 },
  empty: { margin: space.lg, padding: space.lg, gap: space.md, borderRadius: 16, borderWidth: 2, borderColor: colors.pink, backgroundColor: colors.card },
  emptyText: { color: colors.text, fontWeight: '700', lineHeight: 20 },
});
