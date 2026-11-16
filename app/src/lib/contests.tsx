// The contests a player is in, and which one they're playing right now.
// Points, picks and refills all live inside a contest, so the Games, Points and
// My Picks tabs all act on the "active" contest, which the player switches
// between with the bar at the top of those tabs.

import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, type Contest } from './api';
import { useSession } from './session';

const ACTIVE_KEY = 'cys.activeContest';

interface Contests {
  all: Contest[];
  /** Joined contests that are live now: the ones you can play. */
  playable: Contest[];
  active: Contest | null;
  loaded: boolean;
  refresh(): Promise<void>;
  setActive(id: string): void;
}

const Ctx = createContext<Contests | null>(null);

export function ContestsProvider({ children }: { children: ReactNode }) {
  const { token } = useSession();
  const [all, setAll] = useState<Contest[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(ACTIVE_KEY)
      .then((id) => id && setActiveId(id))
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    try {
      setAll((await api.contests(token)).competitions);
    } catch {
      // keep what we had
    } finally {
      setLoaded(true);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const value = useMemo<Contests>(() => {
    const playable = all.filter((c) => c.joined && c.status === 'live');
    const active = playable.find((c) => c.id === activeId) ?? playable[0] ?? null;
    return {
      all,
      playable,
      active,
      loaded,
      refresh,
      setActive(id) {
        setActiveId(id);
        SecureStore.setItemAsync(ACTIVE_KEY, id).catch(() => {});
      },
    };
  }, [all, activeId, loaded, refresh]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useContests(): Contests {
  const c = useContext(Ctx);
  if (!c) throw new Error('useContests outside ContestsProvider');
  return c;
}
