import { motion } from "framer-motion";
import { useAuth } from "../auth";

export default function Hub({ onNavigate }) {
  const { user, logout } = useAuth();
  const navItems = [
    { key: "play", icon: "⚡", title: "Play a match", desc: "Create a room or jump into a friendly.", soon: false },
    { key: "team", icon: "🛡️", title: "My team", desc: "Build your starting XI from the players you own.", soon: false },
    { key: "packs", icon: "🎁", title: "Packs", desc: "Open players for your club.", soon: false },
    { key: "quests", icon: "📋", title: "Quests", desc: "Complete objectives for rewards.", soon: false },
  ];

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><div className="hub-wrap">
    <motion.header initial={{ opacity:0, y:-14 }} animate={{ opacity:1, y:0 }} className="hub-top">
      <div className="brand-mark"><span>⚽</span><b>FOOTYVERSE</b></div>
      <div className="hub-profile"><div className="hub-avatar">{user.username.slice(0, 2).toUpperCase()}</div><div><small>MANAGER</small><b>{user.username}</b></div><div className="hub-level">LV {user.level}</div><div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div></div>
    </motion.header>
    <motion.section initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }} transition={{ delay:.08 }} className="hub-hero">
      <span className="eyebrow">ONLINE FOOTBALL CLUB</span>
      <h1>Own your club.<br /><em>Win the weekend.</em></h1>
      <p>Draft legends, build your team, and outplay rivals in live 1v1 matches.</p>
    </motion.section>
    <div className="hub-grid">
      {navItems.map((item, index) => <motion.button key={item.key} initial={{ opacity:0, y:18 }} animate={{ opacity:1, y:0 }} transition={{ delay:.14 + index * .07 }} className={`hub-card ${item.soon ? "soon" : ""}`} disabled={item.soon} onClick={() => onNavigate(item.key)}>
        <i>{item.icon}</i>
        <b>{item.title}</b>
        <span>{item.desc}</span>
        {item.soon && <em>COMING SOON</em>}
      </motion.button>)}
    </div>
    <button className="hub-signout" onClick={logout}>Sign out</button>
  </div></main>;
}
