import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, type Pick } from '../../lib/api';
import { gameTime, lineLabel, marketName, signed } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const STATUS: Record<Pick['status'], { label: string; color: string }> = {
  pending: { label: 'Pending', color: colors.accent },
  won: { label: 'Won', color: colors.win },
  lost: { label: 'Lost', color: colors.loss },
  push: { label: 'Push', color: colors.push },
  void: { label: 'Refunded', color: colors.push },
};

function result(p: Pick): string {
  if (p.status === 'won') return `+${(p.payout ?? 0) - p.points} pts`;
  if (p.status === 'lost') return `-${p.points} pts`;
  if (p.status === 'push' || p.status === 'void') return `${p.points} pts back`;
  return `${p.points} pts in play`;
}

export default function MyPicks() {
  const { token } = useSession();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      setPicks((await api.myPicks(token)).picks);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      data={picks}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      renderItem={({ item: p }) => {
        const s = STATUS[p.status];
        return (
          <View style={styles.card}>
            <View style={styles.top}>
              <Text style={styles.pick}>{lineLabel(p.market, p.selection, p.point, p.home_team, p.away_team)}</Text>
              <Text style={[styles.status, { color: s.color, borderColor: s.color }]}>{s.label}</Text>
            </View>
            <Text style={styles.meta}>
              {marketName[p.market]} · {signed(p.price)} · {p.away_team} at {p.home_team}
            </Text>
            <View style={styles.top}>
              <Text style={styles.meta}>
                {p.home_score !== null ? `Final ${p.away_score}-${p.home_score}` : gameTime(new Date(p.commence_time).toISOString())}
              </Text>
              <Text style={[styles.result, { color: s.color }]}>{result(p)}</Text>
            </View>
          </View>
        );
      }}
      ListEmptyComponent={<Text style={styles.empty}>No picks yet. Head to Games to make your first one.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 14, padding: space.lg, gap: space.xs },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pick: { color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 },
  status: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: '700', overflow: 'hidden' },
  meta: { color: colors.muted, fontSize: 13 },
  result: { fontWeight: '800' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
});
