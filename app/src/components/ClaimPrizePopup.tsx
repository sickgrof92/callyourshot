// The pop-up a winner sees until they claim their prize: on the Contests home
// screen and on the contest's own page. "Later" hides it until the app is
// opened again.

import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, glow, space } from '../lib/theme';
import { GameButton } from './GameButton';

/** Contests whose pop-up was dismissed since the app opened. */
const dismissed = new Set<string>();

export function ClaimPrizePopup({ contest }: { contest: { id: string; name: string; prize: string } | null }) {
  const [, rerender] = useState(0);
  const visible = !!contest && !dismissed.has(contest.id);
  const close = () => {
    if (contest) dismissed.add(contest.id);
    rerender((n) => n + 1);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Ionicons name="trophy" size={56} color={colors.accent} style={{ alignSelf: 'center' }} />
          <Text style={[styles.title, glow(colors.accent, 12)]}>YOU WON!</Text>
          {contest && (
            <Text style={styles.body}>
              You won <Text style={styles.prize}>{contest.prize}</Text> in {contest.name}. Tap below to claim your prize. We'll ask for your legal name, mailing address and date of birth so we can send it.
            </Text>
          )}
          <GameButton
            title="Claim my prize"
            variant="primary"
            size="lg"
            icon="gift"
            heavy
            onPress={() => {
              if (!contest) return;
              close();
              router.push(`/claim/${contest.id}`);
            }}
          />
          <Pressable onPress={close} hitSlop={10} accessibilityRole="button">
            <Text style={styles.later}>Later</Text>
          </Pressable>
        </View>
      </View>
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
    shadowColor: colors.accent,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  title: { color: colors.accent, fontSize: 30, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  body: { color: colors.text, fontSize: 16, lineHeight: 22, textAlign: 'center' },
  prize: { color: colors.accent, fontWeight: '900' },
  later: { color: colors.muted, fontWeight: '800', textAlign: 'center', paddingVertical: space.sm },
});
