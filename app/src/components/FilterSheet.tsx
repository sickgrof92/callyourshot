import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  DEFAULT_FILTERS,
  LENGTH_MAX,
  LENGTH_MIN,
  lengthText,
  PRIZE_OPTIONS,
  SHOW_OPTIONS,
  SORT_OPTIONS,
  STARTS_OPTIONS,
  type Filters,
} from '../lib/contestFilters';
import { tap } from '../lib/haptics';
import { colors, space } from '../lib/theme';
import { GameButton } from './GameButton';
import { RangeSlider } from './RangeSlider';

function Group<T extends string>({ title, options, value, onPick }: { title: string; options: [T, string][]; value: T; onPick: (v: T) => void }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.chips}>
        {options.map(([k, text]) => {
          const on = k === value;
          return (
            <Pressable
              key={k || 'any'}
              onPress={() => {
                tap();
                onPick(k);
              }}
              style={[styles.chip, on && styles.chipOn]}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{text}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function FilterSheet({
  open,
  value,
  sports,
  onApply,
  onClose,
}: {
  open: boolean;
  value: Filters;
  sports: { key: string; label: string }[];
  onApply: (f: Filters) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const set = <K extends keyof Filters>(k: K) => (v: Filters[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const sportOptions: [string, string][] = [['', 'Any sport'], ...sports.map((s): [string, string] => [s.key, s.label]), ['any', 'All-sport contests only']];

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close filters" />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.head}>
          <Text style={styles.title}>Filter contests</Text>
          <Pressable onPress={() => setDraft(DEFAULT_FILTERS)} hitSlop={10}>
            <Text style={styles.reset}>Reset</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: space.lg, paddingBottom: space.lg }}>
          <Group title="SORT BY" options={SORT_OPTIONS} value={draft.sort} onPick={set('sort')} />
          <View style={{ gap: space.sm }}>
            <Group title="SHOW" options={SHOW_OPTIONS} value={draft.show} onPick={set('show')} />
            <Pressable
              onPress={() => {
                tap();
                setDraft((d) => ({ ...d, entered: !d.entered }));
              }}
              style={styles.toggleRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.entered }}
            >
              <Ionicons name={draft.entered ? 'checkbox' : 'square-outline'} size={24} color={draft.entered ? colors.neon : colors.muted} />
              <Text style={[styles.toggleText, draft.entered && { color: colors.text }]}>Only contests I entered</Text>
            </Pressable>
          </View>
          <Group title="SPORT" options={sportOptions} value={draft.sport} onPick={set('sport')} />
          <Group title="STARTS" options={STARTS_OPTIONS} value={draft.starts} onPick={set('starts')} />
          <View style={{ gap: space.sm }}>
            <View style={styles.rowBetween}>
              <Text style={styles.groupTitle}>LENGTH</Text>
              <Text style={styles.value}>
                {draft.lengthMin === LENGTH_MIN && draft.lengthMax === LENGTH_MAX
                  ? 'Any length'
                  : draft.lengthMin === draft.lengthMax
                    ? lengthText(draft.lengthMin)
                    : `${draft.lengthMin} to ${lengthText(draft.lengthMax)}`}
              </Text>
            </View>
            <RangeSlider
              min={LENGTH_MIN}
              max={LENGTH_MAX}
              low={draft.lengthMin}
              high={draft.lengthMax}
              onChange={(lo, hi) => setDraft((d) => ({ ...d, lengthMin: lo, lengthMax: hi }))}
              accessibilityLabel="Contest length in days"
            />
            <View style={styles.rowBetween}>
              <Text style={styles.scale}>1 day</Text>
              <Text style={styles.scale}>30+ days</Text>
            </View>
          </View>
          <View style={{ gap: space.sm }}>
            <Text style={styles.groupTitle}>SIZE (MAX PLAYERS)</Text>
            <View style={styles.sizeRow}>
              <TextInput
                value={draft.sizeMin}
                onChangeText={(t) => setDraft((d) => ({ ...d, sizeMin: t.replace(/\D/g, '') }))}
                keyboardType="number-pad"
                placeholder="Min"
                placeholderTextColor={colors.muted}
                style={styles.num}
                maxLength={7}
                accessibilityLabel="Minimum players"
              />
              <Text style={styles.to}>to</Text>
              <TextInput
                value={draft.sizeMax}
                onChangeText={(t) => setDraft((d) => ({ ...d, sizeMax: t.replace(/\D/g, '') }))}
                keyboardType="number-pad"
                placeholder="Max"
                placeholderTextColor={colors.muted}
                style={styles.num}
                maxLength={7}
                accessibilityLabel="Maximum players"
              />
            </View>
            {!!draft.sizeMin && !!draft.sizeMax && Number(draft.sizeMin) > Number(draft.sizeMax) && (
              <Text style={styles.warn}>Min is bigger than max, so nothing will match.</Text>
            )}
          </View>
          <Group title="PRIZE" options={PRIZE_OPTIONS} value={draft.prizeType} onPick={set('prizeType')} />
        </ScrollView>
        <GameButton
          title="Show contests"
          variant="go"
          size="lg"
          icon="funnel"
          heavy
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </View>
    </Modal>
  );
}

export function FilterIcon({ count }: { count: number }) {
  return (
    <View style={{ marginRight: count > 0 ? 6 : 0 }}>
      <Ionicons name="options" size={18} color={colors.text} />
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(5,3,16,0.7)' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 2,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: colors.text, fontSize: 20, fontWeight: '900' },
  reset: { color: colors.neon, fontWeight: '800' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4 },
  toggleText: { color: colors.muted, fontWeight: '800', fontSize: 15 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  value: { color: colors.neon, fontWeight: '900' },
  scale: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  sizeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  num: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: 17,
    fontWeight: '800',
  },
  to: { color: colors.muted, fontWeight: '800' },
  warn: { color: colors.loss, fontWeight: '700', fontSize: 13 },
  groupTitle: { color: colors.muted, fontWeight: '900', letterSpacing: 1.5, fontSize: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 2, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: colors.neon, backgroundColor: colors.neon },
  chipText: { color: colors.muted, fontWeight: '800' },
  chipTextOn: { color: '#022A30' },
  badge: {
    position: 'absolute',
    top: -7,
    right: -9,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.pink,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '900' },
});
