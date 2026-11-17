import { Modal, StyleSheet, Text, View } from 'react-native';
import { enablePush } from '../lib/notifications';
import { useSession } from '../lib/session';
import { colors, space } from '../lib/theme';
import { GameButton } from './GameButton';

/** Asked once, in context (after a first pick or join): would you like notifications? */
export function PushOffer({ visible, onDone }: { visible: boolean; onDone: () => void }) {
  const { token } = useSession();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onDone}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Want a heads-up when your picks win?</Text>
          <Text style={styles.body}>
            We can tell you when a pick wins or loses, when your game or contest starts, and when new contests open. You choose which ones,
            one switch each, from the bell at the top of the app.
          </Text>
          <GameButton
            title="Turn on notifications"
            variant="neon"
            icon="notifications"
            onPress={async () => {
              if (token) await enablePush(token);
              onDone();
            }}
          />
          <GameButton title="Not now" variant="ghost" size="sm" onPress={onDone} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,20,0.8)', justifyContent: 'center', padding: space.xl },
  card: { backgroundColor: colors.card, borderRadius: 20, padding: space.xl, gap: space.md, borderWidth: 2, borderColor: colors.neon },
  title: { color: colors.text, fontSize: 22, fontWeight: '900' },
  body: { color: colors.muted, lineHeight: 21 },
});
