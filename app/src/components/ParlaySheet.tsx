// Review and place a parlay or round robin from the picks added on Games.
//
// Parlay: 2 to 10 picks on different games, one amount of points; every pick
// has to win. Round robin: 3 to 8 picks turned into every smaller parlay of
// the chosen sizes ("by 2s", "by 3s"...), each with the same points.

import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type LineQuote } from '../lib/api';
import { useContests } from '../lib/contests';
import { lineLabel, marketName, signed } from '../lib/format';
import { tap } from '../lib/haptics';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';
import { useAd } from '../lib/useAd';
import { GameButton } from './GameButton';
import type { PickTarget } from './PickSheet';
import { PointsPicker } from './PointsPicker';

export const PARLAY_MAX = 10;
export const ROUND_ROBIN_MIN = 3;
export const ROUND_ROBIN_MAX = 8;

const MAX_POINTS = 500;

/** A parlay or round robin being changed. */
export interface ParlayChange {
  groupId: string;
  /** Points on each parlay now. */
  points: number;
  /** Points on all of them now: these come back when it's changed. */
  total: number;
  sizes: number[] | null;
}

function mult(price: number) {
  return price > 0 ? 1 + price / 100 : 1 + 100 / Math.abs(price);
}

/** Points back on a winning parlay, matching the server's rounding. */
function parlayReturn(points: number, prices: number[]) {
  return Math.floor(points * prices.reduce((m, p) => m * mult(p), 1) + 1e-9);
}

function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const go = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push(acc);
    for (let i = start; i <= items.length - (k - acc.length); i++) go(i + 1, [...acc, items[i]!]);
  };
  go(0, []);
  return out;
}

