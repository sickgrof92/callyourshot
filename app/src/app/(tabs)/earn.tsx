import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { StubAdModal } from '../../components/StubAdModal';
import { api, ApiError } from '../../lib/api';
import { showRewardedAd } from '../../lib/rewardedAd';
import { useSession } from '../../lib/session';
import { colors, space } from '../../lib/theme';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function Earn() {
  const { token, me, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [stubSession, setStubSession] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (!me || !token) return null;
  const capped = me.adsWatchedToday >= me.adDailyCap;

  async function watch() {
    if (!token || !me) return;
    setBusy(true);
    setMessage(null);
    try {
      const session = await api.startAd(token);
      if (session.provider === 'stub') {
        setStubSession(session.sessionId);
        return; // the modal finishes the flow
      }
      const earned = await showRewardedAd(session.sessionId, me.id);
      if (!earned) {
        setMessage('Watch the whole video to earn points.');
        return;
      }
      // The ad network confirms the view to our server directly; wait for it.
      for (let i = 0; i < 10; i++) {
        const s = await api.adStatus(token, session.sessionId);
        if (s.rewarded) {
          setMessage(`+${session.rewardPoints} points!`);
          break;
        }
        await sleep(1500);
      }
      await refresh();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'daily_cap') setMessage("You've hit today's video limit. Come back tomorrow.");
      else setMessage('No video is available right now. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  }

  async function finishStub(completed: boolean) {
    const id = stubSession;
    setStubSession(null);
    setBusy(false);
    if (!completed || !id || !token) {
      setMessage('Watch the whole video to earn points.');
      return;
    }
    try {
      await api.completeStubAd(token, id);
      setMessage(`+${me?.adRewardPoints ?? 10} points!`);
    } catch {
      setMessage('Could not add your points. Try again.');
    }
    await refresh();
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.balanceLabel}>Your points</Text>
      <Text style={styles.balance}>{me.balance}</Text>

      <View style={styles.card}>
        <Text style={styles.title}>Watch a video, earn {me.adRewardPoints} points</Text>
        <Text style={styles.sub}>
          {me.adsWatchedToday} of {me.adDailyCap} videos watched today
        </Text>
        <Pressable style={[styles.btn, (busy || capped) && styles.btnOff]} disabled={busy || capped} onPress={watch}>
          {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.btnText}>{capped ? 'Daily limit reached' : 'Watch video'}</Text>}
        </Pressable>
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
      <StubAdModal visible={stubSession !== null} onFinish={finishStub} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: space.xl, gap: space.lg },
  balanceLabel: { color: colors.muted, textAlign: 'center', marginTop: space.lg },
  balance: { color: colors.accent, fontSize: 56, fontWeight: '900', textAlign: 'center' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: space.xl, gap: space.md },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sub: { color: colors.muted },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: space.md, alignItems: 'center' },
  btnOff: { opacity: 0.5 },
  btnText: { color: colors.accentText, fontWeight: '800', fontSize: 17 },
  msg: { color: colors.text, textAlign: 'center' },
  scores: { flexDirection: 'row', gap: space.md },
  score: { flex: 1, backgroundColor: colors.card, borderRadius: 16, padding: space.lg, alignItems: 'center' },
  scoreNum: { color: colors.text, fontSize: 24, fontWeight: '800' },
  scoreLabel: { color: colors.muted },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 'auto' },
});
