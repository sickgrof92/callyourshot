import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, type Me } from './api';

const TOKEN_KEY = 'cys.token';

interface Session {
  ready: boolean;
  token: string | null;
  me: Me | null;
  signUp(displayName: string): Promise<void>;
  refresh(): Promise<void>;
  signOut(): Promise<void>;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);

  const load = useCallback(async (t: string | null) => {
    if (!t) {
      setMe(null);
      return;
    }
    try {
      setMe(await api.me(t));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setMe(null);
      }
    }
  }, []);

  useEffect(() => {
    (async () => {
      const t = await SecureStore.getItemAsync(TOKEN_KEY);
      setToken(t);
      await load(t);
      setReady(true);
    })();
  }, [load]);

  const value: Session = {
    ready,
    token,
    me,
    async signUp(displayName) {
      const res = await api.signUp(displayName);
      await SecureStore.setItemAsync(TOKEN_KEY, res.token);
      setToken(res.token);
      await load(res.token);
    },
    refresh: () => load(token),
    async signOut() {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
      setToken(null);
      setMe(null);
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}
