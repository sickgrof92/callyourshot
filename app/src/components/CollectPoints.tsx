// The pop-up on a contest page when the player can collect points there: a
// refill when they're out. (Starting points now come free on joining; the
// "first" wording only shows for a player whose server predates that.)

import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, glow, space } from '../lib/theme';
import { GameButton } from './GameButton';

export function CollectPoints({
  visible,
  first,
  points,
  refillsLeft,
  busy,
  onWatch,
  onClose,
  children,
}: {
  visible: boolean;
  /** No points collected in this contest yet today (e.g. just joined). */
  first: boolean;
  points: number;
  refillsLeft: number;
  busy: boolean;
  onWatch: () => void;
  onClose: () => void;
  /**
   * The ad player. iOS can't show a second pop-up next to this one, only
   * inside it, so the ad must be rendered here while this is open.
   */
  children?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Ionicons name="flash" size={48} color={colors.accent} style={{ alignSelf: "center" }} />
          <Text style={[styles.title, glow(colors.accent, 12)]}>{first ? `COLLECT YOUR ${points} POINTS` : 'OUT OF POINTS'}</Text>
          <Text style={styles.body}>
            {first
              ? `Watch a short video to get your ${points} starting points for this contest. Then make your picks!`
              : `Watch a short video to refill ${points} points in this contest. ${refillsLeft} refill${refillsLeft === 1 ? '' : 's'} left today.`}
          </Text>
          <GameButton title={`Watch video for ${points} points`} variant="primary" size="lg" icon="play-circle" heavy busy={busy} onPress={onWatch} />
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={styles.later}>Not now</Text>
          </Pressable>
        </View>
      </View>
      {children}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,16,0.8)', justifyContent: 'center', padding: space.xl },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    borderWidth: 2,
    borderColor: colors.accent,
    padding: space.xl,
    gap: space.md,
    alignItems: 'stretch',
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  title: { color: colors.accent, fontSize: 24, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  later: { color: colors.muted, fontWeight: '800', textAlign: 'center', paddingVertical: space.sm },
});
