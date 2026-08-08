import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";

const TABS = [
  { key: "wins", label: "Wins", icon: "🏆", stat: "wins" },
  { key: "goals", label: "Goals", icon: "⚽", stat: "goals" },
  { key: "saves", label: "Saves", icon: "🧤", stat: "saves" },
];

export default function Leaderboard({ onBack }) {
  const { token, user } = useAuth();
  const [type, setType] = useState("wins");
  const [entries, setEntries] = useState([]);
  const [me, setMe] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.leaderboard(token, type)
      .then((data) => {
        if (!alive) return;
        setEntries(data.entries);
        setMe(data.me);
      })
      .catch((err) => { if (alive) setError(err.message); });
    return () => { alive = false; };
  }, [token, type]);

  const activeTab = TABS.find((t) => t.key === type);

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap leaderboard-screen">
    <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="team-head">
      <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
      <div><span className="eyebrow">GLOBAL RANKINGS</span><h1>Leaderboard</h1></div>
      <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
    </motion.header>
    {error && <p className="auth-error pack-error">{error}</p>}
    <div className="lb-tabs">
      {TABS.map((tab) => <button key={tab.key} className={type === tab.key ? "active" : ""} onClick={() => setType(tab.key)}><i>{tab.icon}</i>{tab.label}</button>)}
    </div>
    {me && <div className="lb-me">You are <b>#{me.rank}</b> — {me.wins} 🏆 wins · {me.goals} ⚽ goals · {me.saves} 🧤 saves</div>}
    <div className="lb-list">
      {!entries.length && !error && <p className="inventory-empty">No stats yet — play a match to get ranked.</p>}
      {entries.map((entry, index) => (
        <motion.div key={entry.username} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }} transition={{ delay:.06 + index * .04 }} className={`lb-row ${entry.username === user.username ? "lb-me-row" : ""}`}>
          <span className="lb-rank">{index + 1}</span>
          <span className="lb-avatar">{entry.username.slice(0, 2).toUpperCase()}</span>
          <span className="lb-name">{entry.username}</span>
          <span className="lb-stat">{activeTab.icon} {entry[type]}</span>
        </motion.div>
      ))}
    </div>
  </div></main>;
}
