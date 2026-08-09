import { useState } from "react";
import { motion } from "framer-motion";

export default function LoginRewardPopup({ reward, onClaim, onDone }) {
  const [claiming, setClaiming] = useState(false);
  const [claimed, setClaimed] = useState(null);

  const handleClaim = async () => {
    if (claiming) return;
    setClaiming(true);
    try {
      const data = await onClaim();
      setClaimed(data?.reward || { coins: reward.coins, gems: reward.gems });
    } finally {
      setClaiming(false);
    }
  };

  return (
    <motion.div className="pack-overlay welcome-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div className="welcome-pop" initial={{ scale: .8, y: 30 }} animate={{ scale: 1, y: 0 }} transition={{ type: "spring", stiffness: 160, damping: 16 }}>
        <span className="welcome-emoji">🎁</span>
        {claimed ? (
          <>
            <h1>Reward claimed!</h1>
            <p className="welcome-greet-text">Thanks for joining the ultimate fun football game…. Please accept our small gift.</p>
            <div className="welcome-gift-summary">
              <span><b>+{claimed.coins}</b> 🪙</span>
              <span><b>+{claimed.gems}</b> 💎</span>
            </div>
            <button className="hero-btn primary-btn" onClick={onDone}>Continue <span>→</span></button>
          </>
        ) : (
          <>
            <h1>Daily login reward <small>by Footyverse</small></h1>
            <p className="welcome-greet-text">Thanks for joining the ultimate fun football game…. Please accept our small gift.</p>
            <div className="welcome-gift-summary">
              <span><b>+{reward.coins}</b> 🪙</span>
              <span><b>+{reward.gems}</b> 💎</span>
            </div>
            <button className="hero-btn primary-btn" onClick={handleClaim} disabled={claiming}>
              {claiming ? "Claiming…" : "Claim reward"} <span>→</span>
            </button>
            <p className="login-reward-note">(Available for {reward.daysLeft} day{reward.daysLeft === 1 ? "" : "s"})</p>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
