// Home screen: browse and join contests, with filters. The server filters,
// sorts and pages the list, so this stays quick with lots of contests.

import Ionicons from '@expo/vector-icons/Ionicons';
import * as SecureStore from 'expo-secure-store';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Celebration, type CelebrationInfo } from '../../components/Celebration';
import { ClaimPrizePopup } from '../../components/ClaimPrizePopup';
import { ContestCard } from '../../components/ContestCard';
import { FilterIcon, FilterSheet } from '../../components/FilterSheet';
import { GameButton } from '../../components/GameButton';
import { api, ApiError, type Contest } from '../../lib/api';
import { activeChips, DEFAULT_FILTERS, fromSaved, sortLabel, toQuery, type Filters } from '../../lib/contestFilters';
import { useContests } from '../../lib/contests';
import { tap, warn } from '../../lib/haptics';
import { useSession } from '../../lib/session';
import { colors, glow, space } from '../../lib/theme';

const FILTERS_KEY = 'cys.contestFilters';
const PAGE = 20;

const JOIN_ERRORS: Record<string, string> = {
  full: 'That contest just filled up.',
  ended: 'That contest has ended.',
  already_joined: "You're already in.",
};

/** Remove one chip's filter (size and length chips cover both ends of their range). */
function clearChip(f: Filters, key: keyof Filters): Filters {
  if (key === 'sizeMin') return { ...f, sizeMin: '', sizeMax: '' };
  if (key === 'lengthMin') return { ...f, lengthMin: DEFAULT_FILTERS.lengthMin, lengthMax: DEFAULT_FILTERS.lengthMax };
  return { ...f, [key]: DEFAULT_FILTERS[key] };
}

