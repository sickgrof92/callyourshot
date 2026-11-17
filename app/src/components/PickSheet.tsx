import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Game, type LineQuote, type Market, type Selection } from '../lib/api';
import { lineLabel, marketName, signed } from '../lib/format';
import { useContests } from '../lib/contests';
import { useSession } from '../lib/session';
import { tap } from '../lib/haptics';
import { colors, glow, space } from '../lib/theme';
import { GameButton } from './GameButton';
import { PointsCounter } from './PointsCounter';
import { useAd } from '../lib/useAd';

export interface PickTarget {
  game: Game;
  market: Market;
  selection: Selection;
  quote: LineQuote;
}

const MIN = 10;
const MAX = 500;
const CHIPS = [10, 25, 50, 100];

/** Points you'd get back on a win, matching the server's integer math. */
function winReturn(points: number, price: number) {
  return points + (price > 0 ? Math.floor((points * price) / 100) : Math.floor((points * 100) / Math.abs(price)));
}

/** The pick being changed, when the sheet is used to change one instead of making a new one. */
export interface Changing {
  pickId: string;
  points: number;
}

export function PickSheet({
  target,
  changing,
  onClose,
  onPlaced,
}: {
  target: PickTarget | null;
  changing?: Changing | null;
  onClose: () => void;
  onPlaced: (label: string, points: number) => void;
}) {
  const { token } = useSession();
  const { active, refresh } = useContests();
  const [points, setPoints] = useState(MIN);
  const [quote, setQuote] = useState<LineQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Every pick needs its own ad. Once watched, the player confirms on a second screen.
  const [adSessionId, setAdSessionId] = useState<string | null>(null);
  const { watch, adModal } = useAd();

  // Points the player can use: their balance, plus the old pick's points when changing it.
  const available = (active?.mine?.balance ?? 0) + (changing?.points ?? 0);
  useEffect(() => {
    setPoints(changing ? Math.min(changing.points, MAX) : available > 0 && available < MIN ? available : MIN);
    setQuote(target?.quote ?? null);
    setMessage(null);
    setAdSessionId(null);
  }, [target]);

  if (!target || !quote) return null;
  const { game, market, selection } = target;
  const maxPoints = Math.min(MAX, available);
  // Refills only come at exactly 0, so leftover points under 10 can be used all at once.
  const tooFew = available === 0;
  const lowest = Math.min(MIN, maxPoints);
  const noun = changing ? 'change' : 'pick';

  async function watchAd() {
    setBusy(true);
    setMessage(null);
    try {
      const id = await watch('pick');
      if (id) setAdSessionId(id);
      else setMessage(`Watch the whole ad to confirm your ${noun}.`);
    } catch {
      setMessage('No ad is available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!token || !target || !quote || !adSessionId || !active) return;
    setBusy(true);
    setMessage(null);
    try {
      if (changing) {
        await api.changePick(token, changing.pickId, { market, selection, points, expectedPoint: quote.point, expectedPrice: quote.price, adSessionId });
      } else {
        await api.makePick(token, { competitionId: active.id, eventId: game.id, market, selection, points, expectedPoint: quote.point, expectedPrice: quote.price, adSessionId });
      }
      await refresh();
      onPlaced(lineLabel(market, selection, quote.point, game.homeTeam, game.awayTeam), points);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'line_moved' && err.body.line) {
          const l = err.body.line as { point: number | null; price: number };
          const m = l.price > 0 ? 1 + l.price / 100 : 1 + 100 / Math.abs(l.price);
          setQuote({ point: l.point, price: l.price, payout: Math.round(m * 100) / 100 });
          setMessage('The line just changed. Check the new number and confirm again.');
        } else if (err.code === 'locked') setMessage('This game has started, so picks are locked.');
        else if (err.code === 'not_pending') setMessage('That pick has already been graded.');
        else if (err.code === 'bad_amount') setMessage(`Picks are at least ${MIN} points, unless you're using all of your last few points.`);
        else if (err.code === 'already_picked') setMessage(`You already have a ${marketName[market].toLowerCase()} pick on this game.`);
        else if (err.code === 'not_enough_points') setMessage("You don't have enough points for this pick.");
        else if (err.code === 'after_contest_end') setMessage("This game won't be over before your contest ends, so it can't count in it.");
        else if (err.code === 'wrong_sport') setMessage("This contest is for a different sport, so this game doesn't count in it.");
        else if (err.code === 'contest_not_live' || err.code === 'not_joined') setMessage("This contest isn't running right now.");
        else if (err.code === 'pick_ad_required') {
          setAdSessionId(null);
          setMessage(`That ad has expired. Watch another to confirm your ${noun}.`);
        }
        else setMessage('Something went wrong. Try again.');
      } else setMessage('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        {active && <Text style={styles.contest}>{changing ? 'CHANGING YOUR PICK · ' : 'IN: '}{active.name.toUpperCase()}</Text>}
        <Text style={styles.matchup}>
          {game.awayTeam} at {game.homeTeam}
        </Text>
        <Text style={styles.pick}>{lineLabel(market, selection, quote.point, game.homeTeam, game.awayTeam)}</Text>
        <Text style={styles.meta}>
          {marketName[market]} · line {signed(quote.price)} · pays {quote.payout.toFixed(2)}x
        </Text>

        {tooFew ? (
          <GameButton
            title="Get points to make this pick"
            icon="flash"
            onPress={() => {
              onClose();
              router.push('/earn');
            }}
          />
        ) : adSessionId ? (
          <>
            <View style={styles.confirmBox}>
              <Text style={styles.confirmTitle}>{changing ? 'Confirm your new pick' : 'Confirm your pick'}</Text>
              <Text style={styles.confirmLine}>
                {points} pts on {lineLabel(market, selection, quote.point, game.homeTeam, game.awayTeam)}
              </Text>
              <Text style={styles.ret}>
                Win and get back <Text style={{ color: colors.win, fontWeight: '800' }}>{winReturn(points, quote.price)} pts</Text>
              </Text>
            </View>
            {message && <Text style={styles.msg}>{message}</Text>}
            {changing && <Text style={styles.ret}>Your old pick's {changing.points} points go back first. Changing isn't a forfeit.</Text>}
            <GameButton title={changing ? 'Confirm change' : 'Confirm pick'} variant="go" size="lg" icon="checkmark-circle" busy={busy} heavy onPress={confirm} />
            <Pressable style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.stepper}>
              <GameButton variant="neon" size="sm" style={styles.step} onPress={() => setPoints((p) => Math.max(lowest, p - 10))}>
                <Text style={styles.stepText}>-</Text>
              </GameButton>
              <PointsCounter value={points} suffix=" pts" style={[styles.points, glow(colors.accent, 10)]} />
              <GameButton variant="neon" size="sm" style={styles.step} onPress={() => setPoints((p) => Math.min(maxPoints, p + 10))}>
                <Text style={styles.stepText}>+</Text>
              </GameButton>
            </View>
            <View style={styles.chips}>
              {[...CHIPS.filter((c) => c <= maxPoints), maxPoints]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((c) => (
                  <Pressable key={c} style={[styles.chip, points === c && styles.chipOn]} onPress={() => { tap(); setPoints(c); }}>
                    <Text style={[styles.chipText, points === c && styles.chipTextOn]}>{c === maxPoints ? `Max ${c}` : c}</Text>
                  </Pressable>
                ))}
            </View>
            <Text style={styles.ret}>
              Win and get back <Text style={{ color: colors.win, fontWeight: '800' }}>{winReturn(points, quote.price)} pts</Text>
            </Text>
            {message && <Text style={styles.msg}>{message}</Text>}
            <GameButton title={changing ? 'Watch short ad to change pick' : 'Watch ad to confirm pick'} size="lg" icon="play-circle" busy={busy} onPress={watchAd} />
          </>
        )}
      </View>
      {adModal}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,20,0.7)' },
  sheet: { backgroundColor: colors.card, padding: space.xl, paddingBottom: 40, borderTopLeftRadius: 24, borderTopRightRadius: 24, gap: space.md, borderTopWidth: 2, borderColor: colors.neon },
  matchup: { color: colors.muted, fontWeight: '700' },
  contest: { color: colors.pink, fontWeight: '900', fontSize: 12, letterSpacing: 1 },
  pick: { color: colors.text, fontSize: 26, fontWeight: '900' },
  meta: { color: colors.neon, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: space.md },
  step: { width: 52 },
  stepText: { color: '#022A30', fontSize: 24, fontWeight: '900' },
  points: { color: colors.accent, fontSize: 32, fontWeight: '900', minWidth: 130, textAlign: 'center' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.cardAlt },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '800' },
  chipTextOn: { color: colors.accentText, fontWeight: '900' },
  ret: { color: colors.text, textAlign: 'center', fontWeight: '600' },
  msg: { color: colors.accent, textAlign: 'center', fontWeight: '700' },
  confirmBox: { backgroundColor: colors.cardAlt, borderRadius: 16, padding: space.lg, gap: space.sm, alignItems: 'center', borderWidth: 2, borderColor: colors.win },
  confirmTitle: { color: colors.win, fontWeight: '900', letterSpacing: 2 },
  confirmLine: { color: colors.text, fontSize: 19, fontWeight: '900', textAlign: 'center' },
  cancel: { alignItems: 'center', padding: space.sm },
  cancelText: { color: colors.muted, fontWeight: '700' },
});
