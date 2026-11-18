import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ContestSwitcher } from '../../components/ContestSwitcher';
import { GameButton } from '../../components/GameButton';
import { ParlaySheet, PARLAY_MAX } from '../../components/ParlaySheet';
import { PickSheet, type Changing, type PickTarget } from '../../components/PickSheet';
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

function GameCard({ game, onPick, chosen }: { game: Game; onPick: (t: PickTarget) => void; chosen?: PickTarget }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={[styles.time, game.locked && { color: colors.loss }]}>{game.locked ? 'STARTED · PICKS LOCKED' : gameTime(game.startsAt)}</Text>
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
                  disabled={!q || game.locked}
                  selected={chosen?.market === market && chosen?.selection === sel}
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
  // Parlay mode: tapping a line adds it to the slip (one pick per game).
  const [mode, setMode] = useState<'single' | 'parlay'>('single');
  const [slip, setSlip] = useState<PickTarget[]>([]);
  const [slipOpen, setSlipOpen] = useState(false);
  const [slipNote, setSlipNote] = useState<string | null>(null);
  const addToSlip = (t: PickTarget) => {
    setSlipNote(null);
    setSlip((cur) => {
      const same = cur.find((x) => x.game.id === t.game.id);
      if (same && same.market === t.market && same.selection === t.selection) return cur.filter((x) => x !== same); // tap again to remove
      if (same) return cur.map((x) => (x === same ? t : x)); // one pick per game: replace it
      if (cur.length >= PARLAY_MAX) {
        setSlipNote(`A parlay can have up to ${PARLAY_MAX} picks.`);
        return cur;
      }
      return [...cur, t];
    });
  };
  const { active } = useContests();
  const [offerPush, setOfferPush] = useState(false);
  // Opened from My Picks to change a pick: show only that game.
  const params = useLocalSearchParams<{ change?: string; event?: string; sport?: string; points?: string }>();
  const [changing, setChanging] = useState<(Changing & { eventId: string }) | null>(null);
  useEffect(() => {
    if (params.change && params.event) {
      setChanging({ pickId: params.change, eventId: params.event, points: Number(params.points) || 0 });
      if (params.sport) setSport(params.sport);
    }
  }, [params.change, params.event, params.sport, params.points]);
  // Only games that start and are expected to finish inside the active contest can count in it, so only those are shown.
  const inContest = active
    ? games.filter((g) => Date.parse(g.startsAt) >= Date.parse(active.startsAt) && Date.parse(g.expectedEndsAt) <= Date.parse(active.endsAt))
    : games;
  const stopChanging = () => {
    setChanging(null);
    router.setParams({ change: undefined, event: undefined, sport: undefined, points: undefined });
  };

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
      {!changing && active && (
        <View style={styles.modes}>
          {(['single', 'parlay'] as const).map((m) => (
            <Pressable
              key={m}
              onPress={() => { tap(); setMode(m); }}
              style={[styles.mode, mode === m && styles.modeOn]}
              accessibilityRole="button"
              accessibilityState={{ selected: mode === m }}
            >
              <Text style={[styles.modeText, mode === m && styles.modeTextOn]}>{m === 'single' ? 'Single pick' : 'Parlay / Round robin'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!changing && mode === 'parlay' && slip.length === 0 && (
        <Text style={styles.hint}>Tap a line on each game you want in your parlay (one per game).</Text>
      )}
      {changing && (
        <View style={styles.changeBar}>
          <Text style={styles.changeText}>Changing your pick: tap a new line on this game.</Text>
          <Pressable onPress={stopChanging} hitSlop={10} accessibilityRole="button">
            <Text style={styles.changeCancel}>Cancel</Text>
          </Pressable>
        </View>
      )}
      <FlatList
        data={changing ? games.filter((g) => g.id === changing.eventId) : inContest}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => (
          <GameCard
            game={item}
            chosen={mode === 'parlay' && !changing ? slip.find((x) => x.game.id === item.id) : undefined}
            onPick={(t) => (!active ? router.push('/') : mode === 'parlay' && !changing ? addToSlip(t) : setTarget(t))}
          />
        )}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {error ??
              (loading
                ? ''
                : games.length > 0
                  ? "None of these games start and finish inside this contest. Try another sport, or check back as new games are added."
                  : 'No upcoming games right now. Check back soon.')}
          </Text>
        }
      />
      {!changing && mode === 'parlay' && slip.length > 0 && (
        <View style={styles.slipBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.slipText}>{slip.length} {slip.length === 1 ? 'pick' : 'picks'} in your parlay</Text>
            <Text style={styles.slipSub}>{slipNote ?? (slip.length < 2 ? 'Add at least one more game.' : 'Ready when you are.')}</Text>
          </View>
          <Pressable onPress={() => setSlip([])} hitSlop={8} accessibilityRole="button">
            <Text style={styles.changeCancel}>Clear</Text>
          </Pressable>
          <GameButton title="Review" size="sm" disabled={slip.length < 2} onPress={() => setSlipOpen(true)} />
        </View>
      )}
      <ParlaySheet
        open={slipOpen}
        legs={slip}
        onRemove={(eventId) => setSlip((cur) => cur.filter((x) => x.game.id !== eventId))}
        onQuote={(eventId, quote) => setSlip((cur) => cur.map((x) => (x.game.id === eventId ? { ...x, quote } : x)))}
        onClose={() => setSlipOpen(false)}
        onPlaced={(title, subtitle) => {
          setSlipOpen(false);
          setSlip([]);
          setParty({ title, subtitle, color: colors.win });
        }}
      />
      <PickSheet
        target={target}
        changing={changing}
        onClose={() => setTarget(null)}
        onPlaced={(label, points) => {
          setTarget(null);
          const wasChange = !!changing;
          if (wasChange) stopChanging();
          setParty({ title: wasChange ? 'PICK CHANGED!' : 'PICK LOCKED IN!', subtitle: `${points} pts on ${label}`, color: colors.win });
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
  modes: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md },
  mode: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 14, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  modeOn: { borderColor: colors.accent, backgroundColor: 'rgba(255,225,77,0.12)' },
  modeText: { color: colors.muted, fontWeight: '800', fontSize: 13 },
  modeTextOn: { color: colors.accent },
  hint: { color: colors.muted, textAlign: 'center', paddingHorizontal: space.lg, paddingTop: space.sm, fontSize: 13 },
  slipBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.cardAlt, borderTopWidth: 2, borderTopColor: colors.accent, padding: space.md },
  slipText: { color: colors.text, fontWeight: '900' },
  slipSub: { color: colors.muted, fontSize: 12 },
  changeBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: 'rgba(46,242,255,0.12)', borderBottomWidth: 2, borderBottomColor: colors.neon, padding: space.md },
  changeText: { flex: 1, color: colors.text, fontWeight: '800' },
  changeCancel: { color: colors.neon, fontWeight: '900' },
});