export function ParlaySheet({
  open,
  legs,
  onRemove,
  onQuote,
  onClose,
  onPlaced,
  changing,
}: {
  open: boolean;
  changing?: ParlayChange | null;
  legs: PickTarget[];
  onRemove: (eventId: string) => void;
  /** A line moved: update that pick's quote. */
  onQuote: (eventId: string, quote: LineQuote) => void;
  onClose: () => void;
  onPlaced: (title: string, subtitle: string) => void;
}) {
  const { token } = useSession();
  const { active, refresh } = useContests();
  const { watch, adModal } = useAd();
  const [kind, setKind] = useState<'parlay' | 'robin'>('parlay');
  const [sizes, setSizes] = useState<number[]>([2]);
  const [points, setPoints] = useState(10);
  const [adSessionId, setAdSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Start from the parlay being changed.
  useEffect(() => {
    if (!changing) return;
    setKind(changing.sizes ? 'robin' : 'parlay');
    if (changing.sizes) setSizes(changing.sizes);
    setPoints(changing.points);
  }, [changing?.groupId]);

  const n = legs.length;
  const canRobin = n >= ROUND_ROBIN_MIN && n <= ROUND_ROBIN_MAX;
  const robin = kind === 'robin' && canRobin;
  const validSizes = sizes.filter((k) => k >= 2 && k < n);
  const sets = useMemo(
    () => (robin ? validSizes.flatMap((k) => combinations(legs, k)) : n >= 2 ? [legs] : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [robin, validSizes.join(','), legs],
  );
  const count = sets.length;
  const balance = (active?.mine?.balance ?? 0) + (changing?.total ?? 0);
  const maxEach = count > 0 ? Math.min(MAX_POINTS, Math.floor(balance / count)) : 0;
  const total = points * count;
  const bestReturn = sets.reduce((sum, set) => sum + parlayReturn(points, set.map((l) => l.quote.price)), 0);
  const ready = count > 0 && maxEach >= 1 && (robin ? validSizes.length > 0 : n >= 2 && n <= PARLAY_MAX);

  // Any change to the picks or the setup needs a fresh confirmation.
  useEffect(() => {
    setAdSessionId(null);
    setMessage(null);
  }, [legs, kind, sizes]);
  useEffect(() => {
    if (!canRobin && kind === 'robin') setKind('parlay');
  }, [canRobin, kind]);
  useEffect(() => {
    setPoints((p) => Math.max(1, Math.min(p, Math.max(maxEach, 1))));
  }, [maxEach]);

  async function watchAd() {
    setBusy(true);
    setMessage(null);
    try {
      const id = await watch('pick');
      if (id) setAdSessionId(id);
      else setMessage('Watch the whole ad to confirm.');
    } catch {
      setMessage('No ad is available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!token || !active || !adSessionId) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.makeParlay(token, {
        competitionId: active.id,
        legs: legs.map((l) => ({ eventId: l.game.id, market: l.market, selection: l.selection, expectedPoint: l.quote.point, expectedPrice: l.quote.price })),
        sizes: robin ? validSizes : undefined,
        points,
        adSessionId,
      }, changing?.groupId);
      await refresh();
      onPlaced(changing ? (robin ? 'ROUND ROBIN CHANGED!' : 'PARLAY CHANGED!') : robin ? 'ROUND ROBIN IN!' : 'PARLAY LOCKED IN!', robin ? `${count} parlays × ${points} pts` : `${n} picks · ${points} pts`);
    } catch (err) {
      if (err instanceof ApiError) {
        const ev = typeof err.body.eventId === 'string' ? err.body.eventId : null;
        const which = ev ? legs.find((l) => l.game.id === ev) : undefined;
        const name = which ? `${which.game.awayTeam} at ${which.game.homeTeam}` : 'One of these games';
        if (err.code === 'line_moved' && ev && err.body.line) {
          const l = err.body.line as { point: number | null; price: number };
          onQuote(ev, { point: l.point, price: l.price, payout: Math.round(mult(l.price) * 100) / 100 });
          setMessage(`The line on ${name} just changed. Check it and confirm again.`);
          return; // keep the ad: nothing was used
        }
        if (err.code === 'locked' && !ev) setMessage("Your parlay's first game has started, so it can't be changed now.");
        else if (err.code === 'not_pending') setMessage('That parlay has already been graded or forfeited.');
        else if (err.code === 'locked') setMessage(`${name} has started, so it can't be in a parlay. Remove it and try again.`);
        else if (err.code === 'after_contest_end') setMessage(`${name} won't be over before your contest ends. Remove it and try again.`);
        else if (err.code === 'same_game') setMessage('A parlay can only have one pick per game.');
        else if (err.code === 'not_enough_points') setMessage("You don't have enough points for this.");
        else if (err.code === 'pick_ad_required') {
          setAdSessionId(null);
          setMessage('That ad has expired. Watch another to confirm.');
        } else if (err.code === 'contest_not_live' || err.code === 'not_joined') setMessage("This contest isn't running right now.");
        else setMessage('Something went wrong. Try again.');
      } else setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {active && <Text style={styles.contest}>{changing ? 'CHANGING YOUR PARLAY' : `IN: ${active.name.toUpperCase()}`}</Text>}
        {changing && <Text style={styles.help}>Your {changing.total} pts on the old one come back, and these picks replace it. You can add or remove games too.</Text>}
        <View style={styles.tabs}>
          {(['parlay', 'robin'] as const).map((k) => {
            const on = (k === 'robin') === robin;
            const disabled = k === 'robin' && !canRobin;
            return (
              <Pressable
                key={k}
                disabled={disabled}
                onPress={() => {
                  tap();
                  setKind(k);
                }}
                style={[styles.tab, on && styles.tabOn, disabled && { opacity: 0.4 }]}
                accessibilityRole="tab"
                accessibilityState={{ selected: on, disabled }}
              >
                <Text style={[styles.tabText, on && styles.tabTextOn]}>{k === 'parlay' ? 'Parlay' : 'Round robin'}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.help}>
          {robin
            ? 'Your picks are split into smaller parlays. Each one pays on its own, so you can win some even if a pick loses.'
            : n < 2
              ? 'Add at least 2 picks on different games.'
              : 'Every pick has to win. A push drops that pick and the rest still pay.'}
          {!canRobin && n < ROUND_ROBIN_MIN && n >= 2 ? ' Add a 3rd pick for a round robin.' : ''}
        </Text>

        <ScrollView style={{ maxHeight: 220 }} contentContainerStyle={{ gap: space.sm }}>
          {legs.map((l) => (
            <View key={l.game.id} style={styles.leg}>
              <View style={{ flex: 1 }}>
                <Text style={styles.legPick}>{lineLabel(l.market, l.selection, l.quote.point, l.game.homeTeam, l.game.awayTeam)}</Text>
                <Text style={styles.legMeta}>
                  {marketName[l.market]} · {signed(l.quote.price)} · {l.game.awayTeam} at {l.game.homeTeam}
                </Text>
              </View>
              <Pressable onPress={() => onRemove(l.game.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Remove this pick">
                <Ionicons name="close-circle" size={24} color={colors.muted} />
              </Pressable>
            </View>
          ))}
        </ScrollView>

        {robin && (
          <View style={styles.sizes}>
            {Array.from({ length: n - 2 }, (_, i) => i + 2).map((k) => {
              const on = sizes.includes(k);
              return (
                <Pressable
                  key={k}
                  onPress={() => {
                    tap();
                    setSizes((s) => (on ? s.filter((x) => x !== k) : [...s, k].sort((a, b) => a - b)));
                  }}
                  style={[styles.size, on && styles.sizeOn]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                >
                  <Text style={[styles.sizeText, on && styles.sizeTextOn]}>By {k}s ({combinations(legs, k).length})</Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {!ready ? (
          <Text style={styles.msg}>
            {n < 2 ? 'Add picks from the games list.' : count > 0 && maxEach < 1 ? `You need at least ${count} points for this.` : robin ? 'Choose at least one size.' : `Parlays can have up to ${PARLAY_MAX} picks.`}
          </Text>
        ) : adSessionId ? (
          <>
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>{changing ? 'Confirm your change' : robin ? 'Confirm your round robin' : 'Confirm your parlay'}</Text>
              <Text style={styles.confirmLine}>{robin ? `${count} parlays × ${points} pts = ${total} pts` : `${points} pts on a ${n}-pick parlay`}</Text>
              <Text style={styles.ret}>
                {robin ? 'If every pick wins, get back ' : 'Win and get back '}
                <Text style={{ color: colors.win, fontWeight: '800' }}>{bestReturn} pts</Text>
              </Text>
            </View>
            {message && <Text style={styles.msg}>{message}</Text>}
            <GameButton title="Confirm" variant="go" size="lg" icon="checkmark-circle" busy={busy} heavy onPress={confirm} />
          </>
        ) : (
          <>
            <Text style={styles.label}>{robin ? 'POINTS ON EACH PARLAY' : 'POINTS'}</Text>
            <PointsPicker value={points} max={maxEach} onChange={setPoints} />
            <Text style={styles.ret}>
              {robin ? `${count} parlays · ${total} pts total. If every pick wins, get back ` : 'Win and get back '}
              <Text style={{ color: colors.win, fontWeight: '800' }}>{bestReturn} pts</Text>
            </Text>
            {message && <Text style={styles.msg}>{message}</Text>}
            <GameButton title="Watch ad to confirm" size="lg" icon="play-circle" busy={busy} onPress={watchAd} />
          </>
        )}
        <Pressable style={styles.cancel} onPress={onClose}>
          <Text style={styles.cancelText}>Keep adding picks</Text>
        </Pressable>
      </View>
      {adModal}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,20,0.7)' },
  sheet: { backgroundColor: colors.card, padding: space.xl, paddingBottom: 40, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: space.md, borderTopWidth: 2, borderColor: colors.pink, maxHeight: '92%' },
  contest: { color: colors.pink, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  tabs: { flexDirection: 'row', gap: space.sm },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, borderWidth: 2, borderColor: colors.border },
  tabOn: { borderColor: colors.pink, backgroundColor: 'rgba(255,61,154,0.15)' },
  tabText: { color: colors.muted, fontWeight: '900' },
  tabTextOn: { color: colors.text },
  help: { color: colors.muted, lineHeight: 19 },
  leg: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.cardAlt, borderRadius: 12, padding: space.md },
  legPick: { color: colors.text, fontWeight: '900', fontSize: 16 },
  legMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  sizes: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  size: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border },
  sizeOn: { backgroundColor: colors.pink, borderColor: colors.pink },
  sizeText: { color: colors.text, fontWeight: '800' },
  sizeTextOn: { color: '#fff' },
  label: { color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 12, textAlign: 'center' },
  ret: { color: colors.text, textAlign: 'center', fontWeight: '600' },
  msg: { color: colors.accent, textAlign: 'center', fontWeight: '700' },
  confirmBox: { backgroundColor: colors.cardAlt, borderRadius: 16, padding: space.lg, gap: space.sm, alignItems: 'center', borderWidth: 2, borderColor: colors.win },
  confirmTitle: { color: colors.win, fontWeight: '900', letterSpacing: 2 },
  confirmLine: { color: colors.text, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  cancel: { alignItems: 'center', padding: space.sm },
  cancelText: { color: colors.muted, fontWeight: '700' },
});
