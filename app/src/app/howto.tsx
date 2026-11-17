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
  { icon: 'flash', color: colors.neon, title: 'Get points', body: 'In the Points tab, watch a short video to be awarded your 10 points for the contest you are playing.' },
  { icon: 'american-football', color: colors.pink, title: 'Make picks', body: 'Search through the available games to make your picks on spreads, winners, or over/unders. After choosing your pick, watch a short ad to be able to confirm it. Winning picks reward points based on how many points you put on the pick and its line. Losing picks lose all the points put on them.' },
  { icon: 'podium', color: colors.purple, title: 'Climb the board', body: 'The player with the most points at the end of the contest wins the prize(s) listed for that contest.' },
];

const FAQ: [string, string][] = [
  ['Does it cost anything?', 'No. Contests are free to enter, and there is nothing to buy. Points have no cash value and can’t be bought, sold or transferred.'],
  ['What happens when I run out of points?', 'When you have no points and no picks waiting to be graded in a contest, you can watch a video for 10 more. You get 5 refills per day in each contest you join.'],
  ['Why can’t I refill right now?', 'Refills are only for when you’re out. If you have picks in play, wait for them to be graded, or forfeit one after its game starts to get back to 0 sooner.'],
  ['What does forfeit do?', 'Once a game has started, you can give up a pick by watching an ad. It counts as a loss and the points are gone, but it lets you refill sooner.'],
  ['When do picks lock?', 'At each game’s scheduled start time. A game can only be picked in a contest if it both starts and ends during the contest. Contests end early in the morning (around 5 AM Eastern), so late games still fit.'],
  ['When are picks graded?', 'Within about 5 minutes of the game ending.'],
  ['What if a game is postponed or cancelled?', 'Your pick is refunded as soon as the postponement or cancellation is announced, and the points go back to your balance in that contest.'],
  ['How are ties broken?', 'Fewest refills used wins, then best win % (forfeits count as losses, pushes don’t count), then most winning picks. If players are still tied, they each win the prize (if more than 3 are still tied, more tiebreakers may be used).'],
  ['How do I get my prize?', 'If you win, open the contest and tap Claim your prize. We ask for your legal name, mailing address and date of birth to verify you and send it. Canadian winners also answer a short math question.'],
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
