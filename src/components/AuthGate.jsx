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
  const [showAuth, setShowAuth] = useState(false);

  const openAuth = (nextMode = "login") => {
    setMode(nextMode);
    setError("");
    setShowAuth(true);
  };

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

  return (
    <main className="fv-landing-shell">
      <div className="fv-landing-grid" aria-hidden="true" />
      <div className="fv-light fv-light-one" aria-hidden="true" />
      <div className="fv-light fv-light-two" aria-hidden="true" />
      <div className="fv-stadium-lines" aria-hidden="true">
        <span className="fv-halfway" />
        <span className="fv-centre-circle" />
        <span className="fv-box fv-box-top" />
        <span className="fv-box fv-box-bottom" />
      </div>

      <nav className="fv-nav">
        <button className="fv-brand" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })} aria-label="Footyverse home">
          <span className="fv-brand-ball">⚽</span>
          <span>FOOTYVERSE</span>
        </button>
        <div className="fv-nav-links">
          <a href="#features">Features</a>
          <a href="#how-it-works">How it works</a>
          <a href="#faq">FAQ</a>
        </div>
        <div className="fv-nav-actions">
          <button className="fv-nav-ghost" onClick={() => openAuth("login")}>Sign in</button>
          <button className="fv-nav-primary" onClick={() => openAuth("register")}>Create club</button>
        </div>
      </nav>

      <section className="fv-hero" aria-labelledby="hero-title">
        <div className="fv-hero-copy">
          <div className="fv-eyebrow"><span /> ONLINE FOOTBALL CLUB</div>
          <h1 id="hero-title">Your club.<br /><em>Your era.</em></h1>
          <p className="fv-hero-lead">
            Build your squad, draft football legends, shape your starting XI and outsmart real opponents in a strategic football experience made for quick, competitive sessions.
          </p>
          <div className="fv-hero-actions">
            <button className="fv-hero-primary" onClick={() => openAuth("register")}>
              <span>START PLAYING</span><b>→</b>
            </button>
            <button className="fv-hero-secondary" onClick={() => openAuth("login")}>I ALREADY HAVE A CLUB</button>
          </div>
          <div className="fv-proof-row" aria-label="Game highlights">
            <span><b>11</b><small>PLAYER XI</small></span>
            <span><b>1v1</b><small>LIVE DUELS</small></span>
            <span><b>∞</b><small>SQUAD BUILDS</small></span>
          </div>
        </div>

        <div className="fv-hero-visual" aria-label="3D style football pitch preview">
          <div className="fv-scoreboard">
            <span>FOOTYVERSE ARENA</span>
            <b><i>HOME</i> 3 — 2 <i>AWAY</i></b>
            <small>LIVE MATCHDAY</small>
          </div>
          <div className="fv-pitch-card">
            <div className="fv-pitch-glow" />
            <div className="fv-pitch-mark halfway" />
            <div className="fv-pitch-mark centre" />
            <div className="fv-pitch-mark goal left" />
            <div className="fv-pitch-mark goal right" />
            {[
              [15, 29, "r"], [28, 61, "r"], [49, 34, "r"], [69, 21, "r"], [84, 49, "r"],
              [16, 72, "b"], [35, 46, "b"], [52, 68, "b"], [69, 44, "b"], [86, 69, "b"],
              [50, 52, "ball"],
            ].map(([left, top, kind], index) => (
              <span key={`${kind}-${index}`} className={`fv-player-token ${kind}`} style={{ left: `${left}%`, top: `${top}%` }} />
            ))}
            <div className="fv-pitch-caption">DRAFT · BUILD · OUTPLAY</div>
          </div>
        </div>
      </section>

      <section className="fv-section" id="features">
        <div className="fv-section-head">
          <div><span className="fv-section-kicker">THE CLUB EXPERIENCE</span><h2>More than a squad builder.</h2></div>
          <p>Everything on the public page is here to explain the game clearly before a visitor creates an account.</p>
        </div>
        <div className="fv-feature-grid">
          <article className="fv-feature-card"><span>01</span><div className="fv-feature-icon">🧠</div><h3>Build with intent</h3><p>Pick players that fit the role, formation and strategy you want to play.</p></article>
          <article className="fv-feature-card"><span>02</span><div className="fv-feature-icon">🃏</div><h3>Collect your XI</h3><p>Open packs, discover different card tiers and keep building a stronger club.</p></article>
          <article className="fv-feature-card"><span>03</span><div className="fv-feature-icon">⚔️</div><h3>Play the mind game</h3><p>Use passing, positioning and decision-making to beat rivals in live matches.</p></article>
          <article className="fv-feature-card"><span>04</span><div className="fv-feature-icon">🏆</div><h3>Chase club glory</h3><p>Take on challenges, climb leaderboards and turn your squad into a competitive team.</p></article>
        </div>
      </section>

      <section className="fv-section fv-how" id="how-it-works">
        <div className="fv-section-head">
          <div><span className="fv-section-kicker">HOW IT WORKS</span><h2>From manager to matchday.</h2></div>
        </div>
        <div className="fv-steps">
          <div className="fv-step"><b>01</b><span>CREATE</span><p>Make your manager account and enter your club headquarters.</p></div>
          <div className="fv-step"><b>02</b><span>DRAFT</span><p>Assemble a balanced squad and shape your preferred formation.</p></div>
          <div className="fv-step"><b>03</b><span>COMPETE</span><p>Enter a match, make tactical choices and try to control the game.</p></div>
          <div className="fv-step"><b>04</b><span>PROGRESS</span><p>Keep improving your club through packs, quests and competition.</p></div>
        </div>
      </section>

      <section className="fv-section fv-fair-play">
        <div className="fv-fair-card">
          <div><span className="fv-section-kicker">A CLEAR START</span><h2>Built for players, not just clicks.</h2><p>The public page explains what the game does, how it works and what visitors can expect before asking them to sign in.</p></div>
          <button className="fv-hero-primary" onClick={() => openAuth("register")}><span>CREATE YOUR CLUB</span><b>→</b></button>
        </div>
      </section>

      <section className="fv-section fv-faq" id="faq">
        <div className="fv-section-head"><div><span className="fv-section-kicker">FAQ</span><h2>Questions before kickoff?</h2></div></div>
        <div className="fv-faq-grid">
          <details><summary>What is Footyverse?</summary><p>Footyverse is an online football management and strategy game where you build a club, collect players and compete in match experiences.</p></details>
          <details><summary>Do I need an account to play?</summary><p>Yes. Your manager account is used to save your club, squad, progression and game activity.</p></details>
          <details><summary>Can I play against other people?</summary><p>The game includes multiplayer room-based match experiences for playing against friends and other managers.</p></details>
          <details><summary>What can I do after signing in?</summary><p>You can manage your squad, open packs, complete objectives, view leaderboards and enter available match modes.</p></details>
        </div>
      </section>

      <footer className="fv-footer">
        <div><b>FOOTYVERSE</b><span>Online football club strategy.</span></div>
        <div className="fv-footer-links"><a href="#features">Features</a><a href="#how-it-works">How it works</a><a href="#faq">FAQ</a></div>
        <div className="fv-footer-note">© {new Date().getFullYear()} Footyverse</div>
      </footer>

      {showAuth && (
        <div className="fv-auth-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setShowAuth(false); }}>
          <motion.section initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="fv-auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
            <button className="fv-auth-close" onClick={() => !busy && setShowAuth(false)} aria-label="Close">×</button>
            <div className="fv-auth-brand"><span>⚽</span><b>FOOTYVERSE</b></div>
            <span className="fv-eyebrow">MANAGER ACCOUNT</span>
            <h2 id="auth-title">{mode === "login" ? <>Welcome back,<br /><em>manager.</em></> : <>Build your<br /><em>own club.</em></>}</h2>
            <p>{mode === "login" ? "Sign in to manage your team, open packs and step onto the pitch." : "Create an account and start building your club."}</p>
            <form onSubmit={submit}>
              <label>Username</label>
              <input className="fv-auth-input" value={username} onChange={(event) => setUsername(event.target.value)} autoCapitalize="none" autoComplete="username" placeholder="your manager name" maxLength={20} />
              <label>Password</label>
              <input className="fv-auth-input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "login" ? "current-password" : "new-password"} placeholder={mode === "login" ? "your password" : "at least 6 characters"} minLength={6} />
              {error && <p className="fv-auth-error">{error}</p>}
              <button className="fv-hero-primary fv-auth-submit" disabled={busy || !username.trim() || password.length < 6}>
                <span>{busy ? "Working…" : mode === "login" ? "SIGN IN" : "CREATE ACCOUNT"}</span><b>→</b>
              </button>
            </form>
            <button className="fv-auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
              {mode === "login" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          </motion.section>
        </div>
      )}
    </main>
  );
}
