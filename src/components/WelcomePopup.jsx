import { useState } from "react";
import { motion } from "framer-motion";
import FcCard from "./FcCard";

export default function WelcomePopup({ gift, onAccept }) {
  const [step, setStep] = useState("greet");
  const [revealed, setRevealed] = useState(0);

  const cards = gift?.cards || [];
  const startReveal = () => {
    setStep("reveal");
    cards.forEach((_, i) => setTimeout(() => setRevealed(i + 1), 350 + i * 150));
  };

  if (step === "greet") {
    return <motion.div className="pack-overlay welcome-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div className="welcome-pop" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
        <span className="welcome-emoji">⚽</span>
        <h1>Welcome to Footyverse <small>by Abhirup</small></h1>
        <p className="welcome-greet-text">Please accept our gift and assemble them to make your first squad.</p>
        <div className="welcome-gift-summary">
          <span><b>{cards.length}</b> Players</span>
          <span><b>+500</b> 🪙</span>
          <span><b>+100</b> 💎</span>
        </div>
        <button className="hero-btn primary-btn" onClick={startReveal}>Claim all <span>→</span></button>
      </motion.div>
    </motion.div>;
  }

  return <motion.div className="pack-overlay welcome-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="welcome-reveal">
      <div className="pack-reveal-head"><small>YOUR WELCOME GIFT</small><h2>15 players for your club</h2><p className="pack-streak-bonus">+500 coins · +100 gems</p></div>
      <div className="welcome-grid">
        {cards.map((card, index) => (
          <motion.div key={card.id} initial={{ opacity: 0, scale: .4, rotateY: 180 }} animate={revealed > index ? { opacity: 1, scale: 1, rotateY: 0 } : {}} transition={{ type: "spring", stiffness: 160, damping: 14 }}>
            <FcCard player={card} size="sm" />
          </motion.div>
        ))}
      </div>
      <button className="hero-btn primary-btn pack-collect" onClick={onAccept}>Collect all <span>✓</span></button>
    </div>
  </motion.div>;
}
