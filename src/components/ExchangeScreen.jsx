import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";
import FcCard from "./FcCard";
import { lastName } from "../lib/card";

const TOKEN_ICON = "/tokens/footyverse-token.svg";

export default function ExchangeScreen({ onBack }) {
  const { token, user, refreshUser } = useAuth();
  const [inventory, setInventory] = useState([]);
  const [inXI, setInXI] = useState(new Set());
  const [purple, setPurple] = useState(null);
  const [tokenConfig, setTokenConfig] = useState(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const [tab, setTab] = useState("basic");
  const [basicIds, setBasicIds] = useState([]);
  const [purpleIds, setPurpleIds] = useState([]);
  const [tokenIds, setTokenIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const setSelectedIds = tab === "basic" ? setBasicIds : tab === "purple" ? setPurpleIds : setTokenIds;

  const cardRating = (card) => card.base_rating ?? card.rating;
  const isPurple = (card) => card.version === "purple" || (cardRating(card) >= 77 && cardRating(card) <= 80);

  const load = async () => {
    const [owned, team, evData, tokCfg] = await Promise.all([
      api.inventory(token),
      api.team(token),
      api.events(token),
      api.tokenConfig(token),
    ]);
    setInventory(owned.cards || []);
    setInXI(new Set((team.squad || []).map((row) => row.id)));
    setPurple(evData.exchange || null);
    setTokenConfig(tokCfg || null);
  };

  useEffect(() => {
    let active = true;
    load().catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const tokenValue = (card) => {
    const r = cardRating(card);
    const band = (tokenConfig?.rates || []).find((b) => r >= b.min && r <= b.max);
    return band ? band.tokens : 0;
  };

  const toggle = (setter, max) => (card) => {
    setter((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (max && current.length >= max) return current;
      return [...current, card.id];
    });
  };

  const basicMet = basicIds.length === 10;
  const purpleTotal = purple?.requirements.reduce((sum, g) => sum + g.count, 0) || 0;
  const purpleMet = useMemo(() => Boolean(purple && purple.requirements.every((g) => purpleIds.filter((id) => {
    const card = inventory.find((c) => c.id === id);
    const r = cardRating(card);
    return r >= g.min && r <= g.max;
  }).length >= g.count)), [purple, purpleIds, inventory]);

  const tokenTotal = useMemo(() => tokenIds.reduce((sum, id) => sum + tokenValue(inventory.find((c) => c.id === id)), 0), [tokenIds, inventory, tokenConfig]);
  const balance = user?.tokens ?? 0;

  const doBasic = async () => {
    if (!basicMet || busy) return;
    setBusy(true); setError(""); setFlash("");
    try {
      const res = await api.exchange(token, basicIds);
      setResult({ kind: "basic", card: res.card });
      setBasicIds([]);
      await refreshUser(); await load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const doPurple = async () => {
    if (!purpleMet || busy) return;
    setBusy(true); setError(""); setFlash("");
    try {
      const res = await api.exchangePurple(token, purpleIds);
      setResult({ kind: "purple", card: res.card });
      setPurpleIds([]);
      await refreshUser(); await load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const doTokens = async () => {
    if (tokenIds.length === 0 || tokenTotal === 0 || busy) return;
    setBusy(true); setError(""); setFlash("");
    try {
      const res = await api.exchangeTokens(token, tokenIds);
      setFlash(`+${res.awarded} Footyverse tokens earned.`);
      setTokenIds([]);
      await refreshUser(); await load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const doRedeem = async () => {
    if (balance < (tokenConfig?.cost ?? 60) || busy) return;
    setBusy(true); setError(""); setFlash("");
    try {
      const res = await api.redeemTokens(token);
      setResult({ kind: "shop", card: res.card });
      await refreshUser(); await load();
    } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const eligibleFor = (card) => {
    if (inXI.has(card.id)) return false;
    const r = cardRating(card);
    if (tab === "basic") return r >= 60 && r <= 69;
    if (tab === "purple") return Boolean(purple?.requirements.some((g) => r >= g.min && r <= g.max));
    if (tab === "tokens") return tokenValue(card) > 0;
    return false;
  };

  const cardGrid = (selectedIds, max) => (
    <>
      <div className="exchange-tray">
        {selectedIds.length === 0 ? <small>Tap players below to add them.</small> : selectedIds.map((id) => {
          const card = inventory.find((c) => c.id === id);
          if (!card) return null;
          return <span key={id} className="exchange-chip" onClick={() => toggle(setSelectedIds, max)(card)}><em>{lastName(card.name)}</em> {cardRating(card)} ×</span>;
        })}
      </div>
      <div className="inventory-scroll">
        {inventory.length === 0 && <div className="inventory-empty"><i>⚽</i><p>No players in your club yet. Open packs to build your squad.</p></div>}
        {inventory.map((card) => {
          const eligible = eligibleFor(card);
          const selected = selectedIds.includes(card.id);
          return (
            <button key={card.id} className={`owned-card exchg ${isPurple(card) ? "owned-card-purple" : ""} ${selected ? "exchg-selected" : ""} ${!eligible ? "exchg-disabled" : ""}`} disabled={!eligible} onClick={() => toggle(setSelectedIds, max)(card)}>
              <div className={`owned-card-art ${isPurple(card) ? "owned-card-art-purple" : ""}`}>{card.image ? <img src={card.image} alt="" /> : <span>{card.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").slice(0, 3) || card.name.slice(0, 3)}</span>}</div>
              <div className="owned-card-info"><small>{card.category}</small><b>{lastName(card.name)}</b></div>
              <strong>{cardRating(card)}</strong>
              {tab === "tokens" && tokenValue(card) > 0 && <em className="xi-badge tok-badge"><img src={TOKEN_ICON} alt="" />+{tokenValue(card)}</em>}
              {card.version === "purple" && <em className="xi-badge">P</em>}
            </button>
          );
        })}
      </div>
    </>
  );

  const basicTab = (
    <div className="exchange-block">
      <div className="exchange-block-head">
        <h3>GUARANTEED 72+ <small>10 × 60-69 rated</small></h3>
        <p>Trade in ten players rated 60-69 for one guaranteed 72+ club card.</p>
      </div>
      {cardGrid(basicIds, 10)}
      <div className="exchange-footer">
        <span>{basicIds.length}/10 selected</span>
        <div className="exchange-footer-actions">
          <button className="primary-btn" disabled={!basicMet || busy} onClick={doBasic}>{busy ? "Exchanging…" : "Exchange for 72+ card"}</button>
        </div>
      </div>
    </div>
  );

  const purpleTab = (
    <div className="exchange-block">
      <div className="exchange-block-head">
        <h3>PURPLE 77-80 <small>mix of 60-75 rated</small></h3>
        <p>Fill every requirement with a mix of your players for a guaranteed purple signing.</p>
      </div>
      <div className="purple-reqs">
        {(purple?.requirements || []).map((g) => {
          const filled = purpleIds.filter((id) => {
            const card = inventory.find((c) => c.id === id);
            const r = cardRating(card);
            return r >= g.min && r <= g.max;
          }).length;
          return <div key={g.label} className={`purple-req ${filled >= g.count ? "purple-req-done" : ""}`}><em>{g.count} ×</em><span>{g.label}</span><b>{filled}/{g.count}</b></div>;
        })}
      </div>
      {cardGrid(purpleIds, purpleTotal)}
      <div className="exchange-footer">
        <span>{purpleIds.length}/{purpleTotal} selected</span>
        <div className="exchange-footer-actions">
          <button className="primary-btn" disabled={!purpleMet || busy} onClick={doPurple}>{busy ? "Exchanging…" : "Exchange for purple card"}</button>
        </div>
      </div>
    </div>
  );

  const tokensTab = (
    <div className="exchange-block">
      <div className="exchange-block-head">
        <h3>FOOTYVERSE TOKENS <small>trade players for tokens</small></h3>
        <p>Exchange your players for Footyverse tokens, then spend them in the token shop below.</p>
        <div className="token-rates">
          {(tokenConfig?.rates || []).map((b) => (
            <span key={`${b.min}-${b.max}`} className="token-rate"><img src={TOKEN_ICON} alt="" /> rated {b.min}-{b.max} → <b>+{b.tokens}</b></span>
          ))}
        </div>
      </div>
      {cardGrid(tokenIds, Infinity)}
      <div className="exchange-footer">
        <span className="token-total"><img src={TOKEN_ICON} alt="" /> +{tokenTotal} tokens</span>
        <div className="exchange-footer-actions">
          <button className="primary-btn" disabled={tokenIds.length === 0 || tokenTotal === 0 || busy} onClick={doTokens}>{busy ? "Exchanging…" : `Earn ${tokenTotal} tokens`}</button>
        </div>
      </div>
    </div>
  );

  const shopTab = (
    <div className="exchange-block">
      <div className="exchange-block-head">
        <h3>TOKEN SHOP <small>83-85 rated card</small></h3>
        <p>Spend your Footyverse tokens on one guaranteed 83-85 rated card.</p>
      </div>
      <div className="token-shop">
        <div className="token-shop-icon"><img src={TOKEN_ICON} alt="" /></div>
        <div className="token-shop-info">
          <span className="event-tag">FOOTYVERSE · 83-85</span>
          <h4>Guaranteed 83-85 card</h4>
          <p>Random top-tier card from the current rotation — including event players.</p>
          <div className="token-shop-cost"><img src={TOKEN_ICON} alt="" /><b>{tokenConfig?.cost ?? 60}</b><span>tokens · you have <b>{balance}</b></span></div>
          <button className="primary-btn" disabled={balance < (tokenConfig?.cost ?? 60) || busy} onClick={doRedeem}>{busy ? "Opening…" : balance < (tokenConfig?.cost ?? 60) ? `Need ${(tokenConfig?.cost ?? 60) - balance} more tokens` : "Redeem card"}</button>
        </div>
      </div>
    </div>
  );

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap events-screen">
    <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head events-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div className="event-title-wrap">
        <span className="eyebrow">EXCHANGE</span>
        <h1 className="event-title-main">TRADE CENTRE</h1>
      </div>
      <div className="hub-currency"><span><img className="token-coin" src={TOKEN_ICON} alt="" /> {balance}</span><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {flash && <p className="quest-flash">{flash}</p>}
    {error && <p className="auth-error pack-error">{error}</p>}

    <div className="exchange-tabs">
      <button className={tab === "basic" ? "active" : ""} onClick={() => setTab("basic")}>72+ trade</button>
      <button className={tab === "purple" ? "active" : ""} onClick={() => setTab("purple")}>Purple</button>
      <button className={tab === "tokens" ? "active" : ""} onClick={() => setTab("tokens")}>Tokens</button>
      <button className={tab === "shop" ? "active" : ""} onClick={() => setTab("shop")}>Token shop</button>
    </div>

    <AnimatePresence mode="wait">
      <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: .18 }}>
        {tab === "basic" ? basicTab : tab === "purple" ? purpleTab : tab === "tokens" ? tokensTab : shopTab}
      </motion.div>
    </AnimatePresence>

    <AnimatePresence>
      {result && (
        <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="exchange-result" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <small>{result.kind === "shop" ? "TOKEN SHOP REDEMPTION" : result.kind === "purple" ? "EXCHANGE COMPLETE" : "EXCHANGE COMPLETE"}</small>
            <h2>{result.kind === "shop" ? "83-85 signing" : result.kind === "purple" ? "Purple 77-80 signing" : "72+ signing"}</h2>
            <div className="exchange-result-card"><FcCard player={{ ...result.card, version: result.kind === "purple" ? "purple" : result.card.version }} /></div>
            <p className="exchange-result-note">Added to your club. Tap a squad slot to play them.</p>
            <button className="hero-btn primary-btn" onClick={() => setResult(null)}>Nice! <span>✓</span></button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
  </main>;
}
