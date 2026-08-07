import { createContext, useCallback, useContext, useEffect, useState } from "react";
import api from "./api";

const KEY = "footyverse-auth";
const AuthContext = createContext(null);

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(loadSession);
  const [checking, setChecking] = useState(Boolean(loadSession()));
  const [welcomeGift, setWelcomeGift] = useState(null);

  useEffect(() => {
    const stored = loadSession();
    if (!stored?.token) { setChecking(false); return; }
    let active = true;
    api.me(stored.token)
      .then(({ user }) => { if (active) setSession((current) => (current ? { ...current, user } : current)); })
      .catch(() => { if (active) { localStorage.removeItem(KEY); setSession(null); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const store = useCallback((next) => {
    localStorage.setItem(KEY, JSON.stringify({ token: next.token, user: next.user }));
    setSession({ token: next.token, user: next.user });
  }, []);

  const login = useCallback(async (username, password) => store(await api.login(username, password)), [store]);
  const register = useCallback(async (username, password) => {
    const data = await api.register(username, password);
    setWelcomeGift(data.gift || null);
    store(data);
  }, [store]);
  const dismissWelcomeGift = useCallback(() => setWelcomeGift(null), []);
  const refreshUser = useCallback(async () => {
    const stored = loadSession();
    if (!stored?.token) return;
    const { user } = await api.me(stored.token);
    setSession((current) => (current ? { ...current, user } : current));
  }, []);
  const logout = useCallback(() => {
    const stored = loadSession();
    if (stored?.token) api.logout(stored.token).catch(() => {});
    localStorage.removeItem(KEY);
    setSession(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user: session?.user || null, token: session?.token || null, checking, login, register, logout, refreshUser, welcomeGift, dismissWelcomeGift }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
