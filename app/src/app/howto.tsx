import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GameButton } from '../components/GameButton';
import { tap } from '../lib/haptics';
import { colors, glow, space } from '../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const STEPS: { icon: IconName; color: string; title: string; body: string }[] = [
  { icon: 'trophy', color: colors.accent, title: 'Join a contest', body: 'Pick the contest length of your choice, and join as many contests as you’d like. All players start with only the 10 points awarded at the beginning of each contest.' },
  { icon: 'flash', color: colors.neon, title: 'Get points', body: 'You get 10 free starting points as soon as you join a contest, with no video to watch. They are not a refill, and never count against you. When you run out, the Points tab lets you watch a short video for 10 more.' },
  { icon: 'american-football', color: colors.pink, title: 'Make picks', body: 'Search through the available games to make your picks on spreads, winners, or over/unders. After choosing your pick, choose how many points to put on it (any amount from 1 point up to your balance), then watch a short ad to be able to confirm it. You can also combine picks from different games into a parlay or a round robin. Winning picks reward points based on how many points you put on the pick and its line. Losing picks lose all the points put on them. You can change a pick any time before its game starts by watching a short ad.' },
  { icon: 'podium', color: colors.purple, title: 'Climb the board', body: 'The player with the most points at the end of the contest wins the prize(s) listed for that contest.' },
];

const FAQ: [string, string][] = [
  ['Does it cost anything?', 'No. Contests are free to enter, and there is nothing to buy. Points have no cash value and can’t be bought, sold or transferred.'],
  ['Can I join a contest before it starts?', 'Yes, and you can start playing right away. As soon as you join, you get your 10 starting points and can make picks, even before the contest opens. Only games that start after the contest opens and finish before it ends can be picked in it.'],
  ['What happens when I run out of points?', 'When you have less than 1 point and no picks waiting to be graded in a contest, you can watch a video for 10 more. You get 5 refills per day in each contest you join. Your 10 free starting points when you join a contest are not a refill.'],
  ['Why can’t I refill right now?', 'Refills are only for when you’re under 1 point. If you have 1 point or more, use it: picks can be as small as 1 point. If you have picks in play, wait for them to be graded, or forfeit one after its game starts to run out sooner.'],
  ['Can I change a pick?', 'Yes. Any time before the game starts, open My Picks, tap Change this pick, choose a new line on that game, and watch a short ad. Changing a pick isn’t a forfeit: the points from your old pick go toward the new one.'],
  ['How many points can I put on a pick?', 'Any whole number from 1 point up to the points you have in that contest.'],
  ['What is a parlay?', 'A parlay combines 2 to 10 picks from different games into one pick, with one amount of points on it. Every pick in it has to win, but the payout is much bigger: each pick multiplies what you get back. On Games, switch to Parlay / Round robin, tap a line on each game you want, then tap Review. One short ad confirms the whole parlay.'],
  ['What is a round robin?', 'A round robin takes 3 to 8 picks and makes every smaller parlay out of them, such as every 2-pick parlay ("by 2s"). Each of those parlays gets the same points, so 3 picks by 2s is 3 parlays and costs 3 times your points. Each parlay is graded on its own, so you can still come out ahead if one of your picks loses.'],
  ['What if a pick in my parlay is a push?', 'That pick is dropped and the parlay pays on the picks that are left. If a game is postponed or cancelled, that pick is dropped the same way. If every pick is dropped, all of your points come back. If any pick loses, the parlay loses.'],
  ['Can I change or forfeit a parlay?', 'Yes. Until the first game in it starts, open My Picks, tap Change this parlay (or round robin), swap, add or remove picks or change the points, and watch a short ad. The points on the old one go toward the new one. Once its first game has started, you can forfeit it by watching an ad, and it counts as a loss.'],
  ['What does forfeit do?', 'Once a game has started, you can give up a pick by watching an ad. It counts as a loss and the points are gone, but it lets you refill sooner.'],
  ['When do picks lock?', 'At each game’s scheduled start time. A game can only be picked in a contest if it both starts and ends during the contest. Contests end early in the morning (around 5 AM Eastern), so late games still fit.'],
  ['When are picks graded?', 'Within about 5 minutes of the game ending.'],
  ['What happens if a pick is a push?', 'If the result lands exactly on the line, it’s a push, and all of the points on that pick are returned to you in full.'],
  ['What if a game is postponed or cancelled?', 'Your pick is refunded as soon as the postponement or cancellation is announced, and the points go back to your balance in that contest.'],
  ['How are ties broken?', '1) Fewest refills used (your starting points don’t count)\n2) Best overall win%\n3) Most total winning picks\n4) If players are still tied, all tied players will receive the prize (unless there are more than 3 players tied, in which case additional tiebreakers are decided at the discretion of CallYourShot)'],
  ['How do I get my prize?', 'If you win, simply open that contest and tap Claim my prize. We ask only for the information we are required to obtain in order to provide your prize: your legal name, mailing address and date of birth. In accordance with Canadian law, winners residing in Canada will also have to answer a short math question. US winners whose prizes total $2,000 or more in value in a calendar year will need to provide their Social Security number or tax ID, and will receive the legally required tax forms.'],
  ['Can a contest be cancelled?', 'No. Once a contest is announced, it will always run, and the stated prize will always be the prize. It would only be swapped for a prize of equal or greater value if the original prize becomes unavailable for reasons outside of our control.'],
  ['What if a winner cheated?', 'If fraud is found, that player is disqualified and the prize goes to the next finisher in line who played fairly (normally 2nd place).'],
  ['Who can play?', 'Residents of the US and Canada, except Quebec. Winners must be at least the age of majority where they live.'],
  ['Can other players see my info?', 'They see your display name and stats only. Your email, phone number and location are never shown.'],
];

