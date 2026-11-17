import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

const PODIUM: Record<number, { fill: string; edge: string }> = {
  1: { fill: colors.gold, edge: '#B8860B' },
  2: { fill: colors.silver, edge: '#7D8799' },
  3: { fill: colors.bronze, edge: '#8A4B1E' },
};

/** Gold, silver and bronze badges for the top 3; a neon ring for everyone else. */
export function RankBadge({ rank, size = 40 }: { rank: number; size?: number }) {
  const p = PODIUM[rank];
  if (p) {
    return (
      <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, backgroundColor: p.fill, borderColor: p.edge, borderBottomWidth: 4 }]}>
        {rank === 1 && <Ionicons name="trophy" size={size * 0.32} color="#5A3D00" style={styles.crown} />}
        <Text style={[styles.num, { color: '#2A1E00', fontSize: size * 0.42 }]}>{rank}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.badge, { width: size, height: size, borderRadius: size / 2, borderColor: colors.border, backgroundColor: colors.cardAlt }]}>
      <Text style={[styles.num, { color: colors.muted, fontSize: rank > 99 ? size * 0.3 : size * 0.38 }]}>{rank}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  num: { fontWeight: '900' },
  crown: { position: 'absolute', top: -13 },
});
