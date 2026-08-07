import { useState } from "react";
import { motion } from "framer-motion";
import FcCard from "./FcCard";

export default function AnimatedPack({ players, onPick }) {
  const [revealed, setRevealed] = useState({});
  return <div className="pack-overlay"><div className="pack-container four-card-pack">{players.map((player, index) => {
    const open = revealed[player.id];
    return <motion.div key={player.id} initial={{ opacity:0, y:180, rotateY:-105, scale:.6 }} animate={{ opacity:1, y:0, rotateY:0, scale:1 }} transition={{ delay:index*.14, type:"spring", stiffness:120, damping:13 }} className={`pack-slot ${open ? "is-revealed" : "is-hidden"}`} onClick={() => open ? onPick(player) : setRevealed((old)=>({...old,[player.id]:true}))}>
      {!open
        ? <div className="card-back"><span>FD</span><small>CLICK TO REVEAL</small></div>
        : <FcCard player={player} clickable />}
    </motion.div>;
  })}</div></div>;
}
