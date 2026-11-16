import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../../lib/api';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';
import { useAd } from '../../lib/useAd';

export default function Points() {
  const { me, refresh } = useSession();
  const { watch, adModal } = useAd();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!me) return null;
  const left = Math.max(0, me.pointsAdsPerDay - me.pointsAdsToday);
  const outOfPoints = me.balance < me.minPickPoints;

  async function earn() {
    setBusy(true);
    setMessage(null);
    try {
      const done = await watch('points');
      setMessage(done ? `+${me?.adRewardPoints ?? 10} points!` : 'Watch the whole video to get your points.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'points_in_play') setMessage('You still have picks in play.');
      else if (err instanceof ApiError && err.code === 'daily_limit') setMessage("You've used all of today's videos for points.");
      else if (err instanceof ApiError && err.code === 'not_out_of_points') setMessage('You still have points to use.');
      else setMessage('No video is available right now. Try again in a minute.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  let title: string;
  let detail: string;
  if (me.canEarnPoints) {
    title = me.pointsAdsToday === 0 && me.balance === 0 ? 'Get your points' : "You're out of points";
    detail = `Watch a short video to get ${me.adRewardPoints} points. ${left} of ${me.pointsAdsPerDay} left today.`;
  } else if (!outOfPoints) {
    title = 'Go make some picks';
    detail = `You can watch for more points once you're out of points and have no picks in play. You get up to ${me.pointsAdsPerDay} a day.`;
  } else if (me.picksInPlay > 0) {
    title = `Waiting on ${me.picksInPlay} pick${me.picksInPlay === 1 ? '' : 's'}`;
    detail = 'You can watch for more points once your picks are graded. If a pick is clearly losing, you can forfeit it in My Picks to get back sooner.';
  } else {
    title = "That's all for today";
    detail = `You've used all ${me.pointsAdsPerDay} videos for points today. Come back tomorrow.`;
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.balanceLabel}>Your points</Text>
      <Text style={styles.balance}>{me.balance}</Text>

      <View style={styles.card}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.sub}>{detail}</Text>
        {me.canEarnPoints && (
          <Pressable style={[styles.btn, busy && styles.btnOff]} disabled={busy} onPress={earn}>
            {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.btnText}>Watch video for {me.adRewardPoints} points</Text>}
          </Pressable>
        )}
        {!me.canEarnPoints && me.picksInPlay > 0 && outOfPoints && (
          <Pressable style={styles.btnGhost} onPress={() => router.push('/mypicks')}>
            <Text style={styles.btnGhostText}>Go to My Picks</Text>
          </Pressable>
        )}
        {message && <Text style={styles.msg}>{message}</Text>}
      </View>

      <View style={styles.scores}>
        <View style={styles.score}>
          <Text style={styles.scoreNum}>{me.weeklyScore}</Text>
          <Text style={styles.scoreLabel}>this week</Text>
        </View>
        <View style={styles.score}>
          <Text style={styles.scoreNum}>{me.monthlyScore}</Text>
          <Text style={styles.scoreLabel}>this month</Text>
        </View>
      </View>

      <Text style={styles.fine}>
        Points are free and have no cash value. They can't be bought, sold or transferred.{' '}
        <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/rules')}>
          How it works
        </Text>
      </Text>
      {adModal}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, gap: space.lg },
  balanceLabel: { color: colors.muted, textAlign: 'center', marginTop: space.lg },
  balance: { color: colors.accent, fontSize: 56, fontWeight: '900', textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.xl, gap: space.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sub: { color: colors.muted, lineHeight: 20 },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: space.md, alignItems: 'center' },
  btnOff: { opacity: 0.5 },
  btnText: { color: colors.accentText, fontWeight: '800', fontSize: 17 },
  btnGhost: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: space.md, alignItems: 'center' },
  btnGhostText: { color: colors.text, fontWeight: '700' },
  msg: { color: colors.text, textAlign: 'center' },
  scores: { flexDirection: 'row', gap: space.md },
  score: { flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: space.lg, alignItems: 'center' },
  scoreNum: { color: colors.text, fontSize: 24, fontWeight: '800' },
  scoreLabel: { color: colors.muted },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 'auto' },
});
