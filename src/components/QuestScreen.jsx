import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";

export default function QuestScreen({ onBack }) {
  const { token, user, refreshUser } = useAuth();
  const [quests, setQuests] = useState([]);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  const load = async () => {
    try {
      const data = await api.quests(token);
      setQuests(data.quests);
    } catch (err) { setError(err.message); }
  };

  useEffect(() => { load(); }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  const claim = async (questId) => {
    try {
      const data = await api.claimQuest(token, questId);
      setFlash(`Reward collected: ${data.reward.coins ? `+${data.reward.coins} 🪙 ` : ""}${data.reward.gems ? `+${data.reward.gems} 💎 ` : ""}${data.reward.pack ? "📦 pack " : ""}`);
      await refreshUser();
      load();
    } catch (err) { setError(err.message); }
  };

  const daily = quests.filter((q) => q.reset_daily);
  const weekly = quests.filter((q) => !q.reset_daily);

  const QuestCard = ({ quest, index }) => {
    const pct = Math.min(100, Math.round((quest.progress / quest.requirement) * 100));
    return <motion.div key={quest.id} initial={{ opacity:0, y:16 }} animate={{ opacity:1, y:0 }} transition={{ delay:.08 + index * .06 }} className={`quest-card ${quest.claimed ? "quest-done" : ""}`}>
      <div className="quest-row"><div><b>{quest.title}</b><span>{quest.description}</span></div><div className="quest-reward">{[quest.reward_coins && `+${quest.reward_coins} 🪙`, quest.reward_gems && `+${quest.reward_gems} 💎`, quest.reward_pack && "📦 Pack"].filter(Boolean).join(" · ")}</div></div>
      <div className="quest-track"><div className="quest-track-fill" style={{ width:`${pct}%` }} /></div>
      <div className="quest-bottom"><span>{quest.progress} / {quest.requirement}</span>
        {quest.claimed ? <em>Claimed ✓</em> : quest.claimable ? <button className="quest-claim" onClick={() => claim(quest.id)}>Claim</button> : <em>{pct}%</em>}
      </div>
    </motion.div>;
  };

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap quests-screen">
    <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="team-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div><span className="eyebrow">MANAGER OBJECTIVES</span><h1>Quests</h1></div>
      <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {flash && <p className="quest-flash">{flash}</p>}
    {error && <p className="auth-error pack-error">{error}</p>}
    <section className="quest-group"><h2>Daily <small>resets tomorrow</small></h2>{daily.length ? daily.map((q, i) => <QuestCard key={q.id} quest={q} index={i} />) : <p className="inventory-empty">Loading…</p>}</section>
    <section className="quest-group"><h2>Weekly <small>bigger rewards</small></h2>{weekly.map((q, i) => <QuestCard key={q.id} quest={q} index={i} />)}</section>
  </div></main>;
}
