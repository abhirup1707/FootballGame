import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";
import FcCard from "./FcCard";
import LoadingOverlay from "./LoadingOverlay";

export default function PackScreen({ onBack }) {
  const { token, user, refreshUser } = useAuth();
  const [packs, setPacks] = useState([]);
  const [daily, setDaily] = useState({ claimed: false, streak: 0 });
  const [opening, setOpening] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [inventoryCount, setInventoryCount] = useState(0);
  const [limits, setLimits] = useState({ limit: 50, warnAt: 35 });
  const [warnDismissed, setWarnDismissed] = useState(false);

  const load = async () => {
    try {
      const data = await api.packs(token);
      setPacks(data.packs);
      setDaily(data.daily);
      const owned = await api.inventory(token);
      setInventoryCount((owned.cards || []).length);
      setLimits({ limit: owned.limit || 50, warnAt: owned.warnAt || 35 });
    } catch (err) { setError(err.message); }
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = async (pack) => {
    if (opening) return;
    setError("");
    setOpening(pack.key);
    try {
      const data = await api.openPack(token, pack.key);
      setResult(data);
      setOpening(null);
      await refreshUser();
      load();
    } catch (err) {
      setError(err.message);
      setOpening(null);
    }
  };

  const canAfford = (pack) => {
    if (pack.cost.type === "free") return !daily.claimed;
    if (pack.cost.type === "coins") return user.coins >= pack.cost.amount;
    if (pack.cost.type === "gems") return user.gems >= pack.cost.amount;
    return true;
  };

  const showWarn = !warnDismissed && inventoryCount > limits.warnAt;

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap packs-screen">
    <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="team-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div><span className="eyebrow">TRANSFER MARKET</span><h1>Packs</h1></div>
      <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {error && <p className="auth-error pack-error">{error}</p>}
    <div className="packs-grid">
      {packs.map((pack, index) => {
        const disabled = pack.key === "daily" ? daily.claimed : !canAfford(pack);
        return <motion.button key={pack.key} initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }} transition={{ delay:.08 + index * .07 }} className={`pack-card ${pack.key === "daily" ? "pack-daily" : ""} ${disabled ? "pack-disabled" : ""}`} disabled={disabled || Boolean(opening)} onClick={() => open(pack)}>
          <div className="pack-art">{opening === pack.key ? <i className="pack-art-spin">⚽</i> : <i>{pack.image}</i>}<em>{pack.cardCount} CARDS</em></div>
          <b>{pack.name}</b>
          <span>{pack.description}</span>
          {pack.key === "daily" && !daily.claimed && <em className="pack-daily-streak">{daily.streak > 0 ? `🔥 ${daily.streak}-day streak` : "New player pack"}</em>}
          <strong>{pack.key === "daily" ? (daily.claimed ? "CLAIMED ✓" : opening === "daily" ? "⏳ Opening…" : "FREE") : pack.cost.type === "coins" ? `${pack.cost.amount} 🪙` : `${pack.cost.amount} 💎`}</strong>
        </motion.button>;
      })}
    </div>

    <AnimatePresence>
      {showWarn && <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        <motion.div className="warn-pop" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
          <span className="warn-icon">⚠️</span>
          <h2>Inventory almost full</h2>
          <p>Your club holds <b>{inventoryCount}/{limits.limit}</b> players. Once you reach {limits.limit}, you'll need to exchange players before opening more packs.</p>
          <button className="primary-btn" onClick={() => setWarnDismissed(true)}>Got it</button>
        </motion.div>
      </motion.div>}
    </AnimatePresence>

    <AnimatePresence>
      {result && <motion.div className="pack-overlay" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
        <div className="pack-reveal">
          <div className="pack-reveal-head"><small>YOU OPENED</small><h2>{result.pack.name}</h2>{result.bonus && <p className="pack-streak-bonus">🔥 {result.bonus.streak}-day streak! +{result.bonus.coins} coins</p>}</div>
          <div className="pack-reveal-grid">
            {result.cards.map((card, index) => <motion.div key={card.id} className="reveal-card" initial={{ opacity:0, scale:.5, rotateY:180 }} animate={{ opacity:1, scale:1, rotateY:0 }} transition={{ delay:.15 + index * .12 }}>
              <FcCard player={card} />
            </motion.div>)}
          </div>
          <button className="hero-btn primary-btn pack-collect" onClick={() => { setResult(null); }}>Collect <span>✓</span></button>
        </div>
      </motion.div>}
    </AnimatePresence>

    {opening && <LoadingOverlay message="Opening pack…" />}
  </div></main>;
}
