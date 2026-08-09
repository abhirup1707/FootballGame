import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";
import FcCard from "./FcCard";
import LoadingOverlay from "./LoadingOverlay";
import WalkoutReveal from "./WalkoutReveal";

const TIER_LABEL = { bronze: "Bronze (60-69)", silver: "Silver (70-79)", gold: "Gold (80+)" };

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
  const [infoPack, setInfoPack] = useState(null);
  const [pickSession, setPickSession] = useState(null);
  const [picking, setPicking] = useState(false);

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
      if (data.pick) {
        setPickSession({
          pickId: data.pick.pickId,
          total: data.pick.total,
          name: data.pack.name,
          minRating: pack.pick.minRating,
          maxRating: pack.pick.maxRating,
          rounds: data.pick.rounds,
          selections: [],
        });
      } else {
        setResult(data);
      }
      setOpening(null);
      await refreshUser();
      load();
    } catch (err) {
      setError(err.message);
      setOpening(null);
    }
  };

  const choosePick = async (card) => {
    if (picking) return;
    const selections = [...pickSession.selections, card];
    if (selections.length < pickSession.total) {
      setPickSession({ ...pickSession, selections });
      return;
    }
    setPicking(true);
    try {
      const data = await api.pickPack(token, pickSession.pickId, selections.map((s) => s.id));
      setResult(data);
      setPickSession(null);
      await refreshUser();
      load();
    } catch (err) {
      setError(err.message);
      setPickSession(null);
    }
    setPicking(false);
  };

  const canAfford = (pack) => {
    if (pack.cost.type === "free") return !daily.claimed;
    if (pack.cost.type === "coins") return user.coins >= pack.cost.amount;
    if (pack.cost.type === "gems") return user.gems >= pack.cost.amount;
    return true;
  };

  const showWarn = !warnDismissed && inventoryCount > limits.warnAt;

  const currentRound = pickSession ? pickSession.rounds[pickSession.selections.length] : null;

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap packs-screen">
    <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="team-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div><span className="eyebrow">TRANSFER MARKET</span><h1>Packs</h1></div>
      <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {error && <p className="auth-error pack-error">{error}</p>}
    <div className="packs-grid">
      {packs.map((pack, index) => {
        const limitUsed = pack.limit ? pack.limit.used >= pack.limit.max : false;
        const disabled = pack.key === "daily" ? daily.claimed : limitUsed || !canAfford(pack);
        return <div key={pack.key} className="pack-tile">
          <motion.button initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }} transition={{ delay:.08 + index * .07 }} className={`pack-card ${pack.key === "daily" ? "pack-daily" : ""} ${disabled ? "pack-disabled" : ""}`} disabled={disabled || Boolean(opening)} onClick={() => open(pack)}>
            <div className="pack-art">{opening === pack.key ? <i className="pack-art-spin">⚽</i> : <i>{pack.image}</i>}<em>{pack.pick ? `PICK ${pack.pick.rounds}` : pack.cardCount === 1 ? "1 PLAYER" : `${pack.cardCount} CARDS`}</em></div>
            <b>{pack.name}</b>
            <span>{pack.description}</span>
            {pack.key === "daily" && !daily.claimed && <em className="pack-daily-streak">{daily.streak > 0 ? `🔥 ${daily.streak}-day streak` : "New player pack"}</em>}
            {pack.limit && <em className={`pack-limit-streak ${limitUsed ? "pack-limit-done" : ""}`}>{limitUsed ? "LIMIT REACHED" : `${pack.limit.used}/${pack.limit.max} bought · resets in ${pack.limit.days}d`}</em>}
            <strong>{pack.key === "daily" ? (daily.claimed ? "CLAIMED ✓" : opening === "daily" ? "⏳ Opening…" : "FREE") : limitUsed ? "SOLD OUT" : pack.cost.type === "coins" ? `${pack.cost.amount} 🪙` : `${pack.cost.amount} 💎`}</strong>
          </motion.button>
          <span className="pack-info-btn" onClick={() => setInfoPack(pack)} aria-label="Pack info">ⓘ</span>
        </div>;
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
      {infoPack && <motion.div className="pack-overlay" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={() => setInfoPack(null)}>
        <motion.div className="pack-info-pop" initial={{ scale: .85, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} onClick={(e) => e.stopPropagation()}>
          <small>DROP RATES</small>
          <h2>{infoPack.image} {infoPack.name}</h2>
          <p>{infoPack.description}</p>
          {infoPack.pick ? (
            <>
              <div className="pack-info-odds">
                <div className="pack-info-line"><span>Guaranteed pick</span><strong>{infoPack.pick.minRating}-{infoPack.pick.maxRating} rated</strong></div>
                <div className="pack-info-line"><span>Total picks</span><strong>{infoPack.pick.rounds}</strong></div>
                <div className="pack-info-line"><span>Options per pick</span><strong>{infoPack.pick.optionsPerPick}</strong></div>
              </div>
              <p className="pack-info-note">Each pick shows {infoPack.pick.optionsPerPick} players to choose from. Pick 1, then the next pick opens automatically.</p>
            </>
          ) : (
            <>
              <div className="pack-info-odds">
                {infoPack.odds && Object.entries(infoPack.odds).map(([tier, pct]) => (
                  <div className="pack-info-line" key={tier}>
                    <span>{TIER_LABEL[tier] || (infoPack.limit ? `${tier} rated` : tier)}</span>
                    <strong>{pct}%</strong>
                  </div>
                ))}
              </div>
              {infoPack.limit && <p className="pack-info-note">Buy limit: {infoPack.limit.max} pack{infoPack.limit.max > 1 ? "s" : ""} every {infoPack.limit.days} days ({infoPack.limit.used}/{infoPack.limit.max} used).</p>}
              <p className="pack-info-note">Contains {infoPack.cardCount} card{infoPack.cardCount > 1 ? "s" : ""}, drawn independently.</p>
            </>
          )}
          <button className="hero-btn primary-btn pack-info-close" onClick={() => setInfoPack(null)}>Got it <span>✓</span></button>
        </motion.div>
      </motion.div>}
    </AnimatePresence>

    <AnimatePresence>
      {pickSession && !picking && currentRound && (
        <motion.div className="pack-overlay" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
          <div className="pack-pick">
            <div className="pack-reveal-head">
              <small>PICK {pickSession.selections.length + 1} OF {pickSession.total}</small>
              <h2>{pickSession.name}</h2>
              <p>Choose 1 player rated {pickSession.minRating}-{pickSession.maxRating}. Tap a card to select.</p>
            </div>
            {pickSession.selections.length > 0 && (
              <div className="pack-pick-chosen">
                {pickSession.selections.map((sel, index) => (
                  <span key={index}>Round {index + 1}: {sel.name}</span>
                ))}
              </div>
            )}
            <div className="pack-pick-options">
              {currentRound.options.map((card, index) => (
                <motion.div key={card.id} initial={{ opacity:0, y:22, scale:.92 }} animate={{ opacity:1, y:0, scale:1 }} transition={{ delay: index * .09 }}>
                  <FcCard player={card} clickable onClick={() => choosePick(card)} />
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>

    <AnimatePresence>
      {result && result.pack.reveal === "walkout" && result.cards?.[0] && (
        <WalkoutReveal card={result.cards[0]} packName={result.pack.name} onDone={() => setResult(null)} />
      )}
    </AnimatePresence>

    <AnimatePresence>
      {result && result.pack.reveal !== "walkout" && <motion.div className="pack-overlay" initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}>
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
    {picking && <LoadingOverlay message="Adding your pick…" />}
  </div></main>;
}
