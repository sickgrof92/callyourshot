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

export function PickSheet({ target, onClose, onPlaced }: { target: PickTarget | null; onClose: () => void; onPlaced: (label: string, points: number) => void }) {
  const { token } = useSession();
  const { active, refresh } = useContests();
  const [points, setPoints] = useState(MIN);
  const [quote, setQuote] = useState<LineQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Every pick needs its own ad. Once watched, the player confirms on a second screen.
  const [adSessionId, setAdSessionId] = useState<string | null>(null);
  const { watch, adModal } = useAd();

  useEffect(() => {
    setPoints(MIN);
    setQuote(target?.quote ?? null);
    setMessage(null);
    setAdSessionId(null);
  }, [target]);

  if (!target || !quote) return null;
  const { game, market, selection } = target;
  const balance = active?.mine?.balance ?? 0;
  const maxPoints = Math.min(MAX, balance);
  const tooFew = balance < MIN;

  async function watchAd() {
    setBusy(true);
    setMessage(null);
    try {
      const id = await watch('pick');
      if (id) setAdSessionId(id);
      else setMessage('Watch the whole ad to confirm your pick.');
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
      await api.makePick(token, { competitionId: active.id, eventId: game.id, market, selection, points, expectedPoint: quote.point, expectedPrice: quote.price, adSessionId });
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
        else if (err.code === 'already_picked') setMessage(`You already have a ${marketName[market].toLowerCase()} pick on this game.`);
        else if (err.code === 'not_enough_points') setMessage("You don't have enough points for this pick.");
        else if (err.code === 'after_contest_end') setMessage("This game won't be over before your contest ends, so it can't count in it.");
        else if (err.code === 'wrong_sport') setMessage("This contest is for a different sport, so this game doesn't count in it.");
        else if (err.code === 'contest_not_live' || err.code === 'not_joined') setMessage("This contest isn't running right now.");
        else if (err.code === 'pick_ad_required') {
          setAdSessionId(null);
          setMessage('That ad has expired. Watch another to confirm your pick.');
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
        {active && <Text style={styles.contest}>IN: {active.name.toUpperCase()}</Text>}
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
              <Text style={styles.confirmTitle}>Confirm your pick</Text>
              <Text style={styles.confirmLine}>
                {points} pts on {lineLabel(market, selection, quote.point, game.homeTeam, game.awayTeam)}
              </Text>
              <Text style={styles.ret}>
                Win and get back <Text style={{ color: colors.win, fontWeight: '800' }}>{winReturn(points, quote.price)} pts</Text>
              </Text>
            </View>
            {message && <Text style={styles.msg}>{message}</Text>}
            <GameButton title="Confirm pick" variant="go" size="lg" icon="checkmark-circle" busy={busy} heavy onPress={confirm} />
            <Pressable style={styles.cancel} onPress={onClose}>
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.stepper}>
              <GameButton variant="neon" size="sm" style={styles.step} onPress={() => setPoints((p) => Math.max(MIN, p - 10))}>
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
            <GameButton title="Watch ad to confirm pick" size="lg" icon="play-circle" busy={busy} onPress={watchAd} />
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
