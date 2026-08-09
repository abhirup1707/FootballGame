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
  const [loginReward, setLoginReward] = useState(null);

  useEffect(() => {
    const stored = loadSession();
    if (!stored?.token) { setChecking(false); return; }
    let active = true;
    api.me(stored.token)
      .then(({ user, loginReward }) => {
        if (!active) return;
        setSession((current) => (current ? { ...current, user } : current));
        if (loginReward?.available) setLoginReward(loginReward);
      })
      .catch(() => { if (active) { localStorage.removeItem(KEY); setSession(null); } })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);

  const store = useCallback((next) => {
    localStorage.setItem(KEY, JSON.stringify({ token: next.token, user: next.user }));
    setSession({ token: next.token, user: next.user });
  }, []);

  const login = useCallback(async (username, password) => {
    const data = await api.login(username, password);
    if (data.loginReward?.available) setLoginReward(data.loginReward);
    store(data);
  }, [store]);
  const register = useCallback(async (username, password) => {
    const data = await api.register(username, password);
    setWelcomeGift(data.gift || null);
    if (data.loginReward?.available) setLoginReward(data.loginReward);
    store(data);
  }, [store]);
  const dismissWelcomeGift = useCallback(() => setWelcomeGift(null), []);
  const dismissLoginReward = useCallback(() => setLoginReward(null), []);
  const claimLoginReward = useCallback(async () => {
    const stored = loadSession();
    if (!stored?.token) return null;
    const data = await api.claimLoginReward(stored.token);
    if (data.user) setSession((current) => (current ? { ...current, user: data.user } : current));
    setLoginReward((current) => (current && !data.loginReward?.available ? null : (data.loginReward || null)));
    return data;
  }, []);
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
    <AuthContext.Provider value={{ user: session?.user || null, token: session?.token || null, checking, login, register, logout, refreshUser, welcomeGift, dismissWelcomeGift, loginReward, dismissLoginReward, claimLoginReward }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
