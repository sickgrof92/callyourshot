import { ScrollView, StyleSheet, Text } from 'react-native';
import { GameButton } from '../components/GameButton';
import { openPrivacy, openRules } from '../lib/links';
import { colors, space } from '../lib/theme';

// Wording from Mike, with "bet", "wager" and "odds" swapped for the app's words (picks, points, lines).
const RULES: [string, string][] = [
  ['Free to play', 'Call Your Shot is free. There is nothing to buy, and no purchase ever improves your chances.'],
  [
    'Contests',
    'Everything happens inside of contests. Contests are free to join as long as spots are available. There is no limit to how many contests you can join at once. You get 10 free starting points in each contest as soon as you join, with no ad to watch, and contests all operate independently. You can join a contest before it opens and make picks in it right away, on games that start after the contest opens and end before it ends. Your points and picks for each contest stay only within the confines of that contest.',
  ],
  [
    'Getting points',
    'In each contest, you get 10 free starting points when you join. After that, whenever you are out of points there (less than 1 point, with no picks still waiting to be graded), you can watch a short ad for 10 more points, up to 5 times per day in each contest. Your starting points are not a refill: they do not count toward the 5 per day, toward refills used in tiebreakers, or toward reloads in your stats. Winning picks pay points back based on how many points you picked with and the line, to the hundredth of a point (rounded down).',
  ],
  [
    'Making picks',
    "You can use your points to pick the winner, the spread, or the over/under total of real games that both start and end during the contest. You can put any whole number of points on a pick, from 1 point up to your balance in that contest. To make a pick, you watch a short ad before confirming it. You can make picks on a game until it officially starts. You can also change a pick at any time until its game starts, by watching a short ad. Changing a pick does not count as forfeiting: the points from your old pick go toward the new one. If a pick ends in a push (the result lands exactly on the line), the points on it are returned to you in full. Picks on games that are postponed or cancelled are refunded as soon as that is announced.",
  ],
  [
    'Parlays and round robins',
    "A parlay combines 2 to 10 picks, each on a different game, into one pick with one amount of points. It wins only if every pick in it wins, and pays the combined line of all of its picks. If any pick loses, the parlay loses. A pick that ends in a push, or whose game is postponed or cancelled, is dropped, and the parlay is paid on the picks that are left; if every pick is dropped, the points are returned in full. A round robin takes 3 to 8 picks and makes every parlay of the sizes you choose (for example, every 2-pick parlay), each with the same points, and each graded as its own parlay. A parlay or round robin is confirmed with one short ad. Until its first game starts, it can be changed by watching a short ad, just like a single pick: the points on the old one go toward the new one. Once its first game has started, it can be forfeited.",
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
    "Each contest's prize is fixed and announced before the contest starts, and will never change once it starts. The player with the most points when the contest ends will be declared its winner. The order of tiebreakers is as follows:\n•  Fewest refills used (starting points are not a refill)\n•  Best overall win % for the contest\n•  Total number of winning picks\n•  If players are still tied after those, each will be rewarded with the prize (however, if more than 3 players are still tied, additional tiebreaking methods may be used)",
  ],
  [
    'Contest integrity',
    "Contests are never cancelled once announced. The stated prize will always be the prize, unless it becomes unavailable for a reason outside of our control, in which case it will be replaced with a prize of equal or greater value. If a winner is found to have committed fraud, they are disqualified and the prize is awarded to the next finisher who did not (normally the 2nd-place finisher). A technical failure on our side will never cost a winner their prize.",
  ],
  [
    'Claiming your prize',
    'Winners claim their prize in the app, and must be willing to provide the legally required information in order for us to present them with said prize. If you are unwilling to provide the information we are legally required to obtain in order to provide you with your prize, that will serve as you acknowledging forfeiture of the prize.',
  ],
  ['Your profile', 'Your display name and career stats (record, win %, best win streak and reloads, not counting the starting points of each contest) are public. Your email, phone number and location are never shown to other players.'],
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
