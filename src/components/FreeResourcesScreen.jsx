import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../auth";
import api from "../api";

const AD_VIEW_SECONDS = 30;

export default function FreeResourcesScreen({ onBack }) {
  const { token, user, refreshUser } = useAuth();
  const [rewards, setRewards] = useState([]);
  const [watching, setWatching] = useState(null);
  const [timer, setTimer] = useState(0);
  const [adReady, setAdReady] = useState(false);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(null);
  const adRef = useRef(null);
  const pushed = useRef(false);

  const load = async () => {
    if (!token) return;
    try {
      const data = await api.freeResources(token);
      setRewards(data.rewards || []);
    } catch (e) { setError(e.message); }
  };

  useEffect(() => { load(); }, [token]);

  useEffect(() => {
    if (!watching || timer >= AD_VIEW_SECONDS) return;
    const iv = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [watching, timer >= AD_VIEW_SECONDS]);

  useEffect(() => {
    if (timer >= AD_VIEW_SECONDS && !adReady) setAdReady(true);
  }, [timer]);

  useEffect(() => {
    if (!watching || !adRef.current || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {}
  }, [watching]);

  const startWatch = (rewardKey) => {
    setError("");
    setWatching(rewardKey);
    setTimer(0);
    setAdReady(false);
    pushed.current = false;
  };

  const finishWatch = async () => {
    if (!watching) return;
    try {
      await api.watchAd(token, watching);
      await load();
      await refreshUser();
    } catch (e) { setError(e.message); }
    setWatching(null);
    setTimer(0);
    setAdReady(false);
  };

  const claim = async (rewardKey) => {
    setClaiming(rewardKey);
    try {
      const res = await api.claimFreeReward(token, rewardKey);
      await load();
      await refreshUser();
    } catch (e) { setError(e.message); }
    setClaiming(null);
  };

  const REWARD_META = {
    gems: { icon: "💎", color: "#a78bfa", bg: "linear-gradient(135deg,#1e1540,#150f2e)" },
    coins: { icon: "🪙", color: "#ffd24a", bg: "linear-gradient(135deg,#2a1f06,#1a1505)" },
  };

  return (
    <main className="lobby-bg">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <div className="hub-wrap">
        <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head">
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <div><span className="eyebrow">REWARDS</span><h1>Free Resources</h1></div>
          <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
        </motion.header>

        {error && <p className="auth-error pack-error">{error}</p>}

        <div className="free-resources-list">
          {rewards.map((reward, index) => {
            const meta = REWARD_META[reward.key] || REWARD_META.coins;
            const pct = Math.min(100, (reward.watched / reward.required) * 100);
            return (
              <motion.div
                key={reward.key}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 + index * 0.07 }}
                className="free-resource-card"
                style={{ background: meta.bg }}
              >
                <div className="free-resource-top">
                  <span className="free-resource-icon" style={{ background: meta.color + "22", color: meta.color }}>{meta.icon}</span>
                  <div className="free-resource-info">
                    <b>{reward.label}</b>
                    <span>Watch {reward.required} ads to earn this reward</span>
                  </div>
                </div>

                <div className="free-resource-progress">
                  <div className="free-resource-bar">
                    <div className="free-resource-fill" style={{ width: `${pct}%`, background: meta.color }} />
                  </div>
                  <small style={{ color: meta.color }}>{reward.watched}/{reward.required} ads watched</small>
                </div>

                <div className="free-resource-actions">
                  {reward.claimed ? (
                    <span className="free-resource-claimed">✓ Claimed today</span>
                  ) : reward.ready ? (
                    <button
                      className="free-resource-claim-btn"
                      style={{ background: meta.color, color: reward.key === "gems" ? "#1e1540" : "#1a1008" }}
                      disabled={claiming === reward.key}
                      onClick={() => claim(reward.key)}
                    >
                      {claiming === reward.key ? "Claiming..." : `Claim ${reward.label}`}
                    </button>
                  ) : (
                    <button className="free-resource-watch-btn" onClick={() => startWatch(reward.key)}>
                      📺 Watch Ad ({reward.watched}/{reward.required})
                    </button>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>

        {watching && (
          <div className="ad-modal-overlay" onClick={() => !adReady && setWatching(null)}>
            <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ad-modal-header">
                <b>📺 Watch Ad</b>
                <button className="ad-modal-close" onClick={() => { if (!adReady) setWatching(null); }}>✕</button>
              </div>
              <div className="ad-modal-body">
                <div className="ad-container">
                  <ins
                    className="adsbygoogle"
                    style={{ display: "block", minHeight: 250 }}
                    data-ad-client="ca-pub-2154007186287402"
                    data-ad-slot="6601221844"
                    data-ad-format="auto"
                    data-full-width-responsive="true"
                    ref={adRef}
                  />
                </div>
                <div className="ad-timer">
                  <div className="ad-timer-track">
                    <div className="ad-timer-fill" style={{ width: `${(timer / AD_VIEW_SECONDS) * 100}%` }} />
                  </div>
                  <small>{adReady ? "Ad watched!" : `${AD_VIEW_SECONDS - timer}s remaining`}</small>
                </div>
                {adReady && (
                  <button className="ad-claim-btn" onClick={finishWatch}>Continue</button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
