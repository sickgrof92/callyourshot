import { router, useFocusEffect } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ContestSwitcher } from '../../components/ContestSwitcher';
import { GameButton } from '../../components/GameButton';
import { api, ApiError, type ParlayLeg, type Pick } from '../../lib/api';
import { gameTime, lineLabel, marketName, signed } from '../../lib/format';
import { useContests } from '../../lib/contests';
import { useSession } from '../../lib/session';
import { warn } from '../../lib/haptics';
import { colors, space } from '../../lib/theme';
import { useAd } from '../../lib/useAd';

const STATUS: Record<Pick['status'], { label: string; color: string }> = {
  pending: { label: 'In play', color: colors.neon },
  won: { label: 'Won', color: colors.win },
  lost: { label: 'Lost', color: colors.loss },
  push: { label: 'Push', color: colors.push },
  void: { label: 'Refunded', color: colors.push },
};

function statusOf(p: Pick) {
  return p.forfeited_at ? { label: 'Forfeited', color: colors.loss } : STATUS[p.status];
}

function result(p: Pick): string {
  if (p.status === 'won') return `+${(p.payout ?? 0) - p.points} pts`;
  if (p.status === 'lost') return `-${p.points} pts`;
  if (p.status === 'push' || p.status === 'void') return `${p.points} pts back`;
  return `${p.points} pts in play`;
}

function title(p: Pick): string {
  if (p.market === 'parlay') return p.selection === 'round_robin' ? `Round robin: ${p.legs?.length ?? 0}-pick parlay` : `${p.legs?.length ?? 0}-pick parlay`;
  return lineLabel(p.market, p.selection as Exclude<Pick['selection'], 'parlay' | 'round_robin'>, p.point, p.home_team, p.away_team);
}

const LEG_MARK: Record<ParlayLeg['status'], { icon: string; color: string }> = {
  pending: { icon: '•', color: colors.neon },
  won: { icon: '✓', color: colors.win },
  lost: { icon: '✗', color: colors.loss },
  push: { icon: '=', color: colors.push },
  void: { icon: '=', color: colors.push },
};

function Legs({ legs }: { legs: ParlayLeg[] }) {
  return (
    <View style={{ gap: 2, marginVertical: space.xs }}>
      {legs.map((l) => (
        <Text key={l.event_id} style={styles.meta}>
          <Text style={{ color: LEG_MARK[l.status].color, fontWeight: '900' }}>{LEG_MARK[l.status].icon} </Text>
          <Text style={{ color: colors.text, fontWeight: '800' }}>{lineLabel(l.market, l.selection, l.point, l.home_team, l.away_team)}</Text>
          {` (${signed(l.price)}) · ${l.away_team} at ${l.home_team}`}
          {l.home_score !== null ? ` · Final ${l.away_score}-${l.home_score}` : ''}
        </Text>
      ))}
    </View>
  );
}

// Wins the player has already celebrated, so each win gets its moment once.
const SEEN_KEY = 'cys.seenWins';

async function newWins(picks: Pick[]): Promise<Pick[]> {
  const wins = picks.filter((p) => p.status === 'won' && !p.forfeited_at);
  const raw = await SecureStore.getItemAsync(SEEN_KEY).catch(() => null);
  const seen = new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
  const fresh = raw === null ? [] : wins.filter((p) => !seen.has(p.id)); // first run: just remember
  const keep = wins.slice(0, 40).map((p) => p.id);
  await SecureStore.setItemAsync(SEEN_KEY, JSON.stringify(keep)).catch(() => {});
  return fresh;
}

