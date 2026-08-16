import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth";
import api from "../api";

const AD_VIEW_SECONDS = 30;

export default function RewardedAd({ onReward }) {
  const { user, token, refreshUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const [timer, setTimer] = useState(0);
  const [claiming, setClaiming] = useState(false);
  const [earned, setEarned] = useState(null);
  const adRef = useRef(null);
  const pushed = useRef(false);

  useEffect(() => {
    if (!token) return;
    api.adRewardStatus(token).then(({ cooldownMs: ms }) => setCooldownMs(ms)).catch(() => {});
  }, [token, open]);

  useEffect(() => {
    if (cooldownMs <= 0) return;
    const iv = setInterval(() => setCooldownMs((ms) => Math.max(0, ms - 1000)), 1000);
    return () => clearInterval(iv);
  }, [cooldownMs > 0]);

  useEffect(() => {
    if (!open || timer >= AD_VIEW_SECONDS) return;
    const iv = setInterval(() => setTimer((t) => t + 1), 1000);
    return () => clearInterval(iv);
  }, [open, timer >= AD_VIEW_SECONDS]);

  useEffect(() => {
    if (!open || !adRef.current || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {}
  }, [open]);

  useEffect(() => {
    if (!open) { setTimer(0); setEarned(null); pushed.current = false; }
  }, [open]);

  const claim = async () => {
    setClaiming(true);
    try {
      const res = await api.claimAdReward(token);
      setEarned(res.coins);
      setCooldownMs(AD_VIEW_SECONDS * 1000);
      refreshUser();
      onReward?.(res);
    } catch (e) {
      if (e.message.includes("not ready")) setCooldownMs(60 * 60 * 1000);
    } finally {
      setClaiming(false);
    }
  };

  const cooldownMin = Math.ceil(cooldownMs / 60000);
  const ready = cooldownMs <= 0;
  const viewComplete = timer >= AD_VIEW_SECONDS;

  return (
    <>
      <button className={`ad-reward-btn ${!ready ? "ad-cooldown" : ""}`} onClick={() => ready && setOpen(true)} disabled={!ready}>
        <span className="ad-reward-icon">📺</span>
        <span className="ad-reward-label">
          {ready ? "Watch Ad · +250 🪙" : `Available in ${cooldownMin}m`}
        </span>
      </button>

      {open && (
        <div className="ad-modal-overlay" onClick={() => !claiming && setOpen(false)}>
          <div className="ad-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ad-modal-header">
              <b>📺 Watch & Earn</b>
              <button className="ad-modal-close" onClick={() => setOpen(false)} disabled={claiming}>✕</button>
            </div>
            <div className="ad-modal-body">
              {earned ? (
                <div className="ad-earned">
                  <span className="ad-earned-icon">🪙</span>
                  <b>+{earned} Coins!</b>
                  <p>Added to your balance.</p>
                </div>
              ) : (
                <>
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
                    <small>
                      {viewComplete ? "Ad watched! Claim your reward below." : `Watching... ${AD_VIEW_SECONDS - timer}s remaining`}
                    </small>
                  </div>
                  <button
                    className="ad-claim-btn"
                    disabled={!viewComplete || claiming}
                    onClick={claim}
                  >
                    {claiming ? "Claiming..." : viewComplete ? "Claim +250 🪙" : `Watch ${AD_VIEW_SECONDS}s to earn`}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
