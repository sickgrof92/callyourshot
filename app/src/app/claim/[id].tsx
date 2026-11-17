import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { GameButton } from '../../components/GameButton';
import { RegionPicker } from '../../components/RegionPicker';
import { api, ApiError, type ClaimInfo } from '../../lib/api';
import { warn } from '../../lib/haptics';
import { openPrivacy } from '../../lib/links';
import { useSession } from '../../lib/session';
import { colors, glow, space } from '../../lib/theme';

const ERRORS: Record<string, string> = {
  bad_form: 'Please fill in your full name and address.',
  bad_birth_date: 'Enter your birth date as YYYY-MM-DD, e.g. 1990-05-31.',
  tax_id_required: 'Prizes adding up to $2,000 or more in a year need your SSN or ITIN for tax reporting (Form 1099-MISC).',
  wrong_answer: "That's not right. Check the math and try again.",
  too_many_attempts: "That's 3 wrong answers, so we'll review your claim by email.",
  region_not_eligible: 'Prizes cannot be awarded to residents of Quebec.',
  not_configured: "Prize claims aren't switched on yet. Please try again later.",
};

const STATUS_TEXT: Record<string, string> = {
  submitted: "Got it! We're checking your details and will email you soon.",
  verified: "You're verified. Your prize is on its way.",
  paid: 'Your prize has been sent. Congratulations!',
  ineligible: "Sorry, you don't meet the age requirement for this prize.",
  rejected: "We couldn't verify this claim. Check your email for details.",
};

/** The winner's prize claim: kept separate from the profile and stored encrypted on the server. */
export default function Claim() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useSession();
  const [info, setInfo] = useState<ClaimInfo | null>(null);
  const [legalName, setLegalName] = useState('');
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState<string | null>(null);
  const [postal, setPostal] = useState('');
  const [birth, setBirth] = useState('');
  const [taxId, setTaxId] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);

  useEffect(() => {
    if (!token || !id) return;
    api
      .claimInfo(token, id)
      .then((i) => {
        setInfo(i);
        setRegion(i.region);
        if (i.birthDate) setBirth(i.birthDate);
      })
      .catch(() => setError("Couldn't load your claim."));
  }, [token, id]);

  async function submit() {
    if (!token || !id || !info) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.submitClaim(token, id, {
        legalName: legalName.trim(),
        address: { line1: line1.trim(), line2: line2.trim() || undefined, city: city.trim(), region: region ?? '', postalCode: postal.trim(), country: info.country },
        birthDate: birth.trim(),
        taxId: info.needsTaxId ? taxId.trim() : undefined,
        skillAnswer: info.skillQuestion ? Number(answer) : undefined,
      });
      setInfo({ ...info, status: r.status });
      setParty({ title: 'CLAIM SENT!', subtitle: info.prize, color: colors.gold });
    } catch (err) {
      warn();
      if (err instanceof ApiError && err.code === 'under_age') {
        setInfo({ ...info, status: 'ineligible' });
        setError(`Winners must be at least ${String(err.body.minimumAge)} where they live.`);
      } else setError(err instanceof ApiError ? ERRORS[err.code] ?? 'Something went wrong.' : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  const input = (value: string, set: (v: string) => void, placeholder: string, extra: object = {}) => (
    <TextInput value={value} onChangeText={set} placeholder={placeholder} placeholderTextColor={colors.muted} style={styles.input} {...extra} />
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: 'Claim your prize' }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
          {!info ? (
            error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={colors.accent} />
          ) : (
            <>
              <Text style={[styles.title, glow(colors.gold, 16)]}>YOU WON!</Text>
              <Text style={styles.prize}>{info.prize}</Text>
              {info.status !== 'pending' ? (
                <Text style={styles.status}>{STATUS_TEXT[info.status] ?? info.status}</Text>
              ) : (
                <>
                  <Text style={styles.muted}>
                    We need a few details to send your prize. They're encrypted, kept apart from your profile, and only used to verify and
                    deliver your prize.{' '}
                    <Text style={styles.link} onPress={openPrivacy}>
                      Privacy Policy
                    </Text>
                  </Text>
                  <Text style={styles.label}>Legal name</Text>
                  {input(legalName, setLegalName, 'As on your ID', { autoComplete: 'name' })}
                  <Text style={styles.label}>Mailing address</Text>
                  {input(line1, setLine1, 'Street address', { autoComplete: 'street-address' })}
                  {input(line2, setLine2, 'Apt, suite (optional)')}
                  {input(city, setCity, 'City', { autoComplete: 'postal-address-locality' })}
                  <RegionPicker country={info.country} region={region} onChange={(_c, r) => setRegion(r)} lockCountry />
                  {input(postal, setPostal, info.country === 'US' ? 'ZIP code' : 'Postal code', { autoComplete: 'postal-code', autoCapitalize: 'characters' })}
                  <Text style={styles.label}>Date of birth</Text>
                  {input(birth, setBirth, 'YYYY-MM-DD', { keyboardType: 'numbers-and-punctuation', maxLength: 10 })}
                  {info.needsTaxId && (
                    <>
                      <Text style={styles.label}>SSN or ITIN (for the 1099-MISC tax form on prizes of $2,000+ in a year)</Text>
                      {input(taxId, setTaxId, '123-45-6789', { secureTextEntry: true, keyboardType: 'number-pad', maxLength: 11 })}
                    </>
                  )}
                  {info.skillQuestion && (
                    <View style={styles.skill}>
                      <Text style={styles.skillLabel}>SKILL-TESTING QUESTION</Text>
                      <Text style={styles.skillQ}>{info.skillQuestion} = ?</Text>
                      <Text style={styles.muted}>Required by Canadian law before a prize can be awarded. Work it out left to right, with × first.</Text>
                      {input(answer, setAnswer, 'Your answer', { keyboardType: 'number-pad' })}
                    </View>
                  )}
                  {error && <Text style={styles.error}>{error}</Text>}
                  <GameButton title="Send my claim" variant="go" size="lg" icon="gift" heavy busy={busy} onPress={submit} />
                </>
              )}
              {info.status !== 'pending' && error && <Text style={styles.error}>{error}</Text>}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.sm, paddingBottom: 60 },
  title: { color: colors.gold, fontSize: 40, fontWeight: '900', textAlign: 'center' },
  prize: { color: colors.text, fontSize: 22, fontWeight: '900', textAlign: 'center', marginBottom: space.md },
  status: { color: colors.text, fontSize: 17, textAlign: 'center', lineHeight: 24 },
  muted: { color: colors.muted, lineHeight: 20 },
  link: { color: colors.neon, textDecorationLine: 'underline' },
  label: { color: colors.muted, fontWeight: '800', marginTop: space.md },
  input: { backgroundColor: colors.card, color: colors.text, borderRadius: 14, padding: space.md, fontSize: 17, borderWidth: 2, borderColor: colors.border },
  skill: { backgroundColor: colors.cardAlt, borderRadius: 16, padding: space.lg, gap: space.sm, borderWidth: 2, borderColor: colors.pink, marginTop: space.md },
  skillLabel: { color: colors.pink, fontWeight: '900', letterSpacing: 1.5, fontSize: 12 },
  skillQ: { color: colors.text, fontSize: 28, fontWeight: '900' },
  error: { color: colors.loss, fontWeight: '700', textAlign: 'center', marginTop: space.sm },
});
