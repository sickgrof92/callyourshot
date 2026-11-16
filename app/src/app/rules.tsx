import { ScrollView, StyleSheet, Text } from 'react-native';
import { GameButton } from '../components/GameButton';
import { openPrivacy, openRules } from '../lib/links';
import { colors, space } from '../lib/theme';

const RULES: [string, string][] = [
  ['Free to play', 'Call Your Shot is free. There is nothing to buy, and no purchase ever improves your chances.'],
  ['Contests', "Everything happens inside a contest. Contests are free to join while there's room, and you can join as many as you like. Each one starts you at 0 points, so everyone starts on a level field. Your points and picks stay inside that contest."],
  ['Getting points', "In each contest, watch a short video to get 10 points. You can do this when you're out of points in that contest and have no picks in play there, up to 5 times a day per contest. Winning picks pay points back too."],
  ['Making picks', "Use a contest's points on the winner, spread or total of real games that start before the contest ends. Each pick needs one short ad, then you confirm it. Picks lock when each game is scheduled to start. Lines may be a little behind live numbers."],
  ['Forfeiting', 'Once a game has started, you can forfeit a pick by watching an ad. A forfeited pick counts as a loss and its points are gone. It just lets you get back to 0 sooner so you can watch for new points.'],
  ['Points', 'Points have no cash value. They cannot be bought, sold, transferred, or exchanged for money or prizes.'],
  ['Who can play', 'Residents of the US and Canada, except Quebec. Winners must be at least the age of majority where they live (18 in most places, 19 or 21 in some), and Canadian winners answer a skill-testing math question.'],
  ['Prizes', "Each contest's prize is fixed and announced before the contest starts, and can't change once it starts. The player with the most points in the contest when it ends and its picks are graded wins. Ties go to fewest refills used, then best win %, then most winning picks. If players are still tied, each of them wins the full prize. Winners claim their prize in the app."],
  ['Your profile', 'Your display name and career stats (record, win %, best win streak and reloads) are public. Your email, phone number and location are never shown to other players.'],
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
      <GameButton title="Official Rules" variant="ghost" icon="document-text" onPress={openRules} />
      <GameButton title="Privacy Policy" variant="ghost" icon="shield-checkmark" onPress={openPrivacy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.lg },
  h: { color: colors.text, fontWeight: '800' },
  p: { color: colors.muted, fontSize: 15, lineHeight: 22 },
});
