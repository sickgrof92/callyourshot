import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { tap } from '../lib/haptics';
import { NOT_ELIGIBLE, REGIONS, regionName, type Country } from '../lib/regions';
import { colors, space } from '../lib/theme';

/** Country toggle plus a tap-to-open list of states or provinces. */
export function RegionPicker({
  country,
  region,
  onChange,
  lockCountry,
}: {
  country: Country;
  region: string | null;
  onChange: (country: Country, region: string | null) => void;
  lockCountry?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: space.sm }}>
      {!lockCountry && (
        <View style={styles.toggle}>
          {(['US', 'CA'] as const).map((c) => (
            <Pressable
              key={c}
              style={[styles.tog, country === c && styles.togOn]}
              onPress={() => {
                tap();
                onChange(c, null);
              }}
            >
              <Text style={[styles.togText, country === c && styles.togTextOn]}>{c === 'US' ? 'United States' : 'Canada'}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <Pressable style={styles.field} onPress={() => setOpen(true)}>
        <Text style={[styles.fieldText, !region && { color: colors.muted }]}>
          {region ? regionName(country, region) : country === 'US' ? 'Choose your state' : 'Choose your province or territory'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)} />
        <View style={styles.sheet}>
          <FlatList
            data={REGIONS[country]}
            keyExtractor={([c]) => c}
            renderItem={({ item: [code, name] }) => {
              const blocked = NOT_ELIGIBLE.has(`${country}:${code}`);
              return (
                <Pressable
                  style={styles.row}
                  onPress={() => {
                    tap();
                    onChange(country, code);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.rowText, code === region && { color: colors.accent }]}>{name}</Text>
                  {blocked && <Text style={styles.blocked}>Not eligible</Text>}
                </Pressable>
              );
            }}
          />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: 14, padding: 4, borderWidth: 2, borderColor: colors.border },
  tog: { flex: 1, padding: space.sm, borderRadius: 10, alignItems: 'center' },
  togOn: { backgroundColor: colors.neon },
  togText: { color: colors.muted, fontWeight: '800' },
  togTextOn: { color: '#022A30' },
  field: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.card, borderRadius: 14, padding: space.md, borderWidth: 2, borderColor: colors.border },
  fieldText: { color: colors.text, fontSize: 18 },
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,20,0.7)' },
  sheet: { maxHeight: '60%', backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingVertical: space.md, borderTopWidth: 2, borderColor: colors.neon },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: space.xl, borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { color: colors.text, fontSize: 17, fontWeight: '700' },
  blocked: { color: colors.loss, fontWeight: '800', fontSize: 12 },
});