export default function HowTo() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.wrap}>
      <Text style={[styles.h1, glow(colors.neon, 12)]}>HOW TO PLAY</Text>
      {STEPS.map((s, i) => (
        <View key={s.title} style={[styles.step, { borderColor: s.color }]}>
          <View style={[styles.num, { backgroundColor: s.color }]}>
            <Text style={styles.numText}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name={s.icon} size={18} color={s.color} />
              <Text style={styles.stepTitle}>{s.title}</Text>
            </View>
            <Text style={styles.p}>{s.body}</Text>
          </View>
        </View>
      ))}

      <Text style={[styles.h1, glow(colors.pink, 12), { color: colors.pink, marginTop: space.lg }]}>FAQ</Text>
      {FAQ.map(([q, a], i) => (
        <Pressable
          key={q}
          onPress={() => {
            tap();
            setOpen(open === i ? null : i);
          }}
          style={styles.faq}
          accessibilityRole="button"
          accessibilityState={{ expanded: open === i }}
        >
          <View style={styles.qRow}>
            <Text style={styles.q}>{q}</Text>
            <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={colors.muted} />
          </View>
          {open === i && <Text style={styles.p}>{a}</Text>}
        </Pressable>
      ))}
      <GameButton title="Still stuck? Contact us" variant="ghost" icon="chatbubbles" onPress={() => router.push('/contact')} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md, paddingBottom: 48 },
  h1: { color: colors.neon, fontSize: 24, fontWeight: '900', letterSpacing: 2 },
  step: { flexDirection: 'row', gap: space.md, backgroundColor: colors.card, borderRadius: 16, borderWidth: 2, padding: space.md },
  num: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  numText: { color: '#120A2E', fontWeight: '900', fontSize: 16 },
  stepTitle: { color: colors.text, fontWeight: '900', fontSize: 17 },
  p: { color: colors.muted, fontSize: 15, lineHeight: 21, marginTop: 4 },
  faq: { backgroundColor: colors.card, borderRadius: 14, borderWidth: 2, borderColor: colors.border, padding: space.md },
  qRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  q: { color: colors.text, fontWeight: '800', fontSize: 16, flex: 1 },
});
