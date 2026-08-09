import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";
import FcCard from "./FcCard";
import LoadingOverlay from "./LoadingOverlay";

const DIFF_ORDER = { easy: 0, medium: 1, hard: 2, epic: 3 };
const DIFF_LABEL = { easy: "Easy", medium: "Medium", hard: "Hard", epic: "Epic" };

export default function EventsScreen({ onBack }) {
  const { token, user, refreshUser } = useAuth();
  const [events, setEvents] = useState([]);
  const [quests, setQuests] = useState([]);
  const [exchange, setExchange] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [inXI, setInXI] = useState(new Set());
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [view, setView] = useState("preview");
  const [showAllPurple, setShowAllPurple] = useState(false);
  const [selected, setSelected] = useState([]);
  const [exchanging, setExchanging] = useState(false);
  const [result, setResult] = useState(null);

  const previews = exchange?.previews || [];
  const [slide, setSlide] = useState(0);
  const [stepPx, setStepPx] = useState(0);
  const [paused, setPaused] = useState(false);
  const trackRef = useRef(null);
  const slideCount = previews.length;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const card = el.querySelector(".exchange-mcard");
    if (card) setStepPx(card.offsetWidth + 14);
  }, [slideCount]);

  useEffect(() => {
    if (!slideCount || !stepPx || paused) return;
    const timer = setInterval(() => {
      setSlide((s) => (s + 1) % (slideCount + 1));
    }, 3500);
    return () => clearInterval(timer);
  }, [slideCount, stepPx, paused]);

  useEffect(() => {
    setSlide(0);
  }, [slideCount]);

  const load = async () => {
    const [evData, owned, team] = await Promise.all([
      api.events(token),
      api.inventory(token),
      api.team(token),
    ]);
    setEvents(evData.events || []);
    setQuests(evData.quests || []);
    setExchange(evData.exchange || null);
    setInventory(owned.cards || []);
    setInXI(new Set((team.squad || []).map((row) => row.id)));
  };

  useEffect(() => {
    let active = true;
    load()
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const claim = async (questId) => {
    try {
      const data = await api.claimEventQuest(token, questId);
      setFlash(`Reward collected: ${data.reward.coins ? `+${data.reward.coins} 🪙 ` : ""}${data.reward.gems ? `+${data.reward.gems} 💎 ` : ""}`);
      await refreshUser();
      load();
    } catch (err) { setError(err.message); }
  };

  const cardRating = (card) => card.base_rating ?? card.rating;

  const toggle = (card) => {
    const rating = cardRating(card);
    setSelected((current) => {
      if (current.some((c) => c.id === card.id)) return current.filter((c) => c.id !== card.id);
      const group = exchange.requirements.find((g) => rating >= g.min && rating <= g.max);
      if (!group) return current;
      const groupIndex = exchange.requirements.indexOf(group);
      const filled = current.filter((c) => {
        const r = c.rating;
        const g = exchange.requirements[groupIndex];
        return r >= g.min && r <= g.max;
      }).length;
      if (filled >= group.count) return current;
      return [...current, { id: card.id, rating }];
    });
  };

  const totalNeeded = exchange?.requirements.reduce((sum, g) => sum + g.count, 0) || 0;
  const allMet = useMemo(() => Boolean(exchange && exchange.requirements.every((g) => selected.filter((c) => c.rating >= g.min && c.rating <= g.max).length >= g.count)), [exchange, selected]);

  const autoAdd = () => {
    if (!exchange) return;
    setSelected((current) => {
      const next = [...current];
      const taken = new Set(next.map((c) => c.id));
      for (const group of exchange.requirements) {
        const filled = next.filter((c) => c.rating >= group.min && c.rating <= group.max).length;
        const need = group.count - filled;
        if (need <= 0) continue;
        const candidates = inventory
          .filter((card) => {
            const r = cardRating(card);
            return r >= group.min && r <= group.max && !inXI.has(card.id) && !taken.has(card.id);
          })
          .sort((a, b) => cardRating(a) - cardRating(b) || a.name.localeCompare(b.name));
        candidates.slice(0, need).forEach((card) => {
          next.push({ id: card.id, rating: cardRating(card) });
          taken.add(card.id);
        });
      }
      return next;
    });
  };

  const doExchange = async () => {
    if (!allMet || exchanging) return;
    setExchanging(true);
    setError("");
    try {
      const res = await api.exchangePurple(token, selected.map((c) => c.id));
      setResult(res.card);
      setSelected([]);
      await refreshUser();
      await load();
    } catch (err) {
      setError(err.message);
    }
    setExchanging(false);
  };

  const marqueeCards = previews.length ? [...previews, ...previews] : [];

  const exchangePreview = (
    <div className="purple-preview">
      <div className="purple-preview-head">
        <span className="event-tag">PURPLE · {exchange?.reward.min}-{exchange?.reward.max}</span>
        <div className="purple-preview-title">
          <h3>Guaranteed purple card</h3>
          <button className="view-all-btn" onClick={() => setShowAllPurple(true)}>View all <span>▾</span></button>
        </div>
        <p>All the event cards on rotation below. Trade in a mix of your players for a guaranteed purple signing. Fill every requirement to unlock the exchange.</p>
      </div>
      <div
        className="exchange-marquee"
        onClick={() => setView("panel")}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        {marqueeCards.length === 0 ? (
          <p className="inventory-empty">No purple rewards available right now.</p>
        ) : (
          <div
            ref={trackRef}
            className="exchange-track"
            style={{
              transform: `translateX(${-slide * stepPx}px)`,
              transition: slide === 0 ? "none" : "transform 0.7s ease",
            }}
          >
            {marqueeCards.map((card, i) => (
              <div key={`${card.id}-${i}`} className="exchange-mcard">
                <FcCard player={{ ...card, version: "purple" }} size="sm" />
              </div>
            ))}
          </div>
        )}
      </div>
      <ul className="purple-req-list">
        {exchange?.requirements.map((g) => <li key={g.label}><span>{g.count} ×</span>{g.label}</li>)}
      </ul>
      <button className="primary-btn" disabled={!previews.length} onClick={() => setView("panel")}>Open exchange</button>
    </div>
  );

  const exchangePanel = (
    <div className="purple-panel">
      <div className="purple-panel-head">
        <button className="icon-btn" onClick={() => setView("preview")} aria-label="Back">←</button>
        <div><span className="event-tag">PURPLE · {exchange?.reward.min}-{exchange?.reward.max}</span><h3>Select your players</h3></div>
        <span className="purple-total">{selected.length}/{totalNeeded}</span>
      </div>
      <div className="purple-reqs">
        {exchange?.requirements.map((g) => {
          const filled = selected.filter((c) => c.rating >= g.min && c.rating <= g.max).length;
          return <div key={g.label} className={`purple-req ${filled >= g.count ? "purple-req-done" : ""}`}><em>{g.count} ×</em><span>{g.label}</span><b>{filled}/{g.count}</b></div>;
        })}
      </div>
      <div className="exchange-tray">
        {selected.length === 0 ? <small>Tap players below to add them. Complete every requirement to unlock the exchange.</small> : selected.map((s) => {
          const card = inventory.find((c) => c.id === s.id);
          if (!card) return null;
          return <span key={s.id} className="exchange-chip" onClick={() => toggle(card)}><em>{card.name}</em> {cardRating(card)} ×</span>;
        })}
      </div>
      <div className="inventory-scroll">
        {inventory.length === 0 && <div className="inventory-empty"><i>⚽</i><p>No players in your club yet. Open packs to build your squad.</p></div>}
        {inventory.map((card) => {
          const rating = cardRating(card);
          const eligible = !inXI.has(card.id) && Boolean(exchange?.requirements.some((g) => rating >= g.min && rating <= g.max));
          const isSelected = selected.some((c) => c.id === card.id);
          return (
            <button key={card.id} className={`owned-card exchg ${card.version === "purple" ? "owned-card-purple" : ""} ${isSelected ? "exchg-selected" : ""} ${!eligible ? "exchg-disabled" : ""}`} disabled={!eligible} onClick={() => toggle(card)}>
              <div className={`owned-card-art ${card.version === "purple" ? "owned-card-art-purple" : ""}`}>{card.image ? <img src={card.image} alt="" /> : <span>{card.name.split(/\s+/).slice(0, 2).map((p) => p[0]).join("").slice(0, 3) || card.name.slice(0, 3)}</span>}</div>
              <div className="owned-card-info"><small>{card.category}</small><b>{card.name}</b></div>
              <strong>{rating}</strong>
              {card.version === "purple" && <em className="xi-badge">P</em>}
            </button>
          );
        })}
      </div>
      <div className="exchange-footer">
        <span>{allMet ? "Requirements met!" : `${selected.length}/${totalNeeded} selected`}</span>
        <div className="exchange-footer-actions">
          <button className="auto-add-btn" onClick={autoAdd} disabled={allMet || exchanging}>Auto add lowest rated</button>
          <button className="primary-btn" disabled={!allMet || exchanging} onClick={doExchange}>{exchanging ? "Exchanging…" : `Exchange for purple ${exchange?.reward.min}-${exchange?.reward.max}`}</button>
        </div>
      </div>
    </div>
  );

  const sortedQuests = [...quests].sort((a, b) => DIFF_ORDER[a.difficulty] - DIFF_ORDER[b.difficulty] || a.id - b.id);

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap events-screen">
    <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head events-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div className="event-title-wrap">
        <span className="eyebrow">{events[0]?.tag || "LIVE EVENT"}</span>
        <h1 className="event-title-main">{events[0]?.title ? events[0].title.toUpperCase() : "NEW BEGINNINGS"}</h1>
      </div>
      <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {flash && <p className="quest-flash">{flash}</p>}
    {error && <p className="auth-error pack-error">{error}</p>}

    {events.length > 0 && (
      <div className="events-live">
        {events.map((ev) => (
          <div key={ev.id} className={`events-live-card event-${ev.status}`}>
            <div className="events-live-art"><i>{ev.icon}</i></div>
            <div className="events-live-body">
              <span className="event-tag">{ev.tag}</span>
              <b>{ev.title}</b>
              <small>{ev.label}</small>
            </div>
          </div>
        ))}
      </div>
    )}

    <div className="events-cols">
      <section className="events-col">
        <div className="events-col-head"><h2>Event quests</h2><small>claim once per event</small></div>
        {sortedQuests.length === 0 && !error && <p className="inventory-empty">Loading event quests…</p>}
        {sortedQuests.map((q, index) => {
          const pct = Math.min(100, Math.round((q.progress / q.requirement) * 100));
          return (
            <motion.div key={q.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .04 + index * .04 }} className={`event-quest-card ${q.claimed ? "quest-done" : ""}`}>
              <div className="eq-top">
                <span className={`eq-diff eq-${q.difficulty}`}>{DIFF_LABEL[q.difficulty]}</span>
                <div className="eq-title"><b>{q.title}</b><span>{q.description}</span></div>
                <span className="eq-reward">{q.reward_coins ? `+${q.reward_coins} 🪙` : `+${q.reward_gems} 💎`}</span>
              </div>
              <div className="quest-track"><div className="quest-track-fill" style={{ width: `${pct}%` }} /></div>
              <div className="quest-bottom"><span>{q.progress} / {q.requirement}</span>
                {q.claimed ? <em>Claimed ✓</em> : q.claimable ? <button className="quest-claim" onClick={() => claim(q.id)}>Claim</button> : <em>{pct}%</em>}
              </div>
            </motion.div>
          );
        })}
      </section>

      <section className="events-col">
        <div className="events-col-head"><h2>Exchange</h2><small>purple {exchange?.reward.min}-{exchange?.reward.max} cards</small></div>
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: .18 }}>
            {view === "preview" ? exchangePreview : exchangePanel}
          </motion.div>
        </AnimatePresence>
      </section>
    </div>

    <AnimatePresence>
      {result && (
        <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="exchange-result" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .9, opacity: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
            <small>EXCHANGE COMPLETE</small>
            <h2>Purple {exchange?.reward.min}-{exchange?.reward.max} signing</h2>
            <div className="exchange-result-card"><FcCard player={{ ...result, version: "purple" }} /></div>
            <p className="exchange-result-note">Added to your club. Tap a squad slot to play them.</p>
            <button className="hero-btn primary-btn" onClick={() => setResult(null)}>Nice! <span>✓</span></button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>

    <AnimatePresence>
      {showAllPurple && (
        <motion.div className="pack-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="purple-all-modal" initial={{ scale: .9, y: 30 }} animate={{ scale: 1, y: 0 }} exit={{ scale: .95, opacity: 0 }} transition={{ type: "spring", stiffness: 180, damping: 18 }}>
            <div className="purple-all-head">
              <div>
                <span className="event-tag">PURPLE · {exchange?.reward.min}-{exchange?.reward.max}</span>
                <h2>All purple players <small>{previews.length} on rotation</small></h2>
              </div>
              <button className="icon-btn" onClick={() => setShowAllPurple(false)} aria-label="Close">✕</button>
            </div>
            <div className="purple-all-list">
              {previews.map((card) => (
                <div key={card.id} className="purple-all-row">
                  <FcCard player={{ ...card, version: "purple" }} size="sm" />
                  <div className="purple-all-info">
                    <b>{card.name}</b>
                    <small>{card.category} · {card.club || "Free agent"} · {card.nation}</small>
                  </div>
                  <strong>{card.base_rating ?? card.rating}</strong>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>

  {exchanging && <LoadingOverlay message="Exchanging…" />}
</main>;
}
