import { ScrollView, StyleSheet, Text } from 'react-native';
import { GameButton } from '../components/GameButton';
import { openPrivacy, openRules } from '../lib/links';
import { colors, space } from '../lib/theme';

// Wording from Mike, with "bet", "wager" and "odds" swapped for the app's words (picks, points, lines).
const RULES: [string, string][] = [
  ['Free to play', 'Call Your Shot is free. There is nothing to buy, and no purchase ever improves your chances.'],
  [
    'Contests',
    'Everything happens inside of contests. Contests are free to join as long as spots are available. There is no limit to how many contests you can join at once. Each contest starts with 10 points after watching an ad, and they all operate independently. Your points and picks for each contest stay only within the confines of that contest.',
  ],
  [
    'Getting points',
    'In each contest, you are awarded 10 points after watching a short ad. You can refill your points this way up to 5 times per day in each contest (your first 10 points count as one), whenever you are out of points there: exactly 0 points, with no picks still waiting to be graded. If you have fewer than 10 points left, you can use all of them on one pick. Winning picks pay points back based on how many points you picked with and the line.',
  ],
  [
    'Making picks',
    "You can use your points to pick the winner, the spread, or the over/under total of real games that both start and end during the contest. To make a pick, you watch a short ad before confirming it. You can make picks on a game until it officially starts. You can also change a pick at any time until its game starts, by watching a short ad. Changing a pick does not count as forfeiting: the points from your old pick go toward the new one. If a pick ends in a push (the result lands exactly on the line), the points on it are returned to you in full. Picks on games that are postponed or cancelled are refunded as soon as that is announced.",
  ],
  [
    'Forfeiting',
    "Any time after the game has started, you may forfeit your pick in order to be able to refill and make another pick sooner than the game's end. You watch a short ad and then confirm your forfeit. A forfeited pick counts as a loss, and all points in that pick are removed from your balance in that contest.",
  ],
  ['Points', 'Points do not ever have any cash value. They cannot be bought, sold, transferred, or exchanged for money or prizes.'],
  [
    'Who can play',
    'Residents of the US and Canada, except Quebec. Winners must be at least the age of majority where they live (18 in most places, 19 or 21 in some), and Canadian winners answer a skill-testing math question, in accordance with Canadian law.',
  ],
  [
    'Prizes',
    "Each contest's prize is fixed and announced before the contest starts, and will never change once it starts. The player with the most points when the contest ends will be declared its winner. The order of tiebreakers is as follows:\n•  Fewest refills used\n•  Best overall win % for the contest\n•  Total number of winning picks\n•  If players are still tied after those, each will be rewarded with the prize (however, if more than 3 players are still tied, additional tiebreaking methods may be used)",
  ],
  [
    'Contest integrity',
    "Contests are never cancelled once announced. The stated prize will always be the prize, unless it becomes unavailable for a reason outside of our control, in which case it will be replaced with a prize of equal or greater value. If a winner is found to have committed fraud, they are disqualified and the prize is awarded to the next finisher who did not (normally the 2nd-place finisher). A technical failure on our side will never cost a winner their prize.",
  ],
  [
    'Claiming your prize',
    'Winners claim their prize in the app, and must be willing to provide the legally required information in order for us to present them with said prize. If you are unwilling to provide the information we are legally required to obtain in order to provide you with your prize, that will serve as you acknowledging forfeiture of the prize.',
  ],
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
