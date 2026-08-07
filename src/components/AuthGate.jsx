import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../auth";

export default function AuthGate() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      if (mode === "login") await login(username.trim(), password);
      else await register(username.trim(), password);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setBusy(false);
    }
  };

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="auth-wrap">
    <motion.section initial={{ opacity:0, y:22 }} animate={{ opacity:1, y:0 }} className="auth-card">
      <div className="brand-mark"><span>⚽</span><b>FOOTYVERSE</b></div>
      <span className="eyebrow">MANAGER ACCOUNT</span>
      <h1>{mode === "login" ? <>Welcome back,<br /><em>manager.</em></> : <>Build your<br /><em>own club.</em></>}</h1>
      <p>{mode === "login" ? "Sign in to manage your team, open packs, and step onto the pitch." : "Create an account and your club is saved forever — your team, your cards, your legacy."}</p>
      <form onSubmit={submit}>
        <label>Username</label>
        <input className="hero-input" value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" placeholder="your manager name" maxLength={20} />
        <label>Password</label>
        <input className="hero-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "your password" : "at least 6 characters"} minLength={6} />
        {error && <p className="auth-error">{error}</p>}
        <button className="hero-btn primary-btn" disabled={busy || !username.trim() || password.length < 6}>{busy ? "Working…" : mode === "login" ? "Sign in" : "Create account"} <span>→</span></button>
      </form>
      <button className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
    </motion.section>
  </div></main>;
}
