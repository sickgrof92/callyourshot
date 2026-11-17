import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ContestSwitcher } from '../../components/ContestSwitcher';
import { GameButton } from '../../components/GameButton';
import { PickSheet, type PickTarget } from '../../components/PickSheet';
import { PushOffer } from '../../components/PushOffer';
import { shouldOfferPush } from '../../lib/notifications';
import { api, API_URL, type Game, type Market, type Selection } from '../../lib/api';
import { ago, gameTime, signed } from '../../lib/format';
import { useContests } from '../../lib/contests';
import { tap } from '../../lib/haptics';
import { colors, glow, space } from '../../lib/theme';

const ROWS: { market: Market; label: string; sides: [Selection, Selection] }[] = [
  { market: 'spread', label: 'Spread', sides: ['away', 'home'] },
  { market: 'moneyline', label: 'Winner', sides: ['away', 'home'] },
  { market: 'total', label: 'Total', sides: ['over', 'under'] },
];

function cellText(market: Market, selection: Selection, point: number | null, price: number) {
  if (market === 'moneyline') return signed(price);
  if (market === 'spread') return `${signed(point ?? 0)}  (${signed(price)})`;
  return `${selection === 'over' ? 'O' : 'U'} ${point}  (${signed(price)})`;
}

function GameCard({ game, contestEndsAt, onPick }: { game: Game; contestEndsAt: string | null; onPick: (t: PickTarget) => void }) {
  // Games that won't finish before the active contest ends can't count in it.
  const tooLate = !!contestEndsAt && !game.locked && Date.parse(game.expectedEndsAt) > Date.parse(contestEndsAt);
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.time, game.locked && { color: colors.loss }]}>{game.locked ? 'STARTED · PICKS LOCKED' : gameTime(game.startsAt)}</Text>
        {tooLate && <Text style={styles.tooLate}>ENDS AFTER THIS CONTEST</Text>}
      </View>
      <View style={styles.teams}>
        <Text style={styles.team}>{game.awayTeam}</Text>
        <Text style={[styles.at, glow(colors.pink, 8)]}>VS</Text>
        <Text style={styles.team}>{game.homeTeam}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.rowLabel} />
        <Text style={styles.colHead} numberOfLines={1}>{game.awayTeam}</Text>
        <Text style={styles.colHead} numberOfLines={1}>{game.homeTeam}</Text>
      </View>
      {ROWS.map(({ market, label, sides }) => {
        const m = game.lines[market];
        if (!m) return null;
        return (
          <View key={market} style={styles.row}>
            <Text style={styles.rowLabel}>{label}</Text>
            {sides.map((sel) => {
              const q = m[sel];
              return (
                <GameButton
                  key={sel}
                  variant="ghost"
                  size="sm"
                  disabled={!q || game.locked || tooLate}
                  style={{ flex: 1 }}
                  faceStyle={styles.cellFace}
                  onPress={() => q && onPick({ game, market, selection: sel, quote: q })}
                >
                  <Text style={styles.cellText}>{q ? cellText(market, sel, q.point, q.price) : '-'}</Text>
                </GameButton>
              );
            })}
          </View>
        );
      })}
      {Object.keys(game.lines).length === 0 && <Text style={styles.noLines}>Lines coming soon</Text>}
      <Text style={styles.updated}>Lines updated {ago(game.linesUpdatedAt)}</Text>
    </View>
  );
}

export default function Games() {
  const [sports, setSports] = useState<{ key: string; label: string }[]>([]);
  const [sport, setSport] = useState<string | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<PickTarget | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);
  const { active } = useContests();
  const [offerPush, setOfferPush] = useState(false);

  useEffect(() => {
    api
      .sports()
      .then((s) => {
        setSports(s);
        setSport((cur) => cur ?? s[0]?.key ?? null);
      })
      .catch(() => setError(`Couldn't reach the server at ${API_URL}. It may be waking up, so pull down to refresh in a minute.`));
  }, []);

  // A single-sport contest only shows its sport.
  const only = active?.sport ?? null;
  const shownSports = only ? sports.filter((s) => s.key === only) : sports;
  useEffect(() => {
    if (only && sport !== only) setSport(only);
  }, [only, sport]);

  const load = useCallback(async () => {
    if (!sport) {
      if (sports.length === 0) {
        // Retry the sport list too (e.g. after the server woke up).
        api.sports().then((s) => { setSports(s); setSport(s[0]?.key ?? null); setError(null); }).catch(() => {});
      }
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setGames((await api.lines(sport)).events);
    } catch {
      setError('Could not load games.');
    } finally {
      setLoading(false);
    }
  }, [sport, sports.length]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <View style={{ flex: 1 }}>
      <ContestSwitcher />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsInner}>
        {shownSports.map((s) => (
          <Pressable key={s.key} onPress={() => { tap(); setSport(s.key); }} style={[styles.sport, sport === s.key && styles.sportOn]}>
            <Text style={[styles.sportText, sport === s.key && styles.sportTextOn]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => <GameCard game={item} contestEndsAt={active?.endsAt ?? null} onPick={(t) => (active ? setTarget(t) : router.push('/'))} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{error ?? (loading ? '' : 'No upcoming games right now. Check back soon.')}</Text>
        }
      />
      <PickSheet
        target={target}
        onClose={() => setTarget(null)}
        onPlaced={(label, points) => {
          setTarget(null);
          setParty({ title: 'PICK LOCKED IN!', subtitle: `${points} pts on ${label}`, color: colors.win });
        }}
      />
      <Celebration
        info={party}
        onDone={() => {
          setParty(null);
          // After the first pick, offer notifications (once).
          void shouldOfferPush().then(setOfferPush);
        }}
      />
      <PushOffer visible={offerPush} onDone={() => setOfferPush(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexGrow: 0, flexShrink: 0, borderBottomWidth: 2, borderBottomColor: colors.border },
  tabsInner: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  sport: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border },
  sportOn: { backgroundColor: 'rgba(46,242,255,0.15)', borderColor: colors.neon },
  sportText: { color: colors.muted, fontWeight: '800' },
  sportTextOn: { color: colors.neon },
  card: { backgroundColor: colors.card, borderRadius: 18, padding: space.lg, gap: space.sm, borderWidth: 1.5, borderColor: colors.border },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.neon, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  tooLate: { color: colors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 0.5 },
  teams: { marginBottom: space.sm },
  team: { color: colors.text, fontSize: 19, fontWeight: '900' },
  at: { color: colors.pink, fontSize: 12, fontWeight: '900', marginVertical: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { color: colors.muted, width: 56, fontSize: 12, fontWeight: '800' },
  colHead: { flex: 1, color: colors.muted, fontSize: 11, textAlign: 'center', fontWeight: '700' },
  cellFace: { paddingHorizontal: 4 },
  cellText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  noLines: { color: colors.muted, fontStyle: 'italic' },
  updated: { color: colors.muted, fontSize: 11, marginTop: space.xs },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
});
