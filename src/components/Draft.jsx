import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Match from "./Match";
import AnimatedPack from "./AnimatedPack";
import SquadBoard from "./SquadBoard";
import socket from "../socket";
import attackers from "../data/attackers.json";
import midfielders from "../data/midfielders.json";
import defenders from "../data/defenders.json";
import goalkeepers from "../data/goalkeepers.json";

const allPlayers = [...attackers, ...midfielders, ...defenders, ...goalkeepers];
const emptyPositions = () => ({ GK:null, LB:null, CB1:null, CB2:null, RB:null, CM1:null, CM2:null, CAM:null, LW:null, ST:null, RW:null });
const label = { ATT:"Attackers", MID:"Midfielders", DEF:"Defenders", GK:"Goalkeeper" };

function buildXI(players) {
  const by = (position) => players.filter((player) => player.position === position);
  const att = by("ATT"), mid = by("MID"), def = by("DEF"), gk = by("GK");
  return { GK:gk[0], LB:def[0], CB1:def[1], CB2:def[2], RB:def[3], CM1:mid[0], CAM:mid[1], CM2:mid[2], LW:att[0], ST:att[1], RW:att[2] };
}

export default function Draft({ room }) {
  const [draft, setDraft] = useState({ turnId:null, round:0, category:null, picks:{}, complete:false });
  const [pack, setPack] = useState([]);
  const [opening, setOpening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [matchData, setMatchData] = useState(null);
  const [finished, setFinished] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const me = room.players.find((player) => player.id === socket.id);
  const turnPlayer = room.players.find((player) => player.id === draft.turnId);
  const myPicks = draft.picks[socket.id] || [];
  const positions = useMemo(() => buildXI(myPicks), [myPicks]);
  const overall = useMemo(() => myPicks.length ? Number((myPicks.reduce((sum, player) => sum + player.rating, 0) / myPicks.length).toFixed(1)) : 0, [myPicks]);

  useEffect(() => {
    const onDraft = (data) => { setDraft(data); setPack([]); setOpening(false); };
    const onPack = ({ pack }) => { setOpening(true); setTimeout(() => setPack(pack), 450); };
    const onReady = setReadyCount;
    const onMatch = (data) => setMatchData(data);
    const onFinished = (data) => { setCelebration(data); setTimeout(() => { setFinished(data); setCelebration(null); }, 2600); };
    socket.on("draftState", onDraft); socket.on("draftPack", onPack); socket.on("readyCount", onReady);
    socket.on("enterMatch", onMatch); socket.on("matchFinished", onFinished);
    return () => { socket.off("draftState", onDraft); socket.off("draftPack", onPack); socket.off("readyCount", onReady); socket.off("enterMatch", onMatch); socket.off("matchFinished", onFinished); };
  }, []);

  useEffect(() => { socket.emit("getDraftState", { roomCode: room.roomCode }); }, [room.roomCode]);

  useEffect(() => {
    if (draft.turnId === socket.id && !draft.complete) socket.emit("requestDraftPack", { roomCode:room.roomCode, players:allPlayers });
  }, [draft.turnId, draft.round, draft.complete, room.roomCode]);

  if (celebration && !finished) {
    const shootout = celebration.shootout;
    const score = (id) => shootout?.kicks?.[id]?.filter(Boolean).length || 0;
    const winner = shootout ? room.players[score(room.players[0].id) > score(room.players[1].id) ? 0 : 1]?.name : room.players[celebration.scoreA > celebration.scoreB ? 0 : 1]?.name;
    return <main className="winner-celebration"><div className="fireworks">{Array.from({ length:18 }, (_, index) => <i key={index} style={{ "--spark":index }} />)}</div><motion.div initial={{ scale:.4, opacity:0 }} animate={{ scale:1, opacity:1 }} className="winner-announcement"><span>🏆</span><small>FULL TIME</small><h1>{winner} wins!</h1><p>{shootout ? "Penalty shootout secured" : "The final whistle blows"}</p></motion.div></main>;
  }
  if (finished) {
    const shootout = finished.shootout;
    const penaltyScore = (id) => shootout?.kicks?.[id]?.filter(Boolean).length || 0;
    const shootoutWinnerId = shootout && penaltyScore(room.players[0].id) !== penaltyScore(room.players[1].id) ? (penaltyScore(room.players[0].id) > penaltyScore(room.players[1].id) ? room.players[0].id : room.players[1].id) : null;
    const winner = shootoutWinnerId ? `${room.players.find((player) => player.id === shootoutWinnerId)?.name} wins on penalties (${penaltyScore(room.players[0].id)}–${penaltyScore(room.players[1].id)})` : finished.scoreA === finished.scoreB ? "Draw" : room.players[finished.scoreA > finished.scoreB ? 0 : 1]?.name;
    const rows = room.players.map((player) => ({ player, ...(finished.stats?.[player.id] || { passes:0, interceptions:0, goals:[] }) }));
    const mvp = [...rows].sort((a,b) => (b.goals.length * 5 + b.passes + b.interceptions * 2) - (a.goals.length * 5 + a.passes + a.interceptions * 2))[0];
    return <div className="fulltime"><motion.div initial={{ scale:.5, opacity:0 }} animate={{ scale:1, opacity:1 }} className="fulltime-card final-scoreboard"><div className="trophy">🏆</div><p>FULL TIME</p><h1>{finished.scoreA} <span>–</span> {finished.scoreB}</h1><h2>{winner === "Draw" ? "It ends level" : `${winner} wins the match!`}</h2><div className="mvp-card"><small>MATCH MVP</small><b>{mvp?.goals?.[0] || mvp?.player.name}</b><span>{mvp?.goals?.length || 0} goal{mvp?.goals?.length === 1 ? "" : "s"} · {mvp?.passes || 0} passes</span></div><div className="stats-table">{rows.map((row) => <div key={row.player.id}><b>{row.player.name}</b><span>{row.passes} passes</span><span>{row.interceptions} interceptions</span><span>{row.goals.length ? row.goals.join(", ") : "No goals"}</span></div>)}</div><button className="primary-btn" onClick={() => window.location.reload()}>Start a new game</button></motion.div></div>;
  }
  if (matchData) return <Match room={{ ...room, teams:matchData.teams }} initialData={matchData} />;

  const ready = () => { setWaiting(true); socket.emit("playerReady", { roomCode:room.roomCode, positions, overall }); };
  return <main className="draft-page">
    <header className="draft-header"><div><span className="eyebrow">LIVE DRAFT</span><h1>{room.players[0]?.name} <b>vs</b> {room.players[1]?.name}</h1></div><div className="draft-progress"><strong>{Math.min(draft.round + 1, 22)} / 22</strong><span>picks completed</span></div></header>
    {!draft.complete ? <>
      <section className={`turn-banner ${draft.turnId === socket.id ? "your-turn" : "opponent-turn"}`}>
        <span className="turn-dot" />
        <div><strong>{draft.turnId === socket.id ? "Your turn to choose" : `${turnPlayer?.name || "Opponent"} is choosing`}</strong><small>{label[draft.category]} • one legend leaves the pool forever</small></div>
      </section>
      <div className="draft-workspace"><section className="pick-stage">
        {opening && !pack.length && <div className="pack-loading">Opening {label[draft.category]} pack…</div>}
        {pack.length > 0 && <AnimatedPack players={pack} onPick={(player) => socket.emit("draftPick", { roomCode:room.roomCode, player, allPlayers })} />}
        {draft.turnId !== socket.id && <div className="waiting-turn"><div className="spinner" /><h2>Watch the draft unfold</h2><p>{turnPlayer?.name} is selecting from {label[draft.category]?.toLowerCase()}.</p></div>}
      </section><aside className="draft-team"><h2>Your XI</h2><SquadBoard positions={positions} draftedPlayers={myPicks} overall={overall} readOnly /></aside></div>
    </> : <section className="team-ready"><SquadBoard positions={positions} draftedPlayers={myPicks} overall={overall} readOnly /><div><span className="eyebrow">DRAFT COMPLETE</span><h2>Your team is ready</h2><p>Every pick is unique across both squads. Confirm when you are happy with your starting XI.</p>{waiting ? <button className="primary-btn" disabled>Waiting for opponent · {readyCount}/2</button> : <button className="primary-btn" onClick={ready}>Ready for match</button>}</div></section>}
  </main>;
}
