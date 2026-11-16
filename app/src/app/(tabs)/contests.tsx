import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ContestCard } from '../../components/ContestCard';
import { api, ApiError, type Contest } from '../../lib/api';
import { useContests } from '../../lib/contests';
import { warn } from '../../lib/haptics';
import { useSession } from '../../lib/session';
import { colors, glow, space } from '../../lib/theme';

const JOIN_ERRORS: Record<string, string> = {
  full: 'That contest just filled up.',
  ended: 'That contest has ended.',
  already_joined: "You're already in.",
};

export default function Contests() {
  const { token } = useSession();
  const [list, setList] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);
  const contests = useContests();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList((await api.contests(token)).competitions);
      void contests.refresh();
      setError(null);
    } catch {
      setError("Couldn't load contests. Pull down to try again.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function join(c: Contest) {
    if (!token) return;
    setJoining(c.id);
    setError(null);
    try {
      await api.joinContest(token, c.id);
      if (c.status === 'live') contests.setActive(c.id);
      setParty({ title: "YOU'RE IN!", subtitle: c.status === 'live' ? `${c.name} · now playing` : c.name, color: colors.neon });
    } catch (err) {
      warn();
      setError(err instanceof ApiError ? JOIN_ERRORS[err.code] ?? 'Something went wrong.' : 'Could not reach the server.');
    } finally {
      setJoining(null);
      await load();
    }
  }

  const sections = [
    { title: 'Live now', data: list.filter((c) => c.status === 'live') },
    { title: 'Coming up', data: list.filter((c) => c.status === 'upcoming') },
    { title: 'Just ended', data: list.filter((c) => c.status === 'ended') },
  ].filter((s) => s.data.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <SectionList
        sections={sections}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
        stickySectionHeadersEnabled={false}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        ListHeaderComponent={
          <View style={{ marginBottom: space.sm }}>
            <Text style={[styles.h1, glow(colors.pink, 14)]}>CONTESTS</Text>
            <Text style={styles.sub}>Free to join, as many as you like. Each contest starts you at 0 points with your own 5 refills a day. Your points and picks stay inside that contest.</Text>
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title.toUpperCase()}</Text>}
        renderItem={({ item }) => <ContestCard c={item} onJoin={join} joining={joining === item.id} />}
        ListEmptyComponent={loading ? undefined : <Text style={styles.empty}>No contests right now. New ones are added every day, so check back soon.</Text>}
        ListFooterComponent={
          <Text style={styles.fine} onPress={() => router.push('/rules')}>
            Prizes are fixed and announced before each contest starts. No purchase necessary. <Text style={{ textDecorationLine: 'underline' }}>How it works</Text>
          </Text>
        }
      />
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.pink, fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  sub: { color: colors.muted, marginTop: 4, lineHeight: 19 },
  section: { color: colors.neon, fontWeight: '900', letterSpacing: 2, fontSize: 13, marginTop: space.md },
  error: { color: colors.loss, marginTop: space.sm, fontWeight: '700' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
});
