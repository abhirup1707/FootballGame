import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import socket from "../socket";
import EmoteBar from "./EmoteBar";

const directions = ["LEFT", "CENTER", "RIGHT"];
const initials = (player) => player?.name?.split(" ").map((part) => part[0]).join("").slice(0, 2);
function Portrait({ player, side, label, dive }) { return <div className={`penalty-portrait ${side} ${dive ? `dive-${dive.toLowerCase()}` : ""}`}><div>{player?.image ? <img src={player.image} alt={player.name} /> : initials(player)}</div><small>{label}</small><b>{player?.name}</b></div>; }
function DirectionButtons({ onChoose, disabled }) { return <div className="direction-row">{directions.map((direction) => <button key={direction} disabled={disabled} onClick={() => onChoose(direction)}>{direction === "LEFT" ? "←" : direction === "RIGHT" ? "→" : "↑"}<span>{direction.toLowerCase()}</span></button>)}</div>; }

export default function PenaltyShootout({ room, data }) {
  const [choiceLocked, setChoiceLocked] = useState(false);
  const shootout = data.shootout;
  const [teamA, teamB] = room.players.map((player) => player.id);
  const attackingId = shootout.currentTeam;
  const defendingId = attackingId === teamA ? teamB : teamA;
  const attackingTeam = data.teams[attackingId];
  const defendingTeam = data.teams[defendingId];
  const isShooter = socket.id === attackingId;
  const isKeeper = socket.id === defendingId;
  const select = (playerId) => socket.emit("selectPenaltyShooter", { roomCode:room.roomCode, playerId });
  const choose = (direction) => { setChoiceLocked(true); socket.emit("submitPenaltyDirection", { roomCode:room.roomCode, direction }); };
  const markers = (id) => Array.from({ length:5 }, (_, index) => <i key={index} className={shootout.kicks[id][index] === true ? "scored" : shootout.kicks[id][index] === false ? "saved" : ""}>{shootout.kicks[id][index] === true ? "✓" : shootout.kicks[id][index] === false ? "×" : ""}</i>);
  const result = shootout.result;
  const candidates = Object.values(attackingTeam.positions).filter((player) => player?.position !== "GK" && !shootout.usedShooters?.[attackingId]?.includes(player.id));
  const shootoutScore = (id) => shootout.kicks[id].filter(Boolean).length;

  // Reset the local button lock for the next kick. The server never includes
  // live choices, so neither side can see the other direction in advance.
  useEffect(() => { setChoiceLocked(false); }, [shootout.currentTeam, shootout.phase]);
  const keeperDive = result?.dive;

  return <main className="penalty-page">
    <header className="penalty-scorecard"><div><b>{room.players[0].name}</b><span>{markers(teamA)}</span></div><strong><small>SHOOTOUT</small>{shootoutScore(teamA)} – {shootoutScore(teamB)}</strong><div><span>{markers(teamB)}</span><b>{room.players[1].name}</b></div></header>
    <EmoteBar roomCode={room.roomCode} />
    <section className="penalty-stage"><div className="shootout-kicker">PENALTY SHOOTOUT <small>{room.players.find((p) => p.id === attackingId)?.name} to take</small></div>
      {shootout.phase === "SELECT" ? <div className="shooter-select"><h1>Choose your penalty taker</h1><p>{isShooter ? "Pick any outfield player from your XI." : "Your opponent is selecting their taker."}</p><div>{candidates.map((player) => <button key={player.id} disabled={!isShooter} onClick={() => select(player.id)}>{player.image && <img src={player.image} alt="" />}<span>{player.name}</span><small>{player.rating} OVR</small></button>)}</div></div> : <><div className="goal-frame"><div className="goal-net" /><Portrait player={defendingTeam.positions.GK} side="keeper" label="GOALKEEPER" dive={keeperDive} /></div><div className="penalty-duel"><Portrait player={shootout.selectedShooter} side="shooter" label="PENALTY TAKER" />{result && <motion.div className={`penalty-ball ${result.goal ? "goal" : "save"}`} initial={{ y:110, x:0, scale:.5 }} animate={{ y:-210, x:result.shot === "LEFT" ? -125 : result.shot === "RIGHT" ? 125 : 0, scale:1.15 }}><span>⚽</span><b>{result.goal ? "GOAL!" : "SAVED!"}</b></motion.div>}</div>{shootout.phase === "DUEL" && <div className="penalty-controls"><div><small>{isShooter ? (choiceLocked ? "Direction locked — waiting" : "Choose where to shoot") : "Striker is choosing"}</small>{isShooter && <DirectionButtons onChoose={choose} disabled={choiceLocked} />}</div><div><small>{isKeeper ? (choiceLocked ? "Dive locked — waiting" : "Choose your goalkeeper dive") : "Goalkeeper is choosing"}</small>{isKeeper && <DirectionButtons onChoose={choose} disabled={choiceLocked} />}</div></div>}{shootout.phase === "RESULT" && <div className="penalty-result">{result.goal ? `${result.shooter.name} scores!` : `${result.keeper.name} makes the save!`}</div>}</>}</section>
  </main>;
}
