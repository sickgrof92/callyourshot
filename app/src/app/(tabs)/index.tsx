import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PickSheet, type PickTarget } from '../../components/PickSheet';
import { api, type Game, type Market, type Selection } from '../../lib/api';
import { ago, gameTime, signed } from '../../lib/format';
import { colors, space } from '../../lib/theme';

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

function GameCard({ game, onPick }: { game: Game; onPick: (t: PickTarget) => void }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Text style={styles.time}>{game.locked ? 'Started · picks locked' : gameTime(game.startsAt)}</Text>
      </View>
      <View style={styles.teams}>
        <Text style={styles.team}>{game.awayTeam}</Text>
        <Text style={styles.at}>at</Text>
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
                <Pressable
                  key={sel}
                  disabled={!q || game.locked}
                  style={[styles.cell, (!q || game.locked) && styles.cellOff]}
                  onPress={() => q && onPick({ game, market, selection: sel, quote: q })}
                >
                  <Text style={styles.cellText}>{q ? cellText(market, sel, q.point, q.price) : '-'}</Text>
                </Pressable>
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
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api
      .sports()
      .then((s) => {
        setSports(s);
        setSport((cur) => cur ?? s[0]?.key ?? null);
      })
      .catch(() => setError("Couldn't reach the server. It may be waking up, so pull down to refresh in a minute."));
  }, []);

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
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabsInner}>
        {sports.map((s) => (
          <Pressable key={s.key} onPress={() => setSport(s.key)} style={[styles.sport, sport === s.key && styles.sportOn]}>
            <Text style={[styles.sportText, sport === s.key && styles.sportTextOn]}>{s.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {toast && <Text style={styles.toast}>{toast}</Text>}
      <FlatList
        data={games}
        keyExtractor={(g) => g.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        renderItem={({ item }) => <GameCard game={item} onPick={setTarget} />}
        ListEmptyComponent={
          <Text style={styles.empty}>{error ?? (loading ? '' : 'No upcoming games right now. Check back soon.')}</Text>
        }
      />
      <PickSheet
        target={target}
        onClose={() => setTarget(null)}
        onPlaced={() => {
          setTarget(null);
          setToast('Pick locked in. Good luck!');
          setTimeout(() => setToast(null), 2500);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabsInner: { paddingHorizontal: space.lg, paddingVertical: space.sm, gap: space.sm },
  sport: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, backgroundColor: colors.card },
  sportOn: { backgroundColor: colors.accent },
  sportText: { color: colors.text, fontWeight: '600' },
  sportTextOn: { color: colors.accentText },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, gap: space.sm },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.muted, fontSize: 13 },
  teams: { marginBottom: space.sm },
  team: { color: colors.text, fontSize: 17, fontWeight: '700' },
  at: { color: colors.muted, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowLabel: { color: colors.muted, width: 56, fontSize: 13 },
  colHead: { flex: 1, color: colors.muted, fontSize: 11, textAlign: 'center' },
  cell: { flex: 1, backgroundColor: colors.cardAlt, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  cellOff: { opacity: 0.4 },
  cellText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  noLines: { color: colors.muted, fontStyle: 'italic' },
  updated: { color: colors.muted, fontSize: 11, marginTop: space.xs },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 60 },
  toast: { backgroundColor: colors.win, color: '#04140A', textAlign: 'center', padding: space.sm, fontWeight: '700' },
});
