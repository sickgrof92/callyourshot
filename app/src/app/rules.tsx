import { ScrollView, StyleSheet, Text } from 'react-native';
import { colors, space } from '../lib/theme';

const RULES: [string, string][] = [
  ['Free to play', 'Call Your Shot is free. There is nothing to buy, and no purchase ever improves your chances.'],
  ['Earning points', 'Watch a short video to earn 10 points, up to a daily limit. Points are also returned when your picks win.'],
  ['Making picks', 'Use points on the winner, spread or total of real games. Picks lock when each game is scheduled to start. Lines may be a little behind live numbers.'],
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
