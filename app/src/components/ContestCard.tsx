import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Contest } from '../lib/api';
import { contestClock } from '../lib/format';
import { colors, glow, kindColor, space } from '../lib/theme';
import { GameButton } from './GameButton';
import { Meter } from './Meter';

export function ContestCard({ c, onJoin, joining }: { c: Contest; onJoin: (c: Contest) => void; joining: boolean }) {
  const color = kindColor[c.kind];
  const full = c.entries >= c.maxEntries;
  return (
    <Pressable onPress={() => router.push(`/contest/${c.id}`)} style={[styles.card, { borderColor: color, shadowColor: color }]}>
      <View style={styles.head}>
        <Text style={[styles.kind, { backgroundColor: color }]}>{c.kind.toUpperCase()}</Text>
        <Text style={[styles.clock, c.status === 'live' && { color: colors.win }]}>
          {c.status === 'live' ? '● LIVE · ' : ''}
          {contestClock(c.status, c.startsAt, c.endsAt)}
        </Text>
      </View>
      <Text style={styles.name}>{c.name}</Text>
      <View style={styles.tags}>
        <Text style={styles.tag}>{c.sportLabel ? `${c.sportLabel} only` : 'All sports'}</Text>
        <Text style={styles.tag}>{c.lengthDays <= 1 ? '1 day' : `${Math.round(c.lengthDays)} days`}</Text>
        <Text style={styles.tag}>{c.prizeType === 'physical' ? 'Physical prize' : 'Gift card'}</Text>
      </View>
      <Text style={styles.prizeLabel}>PRIZE</Text>
      <Text style={[styles.prize, glow(colors.accent, 10)]}>{c.prize}</Text>
      <View style={styles.entriesRow}>
        <Text style={styles.entries}>
          {c.entries} / {c.maxEntries} players
        </Text>
      </View>
      <Meter value={c.entries} max={c.maxEntries} color={color} />
      <View style={{ marginTop: space.sm }}>
        {c.claim === 'pending' ? (
          <GameButton title="You won! Claim my prize" variant="primary" size="md" icon="gift" heavy onPress={() => router.push(`/claim/${c.id}`)} />
        ) : c.status === 'ended' ? (
          <Text style={styles.ended}>{c.winner ? `Winner: ${c.winner}` : 'Final results coming soon'}</Text>
        ) : c.joined ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <Text style={styles.inPts}>{c.mine?.balance ?? 0} pts</Text>
            <GameButton title="You're in · View board" variant="ghost" size="sm" icon="checkmark-circle" style={{ flex: 1 }} onPress={() => router.push(`/contest/${c.id}`)} />
          </View>
        ) : full ? (
          <GameButton title="Full" variant="ghost" size="sm" disabled />
        ) : (
          <GameButton title="Join free" variant="go" size="md" icon="flash" busy={joining} heavy onPress={() => onJoin(c)} />
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: space.lg,
    gap: 4,
    borderWidth: 2,
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  kind: { color: '#120A2E', fontWeight: '900', fontSize: 11, letterSpacing: 1.2, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' },
  clock: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  name: { color: colors.text, fontSize: 18, fontWeight: '900' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  tag: { color: colors.muted, fontSize: 11, fontWeight: '800', borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  prizeLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 4 },
  prize: { color: colors.accent, fontSize: 22, fontWeight: '900' },
  entriesRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  entries: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  inPts: { color: colors.accent, fontWeight: '900', fontSize: 18, minWidth: 64 },
  ended: { color: colors.gold, fontWeight: '800', textAlign: 'center', padding: space.sm },
});
