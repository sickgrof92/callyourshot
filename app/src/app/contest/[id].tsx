import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { GameButton } from '../../components/GameButton';
import { Meter } from '../../components/Meter';
import { RankBadge } from '../../components/RankBadge';
import { router } from 'expo-router';
import { api, ApiError, type ContestDetail } from '../../lib/api';
import { useContests } from '../../lib/contests';
import { contestClock, contestDates } from '../../lib/format';
import { warn } from '../../lib/haptics';
import { useSession } from '../../lib/session';
import { colors, glow, kindColor, space } from '../../lib/theme';

export default function ContestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, me } = useSession();
  const [data, setData] = useState<ContestDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);
  const contests = useContests();

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      setData(await api.contest(id, token));
    } catch {
      setMessage("Couldn't load this contest.");
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function join() {
    if (!token || !id) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.joinContest(token, id);
      await contests.refresh();
      if (data?.competition.status === 'live') contests.setActive(id);
      setParty({ title: "YOU'RE IN!", subtitle: data?.competition.name, color: colors.neon });
    } catch (err) {
      warn();
      setMessage(err instanceof ApiError && err.code === 'full' ? 'This contest just filled up.' : 'Could not join. Try again.');
    } finally {
      setBusy(false);
      await load();
    }
  }

  const c = data?.competition;
  const color = c ? kindColor[c.kind] : colors.neon;
  const full = c ? c.entries >= c.maxEntries : false;

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: c?.name ?? 'Contest' }} />
      <FlatList
        data={data?.standings ?? []}
        keyExtractor={(r) => `${r.rank}-${r.displayName}`}
        contentContainerStyle={{ padding: space.lg, gap: space.sm, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListHeaderComponent={
          c ? (
            <View style={{ gap: space.md, marginBottom: space.md }}>
              <View style={[styles.prizeCard, { borderColor: color, shadowColor: color }]}>
                <Text style={[styles.kind, { color }]}>{c.kind.toUpperCase()} CONTEST</Text>
                <Text style={styles.prizeLabel}>PRIZE</Text>
                <Text style={[styles.prize, glow(colors.accent, 14)]}>{c.prize}</Text>
                {!!c.prizeDetails && <Text style={styles.details}>{c.prizeDetails}</Text>}
                <Text style={[styles.clock, c.status === 'live' && { color: colors.win }]}>{contestClock(c.status, c.startsAt, c.endsAt)}</Text>
                <Text style={styles.dates}>{contestDates(c.startsAt, c.endsAt)}</Text>
                <Text style={styles.entries}>
                  {c.entries} / {c.maxEntries} players
                </Text>
                <Meter value={c.entries} max={c.maxEntries} color={color} />
                {c.status === 'ended' && <Text style={styles.winner}>{c.winner ? `🏆 Winner: ${c.winner}` : 'Final results coming soon'}</Text>}
              </View>
              {c.claim === 'pending' && (
                <GameButton title="Claim your prize" variant="primary" size="lg" icon="gift" heavy onPress={() => router.push(`/claim/${c.id}`)} />
              )}
              {c.claim && c.claim !== 'pending' && (
                <GameButton title={`Prize claim: ${c.claim}`} variant="ghost" size="sm" icon="gift" onPress={() => router.push(`/claim/${c.id}`)} />
              )}

              {c.joined && data?.me ? (
                <View style={styles.meCard}>
                  <RankBadge rank={data.me.rank} size={48} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.meLabel}>YOUR RANK</Text>
                    <Text style={styles.meScore}>{data.me.score} pts</Text>
                  </View>
                  {c.status === 'live' && (
                    <GameButton
                      title="Play"
                      variant="go"
                      size="sm"
                      icon="play"
                      onPress={() => {
                        contests.setActive(c.id);
                        router.push('/');
                      }}
                    />
                  )}
                </View>
              ) : c.status !== 'ended' && !c.joined ? (
                <GameButton title={full ? 'Full' : 'Join free'} variant="go" size="lg" icon="flash" disabled={full} busy={busy} heavy onPress={join} />
              ) : null}
              {message && <Text style={styles.msg}>{message}</Text>}
              <Text style={styles.section}>LEADERBOARD</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          const mine = item.displayName === me?.displayName;
          return (
            <Pressable onPress={() => router.push(`/player/${encodeURIComponent(item.displayName)}`)} style={[styles.row, item.rank <= 3 && styles.rowTop, mine && styles.rowMe]}>
              <RankBadge rank={item.rank} />
              <Text style={styles.name} numberOfLines={1}>
                {item.displayName}
                {mine ? ' (you)' : ''}
              </Text>
              <Text style={[styles.score, item.rank === 1 && glow(colors.accent, 8)]}>{item.score}</Text>
            </Pressable>
          );
        }}
        ListEmptyComponent={c ? <Text style={styles.empty}>No players yet. Join and be first on the board.</Text> : undefined}
        ListFooterComponent={
          c ? <Text style={styles.fine}>Score = your points in this contest, counting points on picks still in play. Everyone starts at 0. Ties go to fewest refills used, then best win %, then most winning picks. Still tied? Everyone tied for first wins the full prize. Tap a name to see their stats.</Text> : undefined
        }
      />
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  prizeCard: {
    backgroundColor: colors.card,
    borderRadius: 20,
    borderWidth: 2,
    padding: space.lg,
    gap: 6,
    shadowOpacity: 0.6,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  kind: { fontWeight: '900', letterSpacing: 2, fontSize: 12 },
  prizeLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  prize: { color: colors.accent, fontSize: 28, fontWeight: '900' },
  details: { color: colors.text, lineHeight: 20 },
  clock: { color: colors.text, fontWeight: '800', marginTop: 6 },
  dates: { color: colors.muted, fontSize: 12 },
  entries: { color: colors.muted, fontSize: 12, fontWeight: '700', marginTop: 6 },
  winner: { color: colors.gold, fontWeight: '900', fontSize: 16, marginTop: 8 },
  meCard: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.cardAlt, borderRadius: 16, padding: space.lg, borderWidth: 2, borderColor: colors.accent, paddingTop: space.lg + 6 },
  meLabel: { color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 12 },
  meScore: { color: colors.accent, fontWeight: '900', fontSize: 24 },
  msg: { color: colors.loss, textAlign: 'center', fontWeight: '700' },
  section: { color: colors.neon, fontWeight: '900', letterSpacing: 2, fontSize: 13, marginTop: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.card, borderRadius: 14, padding: space.md, paddingTop: space.md + 4 },
  rowTop: { backgroundColor: colors.cardAlt },
  rowMe: { borderWidth: 2, borderColor: colors.accent },
  name: { color: colors.text, flex: 1, fontWeight: '800', fontSize: 16 },
  score: { color: colors.accent, fontWeight: '900', fontSize: 18 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: space.xl },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.xl },
});
