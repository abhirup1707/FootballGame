import { motion } from "framer-motion";
import { useAuth } from "../auth";
import PlayerBrowser from "./PlayerBrowser";

export default function PlayersScreen({ onBack }) {
  const { user } = useAuth();
  return (
    <main className="lobby-bg">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <div className="hub-wrap events-screen">
        <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head events-head">
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <div className="event-title-wrap">
            <span className="eyebrow">PLAYER DATABASE</span>
            <h1 className="event-title-main">ALL PLAYERS</h1>
          </div>
          <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
        </motion.header>
        <PlayerBrowser />
      </div>
    </main>
  );
}
