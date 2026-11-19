import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ContestSwitcher } from '../../components/ContestSwitcher';
import { GameButton } from '../../components/GameButton';
import { PointsCounter } from '../../components/PointsCounter';
import { ApiError } from '../../lib/api';
import { useContests } from '../../lib/contests';
import { contestClock } from '../../lib/format';
import { useSession } from '../../lib/session';
import { colors, glow, kindColor, space } from '../../lib/theme';
import { useAd } from '../../lib/useAd';

export default function Points() {
  const { me } = useSession();
  const { active, refresh } = useContests();
  const { watch, adModal } = useAd();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!me) return null;
  const m = active?.mine;

  async function earn() {
    if (!active) return;
    setBusy(true);
    setMessage(null);
    try {
      const done = await watch('points', active.id);
      if (done) setParty({ title: `+${me?.adRewardPoints ?? 10} POINTS!`, subtitle: active.name, color: colors.accent });
      else setMessage('Watch the whole video to get your points.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'points_in_play') setMessage('You still have picks in play in this contest.');
      else if (err instanceof ApiError && err.code === 'daily_limit') setMessage("You've used all of today's refills in this contest.");
      else if (err instanceof ApiError && err.code === 'not_out_of_points') setMessage('You still have points to use in this contest.');
      else setMessage('No video is available right now. Try again in a minute.');
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  let title = '';
  let detail = '';
  if (m) {
    const left = Math.max(0, m.pointsAdsPerDay - m.pointsAdsToday);
    if (m.canEarnPoints) {
      title = !m.hasStartingPoints ? 'Get your starting points' : "You're out of points";
      detail = !m.hasStartingPoints
        ? `Watch a short video to get your ${me.adRewardPoints} starting points in this contest. These don't count as a refill.`
        : `Watch a short video to get ${me.adRewardPoints} points in this contest. ${left} of ${m.pointsAdsPerDay} refills left today.`;
    } else if (m.balance >= 1) {
      title = 'Go make some picks';
      detail = `You can refill once you're under 1 point here with no picks in play, up to ${m.pointsAdsPerDay} times per day in each contest. Picks can be as small as 1 point.`;
    } else if (m.picksInPlay > 0) {
      title = `Waiting on ${m.picksInPlay} pick${m.picksInPlay === 1 ? '' : 's'}`;
      detail = 'You can refill once your picks in this contest are graded. If a pick is clearly losing, you can forfeit it in My Picks to get back sooner.';
    } else {
      title = "That's all for today";
      detail = `You've used all ${m.pointsAdsPerDay} refills in this contest today. Come back tomorrow, or play another contest.`;
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ContestSwitcher />
      {active && m && (
        <ScrollView contentContainerStyle={styles.wrap}>
          <Text style={[styles.contestName, { color: kindColor[active.kind] }]} numberOfLines={1}>
            {active.name.toUpperCase()}
          </Text>
          <Text style={styles.balanceLabel}>YOUR POINTS</Text>
          <PointsCounter value={m.balance} style={[styles.balance, glow(colors.accent, 22)]} />
          <View style={styles.pips}>
            {Array.from({ length: m.pointsAdsPerDay }, (_, i) => (
              <View key={i} style={[styles.pip, i < m.pointsAdsPerDay - m.pointsAdsToday ? styles.pipOn : null]} />
            ))}
          </View>
          <Text style={styles.pipLabel}>
            {Math.max(0, m.pointsAdsPerDay - m.pointsAdsToday)} of {m.pointsAdsPerDay} refills left today
          </Text>

          <View style={styles.card}>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.sub}>{detail}</Text>
            {m.canEarnPoints && <GameButton title={`Watch video for ${me.adRewardPoints} points`} icon="play-circle" size="lg" busy={busy} onPress={earn} />}
            {!m.canEarnPoints && m.picksInPlay > 0 && m.balance < me.minPickPoints && (
              <GameButton title="Go to My Picks" variant="ghost" icon="list" onPress={() => router.push('/mypicks')} />
            )}
            {m.balance >= 1 && <GameButton title="Make picks" variant="go" icon="american-football" onPress={() => router.push('/games')} />}
            {message && <Text style={styles.msg}>{message}</Text>}
          </View>

          <View style={[styles.prize, { borderColor: kindColor[active.kind] }]}>
            <Text style={styles.prizeLabel}>PRIZE</Text>
            <Text style={styles.prizeText}>{active.prize}</Text>
            <Text style={styles.clock}>{contestClock(active.status, active.startsAt, active.endsAt)}</Text>
            <GameButton title="See the leaderboard" variant="ghost" size="sm" icon="podium" onPress={() => router.push(`/contest/${active.id}`)} />
          </View>

          <Text style={styles.fine}>
            Points are free, stay inside each contest, and have no cash value. They can't be bought, sold or transferred.{' '}
            <Text style={{ textDecorationLine: 'underline' }} onPress={() => router.push('/howto')}>
              How it works
            </Text>
          </Text>
        </ScrollView>
      )}
      {adModal}
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg, paddingBottom: 40 },
  contestName: { textAlign: 'center', fontWeight: '900', letterSpacing: 1.5, fontSize: 13 },
  balanceLabel: { color: colors.muted, textAlign: 'center', fontWeight: '900', letterSpacing: 2, marginTop: -8 },
  balance: { color: colors.accent, fontSize: 72, fontWeight: '900', textAlign: 'center', marginVertical: -8 },
  pips: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  pip: { width: 28, height: 10, borderRadius: 5, backgroundColor: '#0F0B29', borderWidth: 1, borderColor: colors.border },
  pipOn: { backgroundColor: colors.neon, borderColor: colors.neon },
  pipLabel: { color: colors.muted, textAlign: 'center', fontSize: 12, marginTop: -8, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: space.xl, gap: space.md, borderWidth: 2, borderColor: colors.border },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  sub: { color: colors.muted, lineHeight: 20 },
  msg: { color: colors.accent, textAlign: 'center', fontWeight: '700' },
  prize: { backgroundColor: colors.card, borderRadius: 16, padding: space.lg, gap: 6, borderWidth: 2 },
  prizeLabel: { color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 11 },
  prizeText: { color: colors.accent, fontWeight: '900', fontSize: 20 },
  clock: { color: colors.text, fontWeight: '700', marginBottom: 4 },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
