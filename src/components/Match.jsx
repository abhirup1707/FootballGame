import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import socket from "../socket";
import PenaltyShootout from "./PenaltyShootout";

const positions = { GK:"GK", LB:"LB", CB1:"CB", CB2:"CB", RB:"RB", CM1:"CM", CM2:"CM", CAM:"CAM", LW:"LW", ST:"ST", RW:"RW" };
const red = { GK:[50,88], LB:[15,71], CB1:[38,75], CB2:[62,75], RB:[85,71], CM1:[32,53], CM2:[68,53], CAM:[50,43], LW:[19,24], ST:[50,17], RW:[81,24] };
const blue = { GK:[50,12], LB:[15,29], CB1:[38,25], CB2:[62,25], RB:[85,29], CM1:[32,47], CM2:[68,47], CAM:[50,57], LW:[19,76], ST:[50,83], RW:[81,76] };
const formatClock = (ms) => { const cs = Math.floor(ms / 10); return `${String(Math.floor(cs / 6000)).padStart(2,"0")}:${String(Math.floor(cs / 100) % 60).padStart(2,"0")}.${String(cs % 100).padStart(2,"0")}`; };
function Player({ player, position, team, hasBall }) { const [x,y] = (team === "red" ? red : blue)[position]; return <div className={`match-player ${team} ${hasBall ? "has-ball" : ""}`} style={{ left:`${x}%`, top:`${y}%` }}><div className="shirt">{player.image ? <img src={player.image} alt="" /> : player.name.slice(0,2)}</div><em>{positions[position]}</em></div>; }

export default function Match({ room, initialData }) {
  const [data, setData] = useState(initialData), [locked, setLocked] = useState(false), [now, setNow] = useState(Date.now()), [flash, setFlash] = useState(null);
  useEffect(() => {
    const update = (next) => { setData((old) => ({ ...old, ...next, receivedAt:Date.now() })); setLocked(false); };
    const goal = (next) => { setFlash({ type:"goal", ...next }); setTimeout(() => setFlash(null), 2200); };
    const save = (next) => { setFlash({ type:"save", ...next }); setTimeout(() => setFlash(null), 1600); };
    socket.on("matchUpdate", update); socket.on("goalScored", goal); socket.on("saveMade", save); socket.on("penaltyStarted", update); socket.on("penaltyResult", update);
    return () => { socket.off("matchUpdate", update); socket.off("goalScored", goal); socket.off("saveMade", save); socket.off("penaltyStarted", update); socket.off("penaltyResult", update); };
  }, []);
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 40); return () => clearInterval(id); }, []);
  if (!data?.match) return null;
  if (data.shootout) return <PenaltyShootout room={room} data={data} />;
  const [aId,bId] = room.players.map((player) => player.id);
  const attackerId = data.possession, defenderId = attackerId === aId ? bId : aId;
  const attacker = data.teams[attackerId]?.positions || {};
  const phase = data.match.phase, goalTime = phase === "GOAL", carrier = data.match.carrier;
  const carrierPosition = Object.entries(attacker).find(([, player]) => player?.id === carrier?.id)?.[0];
  const [ballX, ballY] = (attackerId === aId ? red : blue)[carrierPosition] || [50,50];
  const isAttacking = socket.id === attackerId;
  const options = goalTime ? ["LEFT","CENTER","RIGHT"] : data.match.options || [];
  const elapsed = (data.elapsedMs || 0) + (now - (data.receivedAt || now));
  const choose = (move) => { setLocked(true); socket.emit("submitMove", { roomCode:room.roomCode, move }); };
  const renderTeam = (id, side) => Object.entries(data.teams[id]?.positions || {}).map(([position, player]) => player && <Player key={`${id}-${position}`} player={player} position={position} team={side} hasBall={id === attackerId && player.id === carrier?.id} />);
  return <main className="match-page"><header className="match-header"><div><span className="eyebrow">LIVE MATCH</span><h2>{room.players[0].name} <strong>{data.scoreA} – {data.scoreB}</strong> {room.players[1].name}</h2></div><div className="match-clock"><b>{formatClock(elapsed)}</b><small>{data.config?.mode === "time" ? `Ends at ${data.config.timeLimit}s` : `First to ${data.config?.goalLimit} goals`}</small></div></header><section className="match-layout"><div className="pitch-view"><div className="match-stage"><span>{goalTime ? "GOAL TIME" : `PASS ${data.match.passCount + 1} OF 5`}</span><h1>{carrier?.name} has the ball</h1><div className="pass-track">{[1,2,3,4,5].map((step) => <i key={step} className={step <= data.match.passCount ? "done" : ""}>{step}</i>)}</div></div><div className="single-pitch"><div className="centre-circle" /><div className="penalty top" /><div className="penalty bottom" />{renderTeam(aId,"red")}{renderTeam(bId,"blue")}<motion.div className="moving-ball" animate={{ left:`${ballX}%`, top:`${ballY}%` }} transition={{ type:"spring", stiffness:70, damping:10 }}>⚽</motion.div>{flash && <motion.div className={`${flash.type}-overlay`} initial={{ opacity:0,scale:.7 }} animate={{ opacity:1,scale:1 }}><span>{flash.type === "goal" ? "GOAL!" : "GREAT SAVE!"}</span><small>{flash.type === "goal" ? flash.scorer : `${flash.keeper} denies ${flash.shooter}`}</small></motion.div>}</div></div><aside className="match-control"><div className="carrier-card"><small>{goalTime ? "FINAL SHOT" : "CURRENT BALL CARRIER"}</small><b>{carrier?.name}</b><span>{carrier?.rating} OVR</span></div><p className="instruction">{isAttacking ? (goalTime ? "Choose your finish." : "Choose the next pass.") : (goalTime ? "Read the shot and cover a side." : "Predict the next pass to intercept it.")}</p><div className={`move-options ${goalTime ? "direction-options" : "player-options"}`}>{options.map((option) => { const direction = typeof option === "string"; return <button key={direction ? option : option.id} disabled={locked} onClick={() => choose(direction ? option : option.id)}>{direction ? <><strong>{option === "LEFT" ? "←" : option === "RIGHT" ? "→" : "↑"}</strong><small>{option.toLowerCase()}</small></> : <><i>{option.rating}</i><span>{option.name}</span><small>{option.position}</small></>}</button>; })}</div>{locked && <p className="choice-wait">Locked in — waiting for the other player.</p>}<div className="match-feed"><strong>Match story</strong>{(data.commentary || []).map((line,index) => <p key={index}>{line}</p>)}</div></aside></section></main>;
}
