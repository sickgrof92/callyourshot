import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api, type PlayerStats } from '../../lib/api';
import { colors, glow, space } from '../../lib/theme';

function Stat({ label, value, color = colors.text }: { label: string; value: string; color?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** A player's public profile: career stats only, never contact details or location. */
export default function Player() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const [p, setP] = useState<PlayerStats | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (name) api.player(name).then(setP).catch(() => setError(true));
  }, [name]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Stack.Screen options={{ title: name ?? 'Player' }} />
      {!p ? (
        error ? <Text style={styles.muted}>Couldn't load this player.</Text> : <ActivityIndicator color={colors.accent} />
      ) : (
        <>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{p.displayName.slice(0, 2).toUpperCase()}</Text>
          </View>
          <Text style={[styles.name, glow(colors.neon, 12)]}>{p.displayName}</Text>
          <Text style={styles.muted}>Playing since {new Date(p.joinedAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</Text>

          <View style={styles.record}>
            <Text style={styles.recordLabel}>RECORD (W-L-T)</Text>
            <Text style={[styles.recordValue, glow(colors.accent, 14)]}>
              {p.wins}-{p.losses}-{p.ties}
            </Text>
          </View>

          <View style={styles.grid}>
            <Stat label="Win %" value={p.winPct === null ? '-' : `${Math.round(p.winPct * 1000) / 10}%`} color={colors.win} />
            <Stat label="Best win streak" value={String(p.longestWinStreak)} color={colors.pink} />
            <Stat label="Reloads" value={String(p.reloads)} color={colors.neon} />
            <Stat label="Contests won" value={String(p.contestsWon)} color={colors.gold} />
          </View>
          <Text style={styles.fine}>Forfeits count as losses. Ties are pushes. Reloads are videos watched for points.</Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md, alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, backgroundColor: colors.cardAlt, borderWidth: 3, borderColor: colors.neon, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.neon, fontSize: 32, fontWeight: '900' },
  name: { color: colors.text, fontSize: 28, fontWeight: '900' },
  muted: { color: colors.muted },
  record: { alignSelf: 'stretch', backgroundColor: colors.card, borderRadius: 20, borderWidth: 2, borderColor: colors.accent, padding: space.lg, alignItems: 'center' },
  recordLabel: { color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 12 },
  recordValue: { color: colors.accent, fontSize: 44, fontWeight: '900' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md, alignSelf: 'stretch' },
  stat: { flexBasis: '47%', flexGrow: 1, backgroundColor: colors.card, borderRadius: 16, borderWidth: 2, borderColor: colors.border, padding: space.lg, alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '900' },
  statLabel: { color: colors.muted, fontWeight: '800', marginTop: 2 },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center' },
});
