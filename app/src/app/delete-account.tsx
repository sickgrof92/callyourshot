import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { GameButton } from '../components/GameButton';
import { api } from '../lib/api';
import { thump, warn } from '../lib/haptics';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

const GONE = [
  'Your sign-in, email, phone number and location',
  'Your points, picks and spot in every contest, including ones in progress',
  'Your public profile and stats',
  'Any prize you have won but not yet received',
];

export default function DeleteAccount() {
  const { token, signOut } = useSession();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteAccount(token);
      thump();
      // Forget this phone's saved contest choices too.
      for (const k of ['cys.activeContest', 'cys.contestFilters', 'cys.seenWins', 'cys.pushAsked', 'cys.stubDevice']) await SecureStore.deleteItemAsync(k).catch(() => {});
      await signOut();
      router.replace('/welcome');
    } catch {
      warn();
      setError("Couldn't delete your account. Check your connection and try again, or use Contact us.");
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Delete your account?</Text>
        <Text style={styles.p}>This can't be undone. It permanently removes:</Text>
        {GONE.map((g) => (
          <Text key={g} style={styles.item}>
            • {g}
          </Text>
        ))}
        <Text style={styles.p}>
          If we've already sent you a prize, we keep that prize record (name, address and tax details) for tax records. Nothing else is kept.
        </Text>
        <Text style={styles.label}>Type DELETE to confirm</Text>
        <TextInput
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="DELETE"
          placeholderTextColor={colors.muted}
          style={styles.input}
          accessibilityLabel="Type DELETE to confirm"
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <GameButton title="Delete my account" variant="danger" size="lg" icon="trash" heavy busy={busy} disabled={typed.trim().toUpperCase() !== 'DELETE'} onPress={remove} />
        <GameButton title="Keep my account" variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md },
  h1: { color: colors.loss, fontSize: 26, fontWeight: '900' },
  p: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  item: { color: colors.text, fontSize: 15, lineHeight: 22, paddingLeft: space.sm },
  label: { color: colors.muted, fontWeight: '800', letterSpacing: 0.5, marginTop: space.md },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 14, padding: space.md, fontSize: 18, borderWidth: 2, borderColor: colors.border, letterSpacing: 2 },
  error: { color: colors.loss, fontWeight: '700' },
});
