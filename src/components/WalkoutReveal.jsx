import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { countryFlagPath } from "../lib/countries";
import { clubLogoPath, isLaligaCard, lastName } from "../lib/card";

const STAT_ITEMS = [
  ["PAC", "pace"],
  ["SHO", "shooting"],
  ["PAS", "passing"],
  ["DRI", "dribbling"],
  ["DEF", "defending"],
  ["PHY", "physicality"],
];

const STAGE_STEPS = [700, 650, 650, 750, 850];

function StageGlow() {
  return <span className="walkout-glow" aria-hidden="true" />;
}

function FlagReveal({ card }) {
  const flag = countryFlagPath(card.nation);
  return (
    <div className="walkout-flag">
      <span className="walkout-flag-ring">
        {flag && <img src={flag} alt={card.nation} className="walkout-flag-img" />}
        {!flag && <b className="walkout-flag-letter">{(card.nation || "?")[0]}</b>}
      </span>
      <small className="walkout-flag-name">{card.nation}</small>
    </div>
  );
}

export default function WalkoutReveal({ card, packName, onDone }) {
  const [stage, setStage] = useState(0);
  const timers = useRef([]);

  useEffect(() => {
    let elapsed = 0;
    for (const step of STAGE_STEPS) {
      elapsed += step;
      timers.current.push(setTimeout(() => setStage((s) => s + 1), elapsed));
    }
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const rating = card.rating ?? card.base_rating ?? 0;
  const position = card.position || card.category || "?";
  const laliga = isLaligaCard(card);
  const clubLogo = laliga ? clubLogoPath(card.club) : null;
  const showFlag = stage >= 1;
  const showPos = stage >= 2;
  const showOvr = stage >= 3;
  const showPlayer = stage >= 4;
  const showStats = stage >= 5;
  const finished = stage >= 5;

  return (
    <motion.div className="pack-overlay walkout-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className={`walkout-card walkout-${laliga ? "laliga" : "purple"}`}>
        <StageGlow />
        <div className="walkout-sheen" />
        {clubLogo && <img className="walkout-club" src={clubLogo} alt="" aria-hidden="true" />}
        {laliga && <span className="walkout-league">LALIGA</span>}
        <div className="walkout-head">
          <AnimatePresence>{showFlag && <motion.div key="flag" initial={{ opacity: 0, scale: .2, rotate: -30 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 240, damping: 14 }}><FlagReveal card={card} /></motion.div>}</AnimatePresence>
          <AnimatePresence>{showOvr && <motion.div key="ovr" className="walkout-ovr" initial={{ opacity: 0, y: -34, scale: .4 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 15 }}><b>{rating}</b><small>OVR</small></motion.div>}</AnimatePresence>
        </div>
        <div className="walkout-mid">
          <AnimatePresence>{showPos && <motion.div key="pos" className="walkout-pos" initial={{ opacity: 0, scale: .2 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: "spring", stiffness: 280, damping: 13 }}><b>{position}</b><small>POSITION</small></motion.div>}</AnimatePresence>
        </div>
        <AnimatePresence>
          {showPlayer && (
            <motion.div key="player" className="walkout-player" initial={{ opacity: 0, y: 60, scale: .8 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 150, damping: 15 }}>
              <div className="walkout-photo">
                {card.image
                  ? <img src={card.image} alt={card.name} className="walkout-img" />
                  : <span className="walkout-silhouette">⚽</span>}
              </div>
              <motion.h2 className="walkout-name" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: .25 }}>{lastName(card.name)}</motion.h2>
              <motion.div className="walkout-stats" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: .45 }}>
                {STAT_ITEMS.map(([label, key]) => <span className="walkout-stat" key={key}><em>{label}</em><b>{card[key] ?? "-"}</b></span>)}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="walkout-foot">
          <small>{packName}</small>
        </div>
        <AnimatePresence>
          {finished && (
            <motion.button className="hero-btn primary-btn pack-collect walkout-collect" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} onClick={onDone}>
              Collect <span>✓</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
