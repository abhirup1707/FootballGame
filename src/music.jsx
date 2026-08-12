import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import bgmUrl from "./assets/music/background.mp3";

const MusicContext = createContext(null);
const STORE_KEY = "footyverse-music";

// One shared player for the whole app. Created at module scope so React
// StrictMode's dev double-mount can never spin up a second audio element.
const audio = typeof Audio !== "undefined" ? new Audio(bgmUrl) : null;
if (audio) {
  audio.loop = true;
  audio.preload = "auto";
}

function loadPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (parsed && typeof parsed.on === "boolean") return parsed;
  } catch {}
  return { on: false, volume: 0.6 };
}

export function MusicProvider({ children }) {
  const [on, setOn] = useState(() => loadPrefs().on);
  const [volume, setVolume] = useState(() => loadPrefs().volume);
  const [match, setMatch] = useState(false);

  const onRef = useRef(on);
  onRef.current = on;
  const matchRef = useRef(match);
  matchRef.current = match;

  const sync = useCallback(() => {
    if (!audio) return;
    const shouldPlay = onRef.current && !matchRef.current;
    if (shouldPlay) {
      audio.play().catch(() => {
        // Autoplay is blocked until the page has had a user interaction.
        // Retry on the first gesture if the player had music on before.
        const retry = () => audio.play().catch(() => {});
        window.addEventListener("pointerdown", retry, { once: true });
        window.addEventListener("keydown", retry, { once: true });
      });
    } else {
      audio.pause();
    }
  }, []);

  // Keep the volume in sync with the slider.
  useEffect(() => {
    if (audio) audio.volume = volume;
  }, [volume]);

  // Start/stop whenever the on/match state changes, including page reloads.
  useEffect(() => {
    sync();
  }, [on, match, sync]);

  // Pause while the tab is hidden, resume when it comes back.
  useEffect(() => {
    if (!audio) return;
    const onVisibility = () => {
      if (document.hidden) {
        if (!audio.paused) audio.pause();
      } else if (onRef.current && !matchRef.current && audio.paused) {
        audio.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Remember the player's choice so it survives refreshes.
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ on, volume }));
    } catch {}
  }, [on, volume]);

  const toggle = useCallback(() => {
    const next = !onRef.current;
    setOn(next);
    if (!audio) return;
    if (next && !matchRef.current) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const value = { on, volume, setVolume, match, setMatch, toggle };
  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

export function useMusic() {
  const ctx = useContext(MusicContext);
  if (!ctx) throw new Error("useMusic must be used inside <MusicProvider>.");
  return ctx;
}