export default function Contests() {
  const { token } = useSession();
  const [list, setList] = useState<Contest[]>([]);
  const [toClaim, setToClaim] = useState<Contest[]>([]);
  const [sports, setSports] = useState<{ key: string; label: string }[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [party, setParty] = useState<CelebrationInfo | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [filtersReady, setFiltersReady] = useState(false);
  const [sheet, setSheet] = useState(false);
  const contests = useContests();
  // Ignore answers to older requests when filters change quickly.
  const seq = useRef(0);

  // Remember the player's filters between visits.
  useEffect(() => {
    SecureStore.getItemAsync(FILTERS_KEY)
      .then((raw) => raw && setFilters(fromSaved(JSON.parse(raw) as Record<string, unknown>)))
      .catch(() => {})
      .finally(() => setFiltersReady(true));
  }, []);

  const applyFilters = (f: Filters) => {
    setFilters(f);
    SecureStore.setItemAsync(FILTERS_KEY, JSON.stringify(f)).catch(() => {});
  };

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const page = await api.contests(token, { ...toQuery(filters), limit: PAGE });
      if (mine !== seq.current) return;
      setList(page.competitions);
      setToClaim(page.toClaim ?? []);
      setSports(page.sports ?? []);
      setNextOffset(page.nextOffset);
      void contests.refresh();
      setError(null);
    } catch {
      if (mine === seq.current) setError("Couldn't load contests. Pull down to try again.");
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters]);

  async function loadMore() {
    if (nextOffset === null || loadingMore || loading) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await api.contests(token, { ...toQuery(filters), limit: PAGE, offset: nextOffset });
      if (mine !== seq.current) return;
      setList((l) => [...l, ...page.competitions.filter((c) => !l.some((x) => x.id === c.id))]);
      setNextOffset(page.nextOffset);
    } catch {
      // Scrolling again retries.
    } finally {
      setLoadingMore(false);
    }
  }

  useFocusEffect(
    useCallback(() => {
      if (filtersReady) void load();
    }, [load, filtersReady]),
  );

  async function join(c: Contest) {
    if (!token) return;
    setJoining(c.id);
    setError(null);
    try {
      await api.joinContest(token, c.id);
      if (c.status === 'live') contests.setActive(c.id);
      setParty({ title: "YOU'RE IN!", subtitle: c.status === 'live' ? `${c.name} · now playing` : c.name, color: colors.neon });
    } catch (err) {
      warn();
      setError(err instanceof ApiError ? JOIN_ERRORS[err.code] ?? 'Something went wrong.' : 'Could not reach the server.');
    } finally {
      setJoining(null);
      await load();
    }
  }

  const sportLabel = (key: string) => sports.find((s) => s.key === key)?.label ?? key;
  const chips = activeChips(filters, sportLabel);

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.accent} />}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListHeaderComponent={
          <View style={{ gap: space.sm }}>
            <Text style={[styles.h1, glow(colors.pink, 14)]}>CONTESTS</Text>
            <Text style={styles.sub}>Free to join, as many as you like. Each contest starts you with 10 points and your own 5 refills per day.</Text>

            {toClaim.map((c) => (
              <GameButton key={c.id} title={`You won ${c.prize}! Claim it`} variant="primary" icon="gift" heavy onPress={() => router.push(`/claim/${c.id}`)} />
            ))}

            <View style={styles.bar}>
              <Pressable
                onPress={() => {
                  tap();
                  setSheet(true);
                }}
                style={[styles.barBtn, chips.length > 0 && { borderColor: colors.neon }]}
                accessibilityRole="button"
                accessibilityLabel={`Filters${chips.length ? `, ${chips.length} on` : ''}`}
              >
                <FilterIcon count={chips.length} />
                <Text style={styles.barText}>Filters</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  tap();
                  setSheet(true);
                }}
                style={styles.barBtn}
                accessibilityRole="button"
                accessibilityLabel={`Sorted by ${sortLabel(filters)}`}
              >
                <Ionicons name="swap-vertical" size={18} color={colors.text} />
                <Text style={styles.barText}>{sortLabel(filters)}</Text>
              </Pressable>
            </View>

            {chips.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} style={{ flexGrow: 0, flexShrink: 0 }}>
                {chips.map((c) => (
                  <Pressable
                    key={c.key}
                    onPress={() => {
                      tap();
                      applyFilters(clearChip(filters, c.key));
                    }}
                    style={styles.chip}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove filter ${c.text}`}
                  >
                    <Text style={styles.chipText}>{c.text}</Text>
                    <Ionicons name="close" size={14} color="#022A30" />
                  </Pressable>
                ))}
                <Pressable onPress={() => applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} style={styles.clear} accessibilityRole="button">
                  <Text style={styles.clearText}>Clear all</Text>
                </Pressable>
              </ScrollView>
            )}
            {error && <Text style={styles.error}>{error}</Text>}
          </View>
        }
        renderItem={({ item }) => <ContestCard c={item} onJoin={join} joining={joining === item.id} />}
        ListEmptyComponent={
          loading ? undefined : chips.length ? (
            <View style={{ alignItems: 'center', gap: space.md, marginTop: 30 }}>
              <Text style={styles.empty}>No contests match these filters.</Text>
              <GameButton title="Clear filters" variant="ghost" size="sm" icon="close-circle" onPress={() => applyFilters({ ...DEFAULT_FILTERS, sort: filters.sort })} />
            </View>
          ) : (
            <Text style={styles.empty}>No contests right now. New ones are added every day, so check back soon.</Text>
          )
        }
        ListFooterComponent={
          <View>
            {loadingMore && <ActivityIndicator color={colors.accent} style={{ marginVertical: space.lg }} />}
            <Text style={styles.fine} onPress={() => router.push('/howto')}>
              Prizes are fixed and announced before each contest starts. No purchase necessary. <Text style={{ textDecorationLine: 'underline' }}>How to play</Text>
            </Text>
          </View>
        }
      />
      <FilterSheet open={sheet} value={filters} sports={sports} onApply={applyFilters} onClose={() => setSheet(false)} />
      <ClaimPrizePopup contest={party ? null : (toClaim[0] ?? null)} />
      <Celebration info={party} onDone={() => setParty(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.pink, fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  sub: { color: colors.muted, lineHeight: 19 },
  bar: { flexDirection: 'row', gap: space.sm, marginTop: space.sm },
  barBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  barText: { color: colors.text, fontWeight: '800' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.neon, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: '#022A30', fontWeight: '800', fontSize: 13 },
  clear: { justifyContent: 'center', paddingHorizontal: 8 },
  clearText: { color: colors.neon, fontWeight: '800', fontSize: 13, textDecorationLine: 'underline' },
  error: { color: colors.loss, fontWeight: '700' },
  empty: { color: colors.muted, textAlign: 'center', marginTop: 40 },
  fine: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: space.lg },
});