export default function MyPicks() {
  const { token } = useSession();
  const { active, refresh } = useContests();
  const [picks, setPicks] = useState<Pick[]>([]);
  const [loading, setLoading] = useState(false);
  const [forfeiting, setForfeiting] = useState<Pick | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { watch, adModal } = useAd();
  const [party, setParty] = useState<CelebrationInfo | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Wins are celebrated across every contest; the list shows the one being played.
      const everything = (await api.myPicks(token)).picks;
      const list = active ? everything.filter((p) => p.competition_id === active.id) : everything;
      setPicks(list);
      const fresh = await newWins(everything);
      if (fresh.length > 0) {
        const gained = fresh.reduce((n, p) => n + (p.payout ?? 0) - p.points, 0);
        setParty({ title: fresh.length === 1 ? 'YOU WON!' : `${fresh.length} WINS!`, subtitle: `+${gained} pts`, color: colors.win });
      }
    } finally {
      setLoading(false);
    }
  }, [token, active?.id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function forfeit() {
    if (!token || !forfeiting) return;
    setBusy(true);
    setMessage(null);
    try {
      const adId = await watch('forfeit');
      if (!adId) {
        setMessage('Watch the whole ad to forfeit this pick.');
        return;
      }
      await api.forfeitPick(token, forfeiting.id, adId);
      setForfeiting(null);
      await Promise.all([load(), refresh()]);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'not_pending') {
        setForfeiting(null);
        await load();
      } else setMessage('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const started = (p: Pick) => Date.now() >= p.commence_time;

  return (
    <View style={{ flex: 1 }}>
    <ContestSwitcher />
    <FlatList
      data={picks}
      keyExtractor={(p) => p.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
      renderItem={({ item: p }) => {
        const s = statusOf(p);
        return (
          <View style={[styles.card, { borderLeftColor: s.color }]}>
            <View style={styles.top}>
              <Text style={styles.pick}>{title(p)}</Text>
              <Text style={[styles.status, { color: s.color, borderColor: s.color }]}>{s.label}</Text>
            </View>
            {p.market === 'parlay' ? (
              <>
                <Text style={styles.meta}>Parlay {signed(p.price)} · every pick has to win</Text>
                <Legs legs={p.legs ?? []} />
              </>
            ) : (
              <Text style={styles.meta}>
                {marketName[p.market]} · {signed(p.price)} · {p.away_team} at {p.home_team}
              </Text>
            )}
            <View style={styles.top}>
              <Text style={styles.meta}>
                {p.home_score !== null
                  ? `Final ${p.away_score}-${p.home_score}`
                  : `${p.market === 'parlay' ? 'First game ' : ''}${gameTime(new Date(p.commence_time).toISOString())}`}
              </Text>
              <Text style={[styles.result, { color: s.color }]}>{result(p)}</Text>
            </View>
            {p.status === 'pending' && !p.forfeited_at && p.market === 'parlay' && p.group_id && !picks.some((q) => q.group_id === p.group_id && started(q)) && (
              <GameButton
                title={p.selection === 'round_robin' ? 'Change this round robin' : 'Change this parlay'}
                variant="ghost"
                size="sm"
                icon="swap-horizontal"
                style={{ marginTop: space.sm }}
                onPress={() => router.push({ pathname: '/games', params: { parlay: p.group_id! } })}
              />
            )}
            {p.status === 'pending' && !started(p) && p.market !== 'parlay' && (
              <GameButton
                title="Change this pick"
                variant="ghost"
                size="sm"
                icon="swap-horizontal"
                style={{ marginTop: space.sm }}
                onPress={() => router.push({ pathname: '/games', params: { change: p.id, event: p.event_id, sport: p.sport, points: String(p.points) } })}
              />
            )}
            {p.status === 'pending' && started(p) && (
              <GameButton
                title="FORFEIT THIS PICK"
                variant="danger"
                size="lg"
                icon="flag"
                heavy
                style={{ marginTop: space.sm }}
                onPress={() => {
                  warn();
                  setMessage(null);
                  setForfeiting(p);
                }}
              />
            )}
          </View>
        );
      }}
      ListEmptyComponent={active ? <Text style={styles.empty}>No picks in this contest yet. Head to Games to make your first one.</Text> : undefined}
      ListFooterComponent={
        <>
          <Modal visible={forfeiting !== null} transparent animationType="fade" onRequestClose={() => setForfeiting(null)}>
            <View style={styles.backdrop}>
              {forfeiting && (
                <View style={styles.dialog}>
                  <Text style={styles.warnTitle}>FORFEIT THIS PICK?</Text>
                  <Text style={styles.warnPick}>{title(forfeiting)}</Text>
                  <Text style={styles.warnBody}>
                    This pick will count as a <Text style={{ fontWeight: '900', color: colors.loss }}>LOSS</Text>. You lose the{' '}
                    <Text style={{ fontWeight: '900', color: colors.text }}>{forfeiting.points} points</Text> on it, even if it would have
                    won. This can't be undone.
                  </Text>
                  <Text style={styles.warnBody}>You'll watch one ad to forfeit.</Text>
                  {message && <Text style={styles.warnMsg}>{message}</Text>}
                  <GameButton title="WATCH AD AND FORFEIT" variant="danger" size="lg" heavy busy={busy} onPress={forfeit} />
                  <Pressable style={styles.keep} disabled={busy} onPress={() => setForfeiting(null)}>
                    <Text style={styles.keepText}>Keep my pick</Text>
                  </Pressable>
                </View>
              )}
            </View>
            {adModal}
          </Modal>
        </>
      }
    />
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, gap: space.xs, borderLeftWidth: 5, borderWidth: 1, borderColor: colors.border },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pick: { color: colors.text, fontWeight: '900', fontSize: 17, flex: 1 },
  status: { borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, fontSize: 12, fontWeight: '900', overflow: 'hidden', textTransform: 'uppercase' },
  meta: { color: colors.muted, fontSize: 13 },
  result: { fontWeight: '900', fontSize: 16 },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,20,0.8)', justifyContent: 'center', padding: space.xl },
  dialog: { backgroundColor: colors.card, borderRadius: 18, padding: space.xl, gap: space.md, borderWidth: 3, borderColor: colors.loss },
  warnTitle: { color: colors.loss, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  warnPick: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  warnBody: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: 'center' },
  warnMsg: { color: colors.accent, textAlign: 'center' },
  keep: { alignItems: 'center', padding: space.sm },
  keepText: { color: colors.text, fontWeight: '700', fontSize: 16 },
});
