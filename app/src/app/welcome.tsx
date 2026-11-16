import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

export default function Welcome() {
  const { signUp } = useSession();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signUp(name.trim());
      router.replace('/');
    } catch (err) {
      if (!(err instanceof ApiError)) setError("Couldn't reach the server. It may be waking up, so try again in a minute.");
      else setError(err.status === 409 ? 'That name is taken.' : 'Use 3-20 letters, numbers, dots or underscores.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.inner}>
        <Text style={styles.logo}>Call Your Shot</Text>
        <Text style={styles.pitch}>
          Make picks on real games with free points. Watch a short video to earn 10 points. Top the weekly or monthly
          leaderboard to win the announced prize.
        </Text>
        <Text style={styles.label}>Pick a display name</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
          placeholder="e.g. hoops_mike"
          placeholderTextColor={colors.muted}
          style={styles.input}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable style={[styles.btn, name.trim().length < 3 && styles.btnOff]} disabled={busy || name.trim().length < 3} onPress={submit}>
          {busy ? <ActivityIndicator color={colors.accentText} /> : <Text style={styles.btnText}>Let's go</Text>}
        </Pressable>
        <Text style={styles.fine}>
          Free to play. No purchase necessary. Points have no cash value and can't be bought, sold or transferred.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  logo: { color: colors.accent, fontSize: 34, fontWeight: '800' },
  pitch: { color: colors.text, fontSize: 16, lineHeight: 22, marginBottom: space.lg },
  label: { color: colors.muted, fontWeight: '600' },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 12, padding: space.md, fontSize: 18, borderWidth: 1, borderColor: colors.border },
  error: { color: colors.loss },
  btn: { backgroundColor: colors.accent, borderRadius: 12, padding: space.md, alignItems: 'center', marginTop: space.sm },
  btnOff: { opacity: 0.5 },
  btnText: { color: colors.accentText, fontWeight: '800', fontSize: 17 },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
});
