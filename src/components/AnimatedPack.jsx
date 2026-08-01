import { useState } from "react";
import { motion } from "framer-motion";
const tier = (rating) => rating >= 98 ? "elite-card" : rating >= 95 ? "tier-two" : rating >= 93 ? "tier-three" : "tier-four";
export default function AnimatedPack({ players, onPick }) {
  const [revealed, setRevealed] = useState({});
  return <div className="pack-overlay"><div className="pack-container four-card-pack">{players.map((player,index) => {
    const open = revealed[player.id];
    return <motion.div key={player.id} initial={{opacity:0,y:180,rotateY:-105,scale:.6}} animate={{opacity:1,y:0,rotateY:0,scale:1}} transition={{delay:index*.14,type:"spring",stiffness:120,damping:13}} className={`fc-card ${tier(player.rating)} ${open ? "is-revealed" : "is-hidden"}`} onClick={() => open ? onPick(player) : setRevealed((old)=>({...old,[player.id]:true}))}>
      {!open ? <div className="card-back"><span>FD</span><small>CLICK TO REVEAL</small></div> : <><div className="player-avatar">{player.image ? <img src={player.image} alt={player.name} className="player-face" /> : player.name.split(" ").map((word)=>word[0]).join("").slice(0,2)}</div><div className="fc-rating">{player.rating}</div><div className="fc-name">{player.name}</div><div className="fc-position">{player.position}</div><small className="pick-now">CLICK TO PICK</small></>}</motion.div>;
  })}</div></div>;
}
