import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GameButton } from '../components/GameButton';
import { RegionPicker } from '../components/RegionPicker';
import { api, API_URL, ApiError } from '../lib/api';
import { tap, warn } from '../lib/haptics';
import { openPrivacy, openRules } from '../lib/links';
import { NOT_ELIGIBLE, type Country } from '../lib/regions';
import { getIdentityToken, providersFor, SignInCancelled, type Provider } from '../lib/identity';
import { useSession } from '../lib/session';
import { colors, glow, space } from '../lib/theme';

const PROFILE_ERRORS: Record<string, string> = {
  email_taken: 'That email is already on another account.',
  phone_taken: 'That phone number is already on another account.',
  name_taken: 'That name is taken. Try another.',
  bad_email: 'Enter a valid email address.',
  bad_phone: 'Enter a valid phone number. Outside the US, start with + and your country code.',
  taken: 'That name, email or phone is already in use.',
  region_not_eligible: 'Sorry, contests are not open to residents of Quebec.',
  bad_region: 'Choose your state or province.',
};

const unreachable = `Couldn't reach the server at ${API_URL}. It may be waking up, so try again in a minute. If this address isn't your Render URL, see "Troubleshooting" in TESTING.md.`;

export default function Welcome() {
  const { signedIn } = useSession();
  const [mode, setMode] = useState<'stub' | 'live' | null>(null);
  const [busy, setBusy] = useState<Provider | 'profile' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // After Apple/Google, a new player fills in their details.
  const [pending, setPending] = useState<{ provider: Provider; idToken: string } | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState<Country>('US');
  const [region, setRegion] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const blocked = !!region && NOT_ELIGIBLE.has(`${country}:${region}`);

  useEffect(() => {
    api
      .authConfig()
      .then((c) => setMode(c.mode))
      .catch(() => {
        setMode('stub');
        setError(unreachable);
      });
  }, []);

  async function start(provider: Provider) {
    if (!mode) return;
    setBusy(provider);
    setError(null);
    try {
      const id = await getIdentityToken(provider, mode);
      const res = await api.signIn({ provider, idToken: id.idToken });
      if ('token' in res) {
        await signedIn(res.token);
        router.replace('/');
        return;
      }
      setPending({ provider, idToken: id.idToken });
      setEmail(res.email ?? id.email ?? '');
    } catch (err) {
      if (err instanceof SignInCancelled) return;
      warn();
      if (err instanceof ApiError) setError("Sign-in didn't work. Try again.");
      else if (err instanceof Error && err.message.includes('development')) setError(err.message);
      else setError(unreachable);
    } finally {
      setBusy(null);
    }
  }

  async function finish() {
    if (!pending) return;
    setBusy('profile');
    setError(null);
    try {
      const res = await api.signIn({ ...pending, profile: { displayName: name.trim(), email: email.trim(), phone: phone.trim(), country, region: region ?? '', acceptedTerms: true } });
      if ('token' in res) {
        await signedIn(res.token);
        router.replace('/');
      }
    } catch (err) {
      warn();
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setPending(null);
          setError('Your sign-in expired. Please sign in again.');
        } else setError(PROFILE_ERRORS[err.code] ?? 'Names are 3-20 letters, numbers, dots or underscores.');
      } else setError(unreachable);
    } finally {
      setBusy(null);
    }
  }

  const canFinish = name.trim().length >= 3 && email.includes('@') && phone.replace(/\D/g, '').length >= 10 && !!region && !blocked && agreed;

  return (
    <KeyboardAvoidingView style={styles.wrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.inner} keyboardShouldPersistTaps="handled">
        <Text style={[styles.logo, glow(colors.accent, 20)]}>CALL YOUR SHOT</Text>
        {!pending ? (
          <>
            <Text style={styles.pitch}>
              Make picks on real games with free points. Join daily, weekly and monthly contests, climb the board, and win the announced prize.
            </Text>
            {(mode ? providersFor(mode) : ['apple', 'google']).map((p) => (
              <GameButton
                key={p}
                variant={p === 'apple' ? 'ghost' : 'neon'}
                size="lg"
                caps={false}
                busy={busy === p}
                disabled={!mode || (busy !== null && busy !== p)}
                onPress={() => start(p as Provider)}
              >
                <View style={styles.provRow}>
                  <Ionicons name={p === 'apple' ? 'logo-apple' : 'logo-google'} size={20} color={p === 'apple' ? colors.text : '#022A30'} />
                  <Text style={[styles.provText, { color: p === 'apple' ? colors.text : '#022A30' }]}>
                    Continue with {p === 'apple' ? 'Apple' : 'Google'}
                  </Text>
                </View>
              </GameButton>
            ))}
            {mode === 'stub' && <Text style={styles.note}>Test mode: no real Apple or Google sign-in happens. Your account is tied to this phone.</Text>}
          </>
        ) : (
          <>
            <Text style={styles.step}>ALMOST THERE</Text>
            <Text style={styles.pitch}>One account per person. Your email and phone are only used to contact you if you win.</Text>
            <Text style={styles.label}>Display name</Text>
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
            <Text style={styles.label}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              autoComplete="email"
              placeholder="you@example.com"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={styles.label}>Phone number</Text>
            <TextInput
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="(555) 123-4567"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Text style={styles.label}>Where you live</Text>
            <RegionPicker
              country={country}
              region={region}
              onChange={(c, r) => {
                setCountry(c);
                setRegion(r);
              }}
            />
            {blocked && <Text style={styles.error}>Sorry, contests are not open to residents of Quebec.</Text>}
            <Pressable
              style={styles.agree}
              onPress={() => {
                tap();
                setAgreed((a) => !a);
              }}
            >
              <Ionicons name={agreed ? 'checkbox' : 'square-outline'} size={26} color={agreed ? colors.win : colors.muted} />
              <Text style={styles.agreeText}>
                I'm at least 18 (or the age of majority where I live), I live in the US or Canada (not Quebec), and I agree to the{' '}
                <Text style={styles.link} onPress={openRules}>
                  Official Rules
                </Text>{' '}
                and{' '}
                <Text style={styles.link} onPress={openPrivacy}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </Pressable>
            {error && <Text style={styles.error}>{error}</Text>}
            <GameButton title="Let's go" variant="go" size="lg" icon="flash" heavy busy={busy === 'profile'} disabled={!canFinish} onPress={finish} />
          </>
        )}
        {!pending && error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.fine}>
          <Text style={styles.link} onPress={openRules}>Official Rules</Text> · <Text style={styles.link} onPress={openPrivacy}>Privacy Policy</Text>
          {'\n'}Free to play. No purchase necessary. Open to residents of the US and Canada (excluding Quebec). Points have no cash value and can't be bought, sold or transferred.</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },
  inner: { flexGrow: 1, justifyContent: 'center', padding: space.xl, gap: space.md },
  logo: { color: colors.accent, fontSize: 38, fontWeight: '900', letterSpacing: 1, textAlign: 'center' },
  step: { color: colors.neon, fontWeight: '900', letterSpacing: 2, textAlign: 'center' },
  pitch: { color: colors.text, fontSize: 16, lineHeight: 22, marginBottom: space.md, textAlign: 'center' },
  provRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  provText: { fontWeight: '900', fontSize: 17 },
  note: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  label: { color: colors.muted, fontWeight: '800', letterSpacing: 0.5 },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 14, padding: space.md, fontSize: 18, borderWidth: 2, borderColor: colors.border },
  error: { color: colors.loss, fontWeight: '700', textAlign: 'center' },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
  agree: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', marginVertical: space.sm },
  agreeText: { color: colors.text, flex: 1, lineHeight: 20 },
  link: { color: colors.neon, textDecorationLine: 'underline', fontWeight: '700' },
});
