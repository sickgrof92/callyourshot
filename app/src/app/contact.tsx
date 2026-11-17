import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GameButton } from '../components/GameButton';
import { api, ApiError, type ContactTopic } from '../lib/api';
import { success, tap, warn } from '../lib/haptics';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';

const TOPICS: { key: ContactTopic; label: string }[] = [
  { key: 'question', label: 'Question' },
  { key: 'problem', label: 'Something broke' },
  { key: 'prize', label: 'My prize' },
  { key: 'idea', label: 'Idea' },
  { key: 'other', label: 'Other' },
];

export default function Contact() {
  const { token } = useSession();
  const [topic, setTopic] = useState<ContactTopic>('question');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      await api.contact(token, topic, body.trim());
      success();
      setSent(true);
      setBody('');
    } catch (err) {
      warn();
      setError(
        err instanceof ApiError && err.code === 'too_many_messages'
          ? "You've sent a few messages today. We'll get back to you soon."
          : err instanceof ApiError
            ? 'Write a little more, then try again.'
            : "Couldn't reach the server. Try again in a minute.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.wrap} keyboardShouldPersistTaps="handled">
        {sent ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={56} color={colors.win} />
            <Text style={styles.doneTitle}>Message sent</Text>
            <Text style={styles.p}>Thanks! We reply to the email on your account, usually within a day or two.</Text>
            <GameButton title="Send another" variant="ghost" onPress={() => setSent(false)} />
          </View>
        ) : (
          <>
            <Text style={styles.p}>Questions, problems, prize help or ideas: send us a note and we'll reply to the email on your account.</Text>
            <Text style={styles.label}>What's it about?</Text>
            <View style={styles.topics}>
              {TOPICS.map((t) => (
                <Pressable
                  key={t.key}
                  onPress={() => {
                    tap();
                    setTopic(t.key);
                  }}
                  style={[styles.topic, topic === t.key && styles.topicOn]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: topic === t.key }}
                >
                  <Text style={[styles.topicText, topic === t.key && styles.topicTextOn]}>{t.label}</Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.label}>Message</Text>
            <TextInput
              value={body}
              onChangeText={setBody}
              multiline
              maxLength={2000}
              placeholder="Tell us what's up"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            {error && <Text style={styles.error}>{error}</Text>}
            <GameButton title="Send" variant="go" size="lg" icon="send" busy={busy} disabled={body.trim().length < 5} onPress={send} />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: space.xl, gap: space.md },
  p: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  label: { color: colors.muted, fontWeight: '800', letterSpacing: 0.5, marginTop: space.sm },
  topics: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  topic: { borderWidth: 2, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  topicOn: { borderColor: colors.neon, backgroundColor: colors.neon },
  topicText: { color: colors.muted, fontWeight: '800' },
  topicTextOn: { color: '#022A30' },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 14,
    padding: space.md,
    fontSize: 16,
    borderWidth: 2,
    borderColor: colors.border,
    minHeight: 160,
    textAlignVertical: 'top',
  },
  error: { color: colors.loss, fontWeight: '700' },
  done: { alignItems: 'center', gap: space.md, marginTop: 60 },
  doneTitle: { color: colors.text, fontSize: 24, fontWeight: '900' },
});
