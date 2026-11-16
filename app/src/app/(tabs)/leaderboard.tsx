import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { api, type Leaderboard as Board } from '../../lib/api';
import { countdown } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

export default function Leaderboard() {
  const { token, me } = useSession();
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await api.leaderboard(period, token));
    } catch {
      // keep the last board
    } finally {
      setLoading(false);
    }
  }, [period, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <FlatList
      data={board?.standings ?? []}
      keyExtractor={(r) => `${r.rank}-${r.displayName}`}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.md }}>
          <View style={styles.toggle}>
            {(['weekly', 'monthly'] as const).map((p) => (
              <Pressable key={p} style={[styles.tog, period === p && styles.togOn]} onPress={() => setPeriod(p)}>
                <Text style={[styles.togText, period === p && styles.togTextOn]}>{p === 'weekly' ? 'This week' : 'This month'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.prize}>
            <Text style={styles.prizeLabel}>{period === 'weekly' ? "THIS WEEK'S PRIZE" : "THIS MONTH'S PRIZE"}</Text>
            <Text style={styles.prizeTitle}>{board?.prize?.title ?? 'Prize to be announced'}</Text>
            {!!board?.prize?.description && <Text style={styles.prizeDesc}>{board.prize.description}</Text>}
            {board && <Text style={styles.prizeDesc}>{countdown(board.period.endsAt)}</Text>}
          </View>
          {board?.me && (
            <Text style={styles.mine}>
              You: {board.me.score} pts{board.me.rank ? ` · #${board.me.rank}` : ''}
            </Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.row, item.displayName === me?.displayName && styles.rowMe]}>
          <Text style={styles.rank}>{item.rank}</Text>
          <Text style={styles.name}>{item.displayName}</Text>
          <Text style={styles.score}>{item.score}</Text>
        </View>
      )}
      ListEmptyComponent={<Text style={styles.empty}>No scores yet. Be the first on the board.</Text>}
      ListFooterComponent={
        <Text style={styles.fine} onPress={() => router.push('/rules')}>
          Prizes are fixed and announced before each period starts. No purchase necessary. How it works
        </Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 12, padding: 4 },
  tog: { flex: 1, padding: space.sm, borderRadius: 10, alignItems: 'center' },
  togOn: { backgroundColor: colors.accent },
  togText: { color: colors.text, fontWeight: '600' },
  togTextOn: { color: colors.accentText },
  prize: { backgroundColor: colors.cardAlt, borderRadius: 16, padding: space.lg, gap: space.xs, borderWidth: 1, borderColor: colors.accent },
  prizeLabel: { color: colors.accent, fontWeight: '800', fontSize: 12, letterSpacing: 1 },
  prizeTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  prizeDesc: { color: colors.muted },
  mine: { color: colors.text, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, borderRadius: 12, padding: space.md },
  rowMe: { borderWidth: 1, borderColor: colors.accent },
  rank: { color: colors.muted, width: 36, fontWeight: '800' },
  name: { color: colors.text, flex: 1, fontWeight: '600' },
  score: { color: colors.accent, fontWeight: '800' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: space.xl },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.xl },
});
