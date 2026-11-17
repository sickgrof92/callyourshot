import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, space } from '../lib/theme';
import { GameButton } from './GameButton';

const SECONDS = 5;

/** Development stand-in for a rewarded video. Closing early earns nothing. */
export function StubAdModal({ visible, onFinish }: { visible: boolean; onFinish: (completed: boolean) => void }) {
  const [left, setLeft] = useState(SECONDS);

  useEffect(() => {
    if (!visible) return;
    setLeft(SECONDS);
    const id = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [visible]);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={() => onFinish(false)}>
      <View style={styles.wrap}>
        <Text style={styles.tag}>SAMPLE AD</Text>
        <Text style={styles.title}>Your sponsor's video would play here</Text>
        <Text style={styles.sub}>Development mode: no ad network is connected.</Text>
        {left > 0 ? (
          <Text style={styles.count}>Done in {left}s</Text>
        ) : (
          <GameButton title="Continue" variant="go" style={{ marginTop: space.lg, minWidth: 200 }} onPress={() => onFinish(true)} />
        )}
        <Pressable onPress={() => onFinish(false)} style={styles.close}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  tag: { color: colors.accent, fontWeight: '700', letterSpacing: 2 },
  title: { color: colors.text, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  sub: { color: colors.muted, textAlign: 'center' },
  count: { color: colors.text, fontSize: 18, marginTop: space.lg },
  btn: { backgroundColor: colors.accent, paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: 12, marginTop: space.lg },
  btnText: { color: colors.accentText, fontWeight: '700', fontSize: 16 },
  close: { position: 'absolute', top: 60, right: 24 },
  closeText: { color: colors.muted },
});
