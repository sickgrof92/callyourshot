import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space } from '../lib/theme';

const RULES: [string, string][] = [
  ['Free to play', 'Call Your Shot is free. There is nothing to buy, and no purchase ever improves your chances.'],
  ['Getting points', "Watch a short video to get 10 points. You can do this when you're out of points and have no picks in play, up to 5 times a day. Winning picks pay points back too."],
  ['Making picks', 'Use points on the winner, spread or total of real games. Each pick needs one short ad, then you confirm it. Picks lock when each game is scheduled to start. Lines may be a little behind live numbers.'],
  ['Forfeiting', 'Once a game has started, you can forfeit a pick by watching an ad. A forfeited pick counts as a loss and its points are gone. It just lets you get back to 0 sooner so you can watch for new points.'],
  ['Points', 'Points have no cash value. They cannot be bought, sold, transferred, or exchanged for money or prizes.'],
  ['Leaderboards', 'Your weekly and monthly score is the points you gain in that period: video rewards plus the results of picks on games played in it.'],
  ['Prizes', 'Each prize is fixed and announced before its period begins. The player with the highest score when the period ends wins.'],
];

export default function Rules() {
  return (
    <ScrollView style={{ backgroundColor: colors.bg }} contentContainerStyle={styles.wrap}>
      {RULES.map(([title, body]) => (
        <Text key={title} style={styles.p}>
          <Text style={styles.h}>{title}. </Text>
          {body}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg },
  h: { color: colors.text, fontWeight: '800' },
  p: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
