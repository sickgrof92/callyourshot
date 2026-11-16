import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { api, ApiError, type Game, type LineQuote, type Market, type Selection } from '../lib/api';
import { lineLabel, marketName, signed } from '../lib/format';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

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

export function PickSheet({ target, onClose, onPlaced }: { target: PickTarget | null; onClose: () => void; onPlaced: () => void }) {
  const { token, me, refresh } = useSession();
  const [points, setPoints] = useState(MIN);
  const [quote, setQuote] = useState<LineQuote | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setPoints(MIN);
    setQuote(target?.quote ?? null);
    setMessage(null);
  }, [target]);

  if (!target || !quote) return null;
  const { game, market, selection } = target;
  const balance = me?.balance ?? 0;
  const maxPoints = Math.min(MAX, balance);
  const tooFew = balance < MIN;

  async function confirm() {
    if (!token || !target || !quote) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.makePick(token, { eventId: game.id, market, selection, points, expectedPoint: quote.point, expectedPrice: quote.price });
      await refresh();
      onPlaced();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'line_moved' && err.body.line) {
          const l = err.body.line as { point: number | null; price: number };
          const m = l.price > 0 ? 1 + l.price / 100 : 1 + 100 / Math.abs(l.price);
          setQuote({ point: l.point, price: l.price, payout: Math.round(m * 100) / 100 });
          setMessage('The line just changed. Check the new number and confirm again.');
        } else if (err.code === 'locked') setMessage('This game has started, so picks are locked.');
        else if (err.code === 'already_picked') setMessage(`You already have a ${marketName[market].toLowerCase()} pick on this game.`);
        else if (err.code === 'not_enough_points') setMessage('Not enough points. Watch a video to earn more.');
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
        <Text style={styles.matchup}>
          {game.awayTeam} at {game.homeTeam}
        </Text>
        <Text style={styles.pick}>{lineLabel(market, selection, quote.point, game.homeTeam, game.awayTeam)}</Text>
        <Text style={styles.meta}>
          {marketName[market]} · line {signed(quote.price)} · pays {quote.payout.toFixed(2)}x
        </Text>

        {tooFew ? (
          <Pressable
            style={styles.btn}
            onPress={() => {
              onClose();
              router.push('/earn');
            }}
          >
            <Text style={styles.btnText}>Earn points to make this pick</Text>
          </Pressable>
        ) : (
          <>
            <View style={styles.stepper}>
              <Pressable style={styles.step} onPress={() => setPoints((p) => Math.max(MIN, p - 10))}>
                <Text style={styles.stepText}>-</Text>
              </Pressable>
              <Text style={styles.points}>{points} pts</Text>
              <Pressable style={styles.step} onPress={() => setPoints((p) => Math.min(maxPoints, p + 10))}>
                <Text style={styles.stepText}>+</Text>
              </Pressable>
            </View>
            <View style={styles.chips}>
              {[...CHIPS.filter((c) => c <= maxPoints), maxPoints]
                .filter((v, i, a) => a.indexOf(v) === i)
                .map((c) => (
                  <Pressable key={c} style={[styles.chip, points === c && styles.chipOn]} onPress={() => setPoints(c)}>
                    <Text style={[styles.chipText, points === c && styles.chipTextOn]}>{c === maxPoints ? `Max ${c}` : c}</Text>
                  </Pressable>
                ))}
            </View>
            <Text style={styles.ret}>
              Win and get back <Text style={{ color: colors.win, fontWeight: '800' }}>{winReturn(points, quote.price)} pts</Text>
            </Text>
            {message && <Text style={styles.msg}>{message}</Text>}
            <Pressable style={styles.btn} disabled={busy} onPress={confirm}>
              {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.btnText}>Lock in pick</Text>}
            </Pressable>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: colors.card, padding: space.xl, paddingBottom: 40, borderTopLeftRadius: 20, borderTopRightRadius: 20, gap: space.md },
  matchup: { color: colors.muted },
  pick: { color: colors.text, fontSize: 24, fontWeight: '800' },
  meta: { color: colors.muted },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl, marginTop: space.md },
  step: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: colors.text, fontSize: 24, fontWeight: '700' },
  points: { color: colors.text, fontSize: 28, fontWeight: '800', minWidth: 120, textAlign: 'center' },
  chips: { flexDirection: 'row', justifyContent: 'center', gap: space.sm, flexWrap: 'wrap' },
  chip: { paddingVertical: 6, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text },
  chipTextOn: { color: colors.accentText, fontWeight: '700' },
  ret: { color: colors.text, textAlign: 'center' },
  msg: { color: colors.accent, textAlign: 'center' },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: space.md, alignItems: 'center' },
  btnText: { color: colors.accentText, fontWeight: '800', fontSize: 17 },
});
