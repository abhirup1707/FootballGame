import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";
import SquadBoard from "./SquadBoard";
import FcCard from "./FcCard";
import { slotCategory, effectiveRating } from "../lib/position";
import { countryFlagPath } from "../lib/countries";
import LoadingOverlay from "./LoadingOverlay";

const emptyPositions = () => ({ GK:null, LB:null, CB1:null, CB2:null, RB:null, CM1:null, CM2:null, CAM:null, LW:null, ST:null, RW:null });
const slotLabels = { GK:"Goalkeeper", LB:"Left back", CB1:"Centre back", CB2:"Centre back", RB:"Right back", CM1:"Centre midfield", CM2:"Centre midfield", CAM:"Attacking midfield", LW:"Left wing", ST:"Striker", RW:"Right wing" };
const FILTERS = ["ALL", "ATT", "MID", "DEF", "GK"];

export default function TeamScreen({ onBack }) {
  const { token } = useAuth();
  const [positions, setPositions] = useState(emptyPositions());
  const [inventory, setInventory] = useState([]);
  const [limits, setLimits] = useState({ limit: 50, warnAt: 35 });
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [pickedCard, setPickedCard] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState("players");
  const [exchangeIds, setExchangeIds] = useState([]);
  const [exchanging, setExchanging] = useState(false);
  const [exchangeResult, setExchangeResult] = useState(null);
  const [warnDismissed, setWarnDismissed] = useState(false);

  const loadInventory = async () => {
    const owned = await api.inventory(token);
    setInventory(owned.cards || []);
    setLimits({ limit: owned.limit || 50, warnAt: owned.warnAt || 35 });
  };

  useEffect(() => {
    let active = true;
    Promise.all([api.team(token), api.inventory(token)])
      .then(([team, owned]) => {
        if (!active) return;
        setInventory(owned.cards || []);
        setLimits({ limit: owned.limit || 50, warnAt: owned.warnAt || 35 });
        const next = emptyPositions();
        (team.squad || []).forEach((row) => {
          if (row.slot && next[row.slot] !== undefined) next[row.slot] = row;
        });
        setPositions(next);
      })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [token]);

  const filledSlots = Object.entries(positions).filter(([, player]) => player);
  const filledCount = filledSlots.length;
  const overall = filledCount ? Number((filledSlots.reduce((sum, [slot, player]) => sum + effectiveRating(player.rating, player.category, slotCategory[slot]), 0) / filledCount).toFixed(1)) : 0;

  const inXIIs = useMemo(() => new Set(Object.values(positions).filter(Boolean).map((player) => player.id)), [positions]);

  const visibleCards = useMemo(() => {
    const list = inventory.filter((card) => filter === "ALL" || card.category === filter);
    return [...list].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
  }, [inventory, filter]);

  const openPicker = (slot) => { setNotice(""); setPickedCard(null); setSelectedSlot(slot); };

  const pickCard = (card) => {
    setNotice("");
    setSelectedSlot(null);
    setPickedCard((current) => (current?.id === card.id ? null : card));
  };

  const placeCard = (slot) => {
    if (!pickedCard) return;
    const alreadyHere = positions[slot]?.id === pickedCard.id;
    const elsewhere = Object.keys(positions).some(
      (key) => key !== slot && positions[key]?.id === pickedCard.id,
    );
    if (alreadyHere && !elsewhere) {
      setPickedCard(null);
      return;
    }
    setPositions((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => { if (next[key]?.id === pickedCard.id) next[key] = null; });
      next[slot] = pickedCard;
      return next;
    });
    setPickedCard(null);
    setDirty(true);
  };

  const assign = (card) => {
    setPositions((current) => {
      const next = { ...current };
      Object.keys(next).forEach((slot) => { if (next[slot]?.id === card.id) next[slot] = null; });
      next[selectedSlot] = card;
      return next;
    });
    setSelectedSlot(null);
    setDirty(true);
  };

  const clearSlot = () => {
    setPositions((current) => ({ ...current, [selectedSlot]: null }));
    setSelectedSlot(null);
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const slots = {};
      Object.entries(positions).forEach(([slot, card]) => { if (card) slots[slot] = card.id; });
      const res = await api.saveTeam(token, slots);
      const next = emptyPositions();
      (res.squad || []).forEach((row) => {
        if (row.slot && next[row.slot] !== undefined) next[row.slot] = row;
      });
      setPositions(next);
      const owned = await api.inventory(token);
      setInventory(owned.cards || []);
      setDirty(false);
      setNotice(res.count === 11 ? `Starting XI saved — ready for own-team matches.` : `Saved ${res.count}/11 players — add the rest to play a match.`);
    } catch (err) {
      setError(err.message);
    }
    setSaving(false);
  };

  const autobuild = () => {
    if (inventory.length === 0) return;
    const used = new Set();
    const next = emptyPositions();
    const plan = [
      ["GK", ["GK"]],
      ["DEF", ["CB1", "CB2", "LB", "RB"]],
      ["MID", ["CAM", "CM1", "CM2"]],
      ["ATT", ["ST", "LW", "RW"]],
    ];
    for (const [cat, slots] of plan) {
      const pool = inventory
        .filter((c) => c.category === cat && !used.has(c.id))
        .sort((a, b) => cardRating(b) - cardRating(a) || a.name.localeCompare(b.name));
      slots.forEach((slot, i) => {
        const card = pool[i];
        if (card) { next[slot] = card; used.add(card.id); }
      });
    }
    setSelectedSlot(null);
    setPositions(next);
    setDirty(true);
    setNotice("Auto-built your best XI from your highest-rated players.");
  };

  const shortName = (name) => {
    const parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length <= 1) return name;
    return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  };

  const cardRating = (card) => card.base_rating ?? card.rating;
  const isExchangable = (card) => cardRating(card) >= 60 && cardRating(card) <= 69;

  const toggleExchange = (card) => {
    setExchangeIds((current) => {
      if (current.includes(card.id)) return current.filter((id) => id !== card.id);
      if (current.length >= 10) return current;
      return [...current, card.id];
    });
  };

  const doExchange = async () => {
    if (exchangeIds.length !== 10 || exchanging) return;
    setExchanging(true);
    setError("");
    try {
      const res = await api.exchange(token, exchangeIds);
      setExchangeResult(res.card);
      setExchangeIds([]);
      await loadInventory();
    } catch (err) {
      setError(err.message);
    }
    setExchanging(false);
  };

  const showWarn = !warnDismissed && inventory.length > limits.warnAt;

  const tabs = <div className="category-tabs">{FILTERS.map((key) => <button key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{key}</button>)}</div>;

  const cardBody = (card, badge) => (
    <>
      <div className="owned-card-art">{card.image ? <img src={card.image} alt="" /> : <span>{shortName(card.name)}</span>}</div>
      <div className="owned-card-info"><small>{countryFlagPath(card.nation) ? <img className="owned-card-nation" src={countryFlagPath(card.nation)} alt={card.nation} /> : null}{card.category}</small><b>{shortName(card.name)}</b></div>
      <strong>{cardRating(card)}</strong>
      {badge}
    </>
  );

  const exchangePanel = (
    <>
      <h3>PLAYER EXCHANGE <small>10 × 60-69 rated</small></h3>
      {error && <p className="auth-error">{error}</p>}
      <p className="inventory-hint">Select ten players rated 60–69 and trade them for one guaranteed 72+ card.</p>
      <div className="exchange-tray">
        {exchangeIds.length === 0 ? <small>No players added yet — tap players below to add them.</small> : exchangeIds.map((id) => {
          const card = inventory.find((c) => c.id === id);
          if (!card) return null;
          return <span key={id} className="exchange-chip" onClick={() => toggleExchange(card)}><em>{card.name}</em> {cardRating(card)} ×</span>;
        })}
      </div>
      {tabs}
      {visibleCards.length === 0 && <div className="inventory-empty"><i>⚽</i><p>No players in your club yet. Open packs to build your squad.</p></div>}
      <div className="inventory-scroll">
        {visibleCards.map((card) => {
          const inXI = inXIIs.has(card.id);
          const eligible = isExchangable(card) && !inXI;
          const selected = exchangeIds.includes(card.id);
          return (
            <button key={card.id} className={`owned-card exchg ${selected ? "exchg-selected" : ""} ${!eligible ? "exchg-disabled" : ""}`} disabled={!eligible} onClick={() => toggleExchange(card)}>
              {cardBody(card, inXI ? <em className="xi-badge exchg-xi">XI</em> : null)}
            </button>
          );
        })}
      </div>
      <div className="exchange-footer">
        <span>{exchangeIds.length}/10 selected</span>
        <button className="primary-btn" disabled={exchangeIds.length !== 10 || exchanging} onClick={doExchange}>{exchanging ? "Exchanging…" : "Exchange for 72+ card"}</button>
      </div>
    </>
  );

  const playersPanel = (
    <>
      <h3>YOUR PLAYERS <small>{inventory.length}/{limits.limit}</small></h3>
      {notice && <p className="team-notice">{notice}</p>}
      {error && <p className="auth-error">{error}</p>}
      {pickedCard && <p className="inventory-hint swap-active">Swapping <b>{pickedCard.name}</b> — now tap a slot on the XI board to place them.</p>}
      {tabs}
      {!error && visibleCards.length === 0 && <div className="inventory-empty"><i>⚽</i><p>No {filter === "ALL" ? "" : `${filter} `}players yet. Open packs to build your squad.</p></div>}
      <div className="inventory-scroll">
        {visibleCards.map((card) => {
          const slot = Object.keys(positions).find((key) => positions[key]?.id === card.id);
          const inXI = Boolean(slot);
          return (
            <button key={card.id} className={`owned-card pickable ${inXI ? "in-xi" : ""} ${pickedCard?.id === card.id ? "selected" : ""}`} onClick={() => pickCard(card)}>
              {cardBody(card, inXI ? <em className="xi-badge">{slot}</em> : null)}
            </button>
          );
        })}
      </div>
    </>
  );

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap team-screen">
    <motion.section initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay:.08 }} className="team-layout">
      <div className="team-side">
        <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="team-head">
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <div><span className="eyebrow">MY CLUB</span><h1>Starting XI</h1></div>
          <span className="team-ovr-badge">OVR {overall || "—"}</span>
        </motion.header>
        <div className="squad-board">
          <button className="autobuild-btn" onClick={autobuild} disabled={inventory.length === 0} aria-label="Auto-build squad" title="Auto-build squad from highest-rated players">
            <span className="autobuild-arrows">&gt;&gt;</span><span className="autobuild-label">Auto-build</span>
          </button>
          <SquadBoard positions={positions} overall={overall} onPickForSlot={openPicker} pickedPlayer={pickedCard} onPlaceCard={placeCard} />
        </div>
      </div>

      <div className="inventory-panel">
        {selectedSlot ? (
          <>
            <h3>PICK {slotLabels[selectedSlot]} <small>{visibleCards.length} available</small></h3>
            <p className="inventory-hint">Any player can play any position — out-of-position players drop OVR when placed.</p>
            {tabs}
            {visibleCards.length === 0 && <div className="inventory-empty"><i>⚽</i><p>No {filter === "ALL" ? "" : `${filter} `}players in your club yet. Open packs to build your squad.</p></div>}
            <div className="inventory-scroll">
              {visibleCards.map((card) => (
                <button key={card.id} className={`owned-card ${positions[selectedSlot]?.id === card.id ? "selected" : ""}`} onClick={() => assign(card)}>
                  {cardBody(card)}
                </button>
              ))}
            </div>
            <div className="picker-actions">
              {positions[selectedSlot] && <button className="secondary-btn" onClick={clearSlot}>Remove player</button>}
              <button className="secondary-btn" onClick={() => setSelectedSlot(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <>
            <div className="inventory-views">
              <button className={view === "players" ? "active" : ""} onClick={() => setView("players")}>Players</button>
              <button className={view === "exchange" ? "active" : ""} onClick={() => setView("exchange")}>Exchange</button>
            </div>
            {view === "exchange" ? exchangePanel : playersPanel}
          </>
        )}
        <div className="squad-savebar">
          <span>{filledCount}/11 filled</span>
          <button className="primary-btn" onClick={save} disabled={saving}>{saving ? <><i className="mini-spinner" />Saving…</> : "Save squad"}</button>
        </div>
      </div>
    </motion.section>

    <AnimatePresence>
      {showWarn && (
        <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="warn-pop" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <span className="warn-icon">⚠️</span>
            <h2>Inventory almost full</h2>
            <p>Your club holds <b>{inventory.length}/{limits.limit}</b> players. Once you reach {limits.limit}, you'll need to exchange players before opening more packs.</p>
            <button className="primary-btn" onClick={() => setWarnDismissed(true)}>Got it</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    <AnimatePresence>
      {exchangeResult && (
        <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="exchange-result" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <small>EXCHANGE COMPLETE</small>
            <h2>Guaranteed 72+ signing</h2>
            <div className="exchange-result-card"><FcCard player={exchangeResult} /></div>
            <p className="exchange-result-note">Added to your club. Tap a squad slot to play them.</p>
            <button className="hero-btn primary-btn" onClick={() => setExchangeResult(null)}>Nice! <span>✓</span></button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>

  {saving && <LoadingOverlay message="Saving your squad…" />}
</main>;
}
