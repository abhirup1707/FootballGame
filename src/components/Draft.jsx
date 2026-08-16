import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Match from "./Match";
import AnimatedPack from "./AnimatedPack";
import SquadBoard from "./SquadBoard";
import socket from "../socket";
import api from "../api";
import { useAuth } from "../auth";
import LoadingOverlay from "./LoadingOverlay";
import { slotCategory, effectiveRating } from "../lib/position";
import FORMATIONS from "../data/formations.json";

const DEFAULT_FORMATION = "4-3-3";
const formationForKey = (key) => FORMATIONS[key] || FORMATIONS[DEFAULT_FORMATION];
const emptyPositions = (key) => Object.fromEntries(formationForKey(key).slots.map((slot) => [slot, null]));
const EMPTY_PLAYERS = [];
const TOTAL_ROUNDS = 22;
const label = { ATT:"Attackers", MID:"Midfielders", DEF:"Defenders", GK:"Goalkeeper" };

function buildXI(players, formation) {
  const next = emptyPositions(formation);
  const used = new Set();
  formation.slots.forEach((slot) => {
    const category = formation.slotCategory[slot];
    const player = players.find((p) => p.position === category && !used.has(p.id));
    if (player) { next[slot] = player; used.add(player.id); }
  });
  return next;
}

function syncLineup(current, players, formation) {
  const next = emptyPositions(formation);
  const draftedById = new Map(players.map((player) => [player.id, player]));
  const assignedIds = new Set();
  Object.entries(current).forEach(([slot, player]) => {
    const draftedPlayer = player && draftedById.get(player.id);
    if (draftedPlayer && formation.slotCategory[slot] === draftedPlayer.position) {
      next[slot] = draftedPlayer;
      assignedIds.add(draftedPlayer.id);
    }
  });
  players.forEach((player) => {
    if (assignedIds.has(player.id)) return;
    const openSlot = formation.slots.find((slot) => !next[slot] && formation.slotCategory[slot] === player.position);
    if (openSlot) next[openSlot] = player;
  });
  return next;
}

function FormationPicker({ onPick, opponentChosen }) {
  return <section className="formation-picker">
    <div className="formation-picker-head"><span className="eyebrow">PICK YOUR FORMATION</span><h2>Choose how you'll set up</h2><p>Your draft packs only ever offer the positions your shape needs.{opponentChosen ? ` ${opponentChosen} is already locked in by your opponent.` : ""}</p></div>
    <div className="formation-grid">
      {Object.entries(FORMATIONS).map(([key, f]) => (
        <button key={key} type="button" className={`formation-card ${opponentChosen === key ? "opponent" : ""}`} onClick={() => onPick(key)}>
          <span className="formation-name">{f.name}</span>
          <span className="formation-counts">DEF {f.def} · MID {f.mid} · ATT {f.att}</span>
          <span className="formation-pitch">{f.rows.slice().reverse().map((row, rowIndex) => (
            <span className="formation-pitch-row" key={rowIndex} style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>{row.map((slot) => <i key={slot}>{slot.replace(/[0-9]+$/, "")}</i>)}</span>
          ))}</span>
          <span className="formation-draft">Draft {f.att} ATT · {f.mid} MID · {f.def} DEF · 1 GK</span>
        </button>
      ))}
    </div>
  </section>;
}

function Rulebook({ onConfirm }) {
  return <main className="rulebook-page"><div className="rulebook-glow one" /><div className="rulebook-glow two" /><section className="rulebook-card"><div className="rulebook-kicker"><span>⚽</span> FOOTYVERSE MATCHDAY</div><h1>How to play</h1><p className="rulebook-lead">A quick guide before the draft begins.</p><ul className="rule-list"><li><b>Draft</b><span>Take turns picking an 11-man starting XI.</span></li><li><b>Set your XI</b><span>Finish the draft, then both press Ready.</span></li><li><b>Pass</b><span>Pick a teammate. Defender predicts the pass to intercept.</span></li><li><b>5 passes = shot</b><span>Five clean passes unlock a goal chance.</span></li><li><b>Pick a corner</b><span>Shooter and keeper each pick a side. Stats move the odds.</span></li><li><b>7s per move</b><span>No choice in time? A random option is auto-picked.</span></li><li><b>Tie?</b><span>Sudden-death penalties decide the match.</span></li></ul><button className="rulebook-confirm" onClick={onConfirm}>I understand <span>→</span></button></section></main>;
}

export default function Draft({ room, onLeaveRoom }) {
  const { token } = useAuth();
  const [draft, setDraft] = useState({ turnId:null, round:0, category:null, picks:{}, complete:false });
  const [pack, setPack] = useState([]);
  const [opening, setOpening] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const [matchData, setMatchData] = useState(null);
  const [finished, setFinished] = useState(null);
  const [celebration, setCelebration] = useState(null);
  const [rulesAccepted, setRulesAccepted] = useState(false);
  const [myPositions, setMyPositions] = useState(() => emptyPositions(DEFAULT_FORMATION));
  const [clubData, setClubData] = useState(null);
  const [clubError, setClubError] = useState("");
  const [opponentClub, setOpponentClub] = useState(null);
  const [opponentClubError, setOpponentClubError] = useState("");
  const [rematchRequested, setRematchRequested] = useState(false);
  const [rematchCount, setRematchCount] = useState(0);
  const [opponentLeft, setOpponentLeft] = useState(false);
  const me = room.players.find((player) => player.id === socket.id);
  const turnPlayer = room.players.find((player) => player.id === draft.turnId);
  const myPicks = draft.picks[socket.id] || EMPTY_PLAYERS;
  const opponent = room.players.find((player) => player.id !== socket.id);
  const opponentPicks = draft.picks[opponent?.id] || [];
  const myFormationKey = draft.formations?.[socket.id] || DEFAULT_FORMATION;
  const myFormation = formationForKey(myFormationKey);
  const opponentChosenFormation = draft.formations?.[opponent?.id];
  const opponentFormationKey = opponentChosenFormation || DEFAULT_FORMATION;
  const opponentFormation = formationForKey(opponentFormationKey);
  const positions = myPositions;
  const overall = useMemo(() => {
    const xi = Object.values(positions).filter(Boolean);
    return xi.length === 11 ? Number((xi.reduce((sum, player) => sum + player.rating, 0) / 11).toFixed(1)) : 0;
  }, [positions]);
  const opponentPositions = useMemo(() => buildXI(opponentPicks, opponentFormation), [opponentPicks, opponentFormation]);
  const opponentOverall = useMemo(() => {
    const xi = Object.values(opponentPositions).filter(Boolean);
    return xi.length === 11 ? Number((xi.reduce((sum, player) => sum + player.rating, 0) / 11).toFixed(1)) : 0;
  }, [opponentPositions]);

  useEffect(() => {
    const onDraft = (data) => { setDraft(data); setPack([]); setOpening(false); };
    const onPack = ({ pack }) => { setOpening(true); setTimeout(() => setPack(pack), 450); };
    const onReady = setReadyCount;
    const onMatch = (data) => setMatchData(data);
    const onFinished = (data) => { setCelebration(data); setTimeout(() => { setFinished(data); setCelebration(null); }, 2600); };
    const onRematchRequested = ({ count }) => setRematchCount(count);
    const onRematchConfirmed = () => {
      setDraft({ turnId:null, round:0, category:null, picks:{}, complete:false });
      setPack([]); setOpening(false); setWaiting(false); setReadyCount(0);
      setMatchData(null); setFinished(null); setCelebration(null);
      setRulesAccepted(false); setMyPositions(emptyPositions(DEFAULT_FORMATION));
      setRematchRequested(false); setRematchCount(0);
      setTimeout(() => socket.emit("getDraftState", { roomCode: room.roomCode }), 100);
    };
    const onOpponentLeft = () => setOpponentLeft(true);
    const onError = (message) => { setWaiting(false); alert(message); };
    socket.on("draftState", onDraft); socket.on("draftPack", onPack); socket.on("readyCount", onReady);
    socket.on("enterMatch", onMatch); socket.on("matchFinished", onFinished);
    socket.on("rematchRequested", onRematchRequested); socket.on("rematchConfirmed", onRematchConfirmed);
    socket.on("opponentLeft", onOpponentLeft); socket.on("errorMessage", onError);
    return () => { socket.off("draftState", onDraft); socket.off("draftPack", onPack); socket.off("readyCount", onReady); socket.off("enterMatch", onMatch); socket.off("matchFinished", onFinished); socket.off("rematchRequested", onRematchRequested); socket.off("rematchConfirmed", onRematchConfirmed); socket.off("opponentLeft", onOpponentLeft); socket.off("errorMessage", onError); };
  }, []);

  useEffect(() => { socket.emit("getDraftState", { roomCode: room.roomCode }); }, [room.roomCode]);

  useEffect(() => {
    if (room.mode !== "club") return;
    let active = true;
    api.team(token)
      .then((team) => {
        if (!active) return;
        const positions = emptyPositions(DEFAULT_FORMATION);
        (team.squad || []).forEach((row) => {
          if (row.slot && positions[row.slot] !== undefined) positions[row.slot] = row;
        });
        setClubData({ positions });
        const filled = Object.values(positions).filter(Boolean);
        if (filled.length !== 11) setClubError("Set your starting XI (11 players) in My Team before playing.");
        else setClubError("");
      })
      .catch((err) => { if (active) setClubError(err.message); });
    return () => { active = false; };
  }, [token, room.mode]);

  useEffect(() => {
    if (room.mode !== "club") return;
    if (!opponent?.userId) return;
    let active = true;
    setOpponentClub(null);
    setOpponentClubError("");
    api.teamPublic(token, opponent.userId)
      .then((team) => { if (active) setOpponentClub(team); })
      .catch((err) => { if (active) setOpponentClubError(err.message); });
    return () => { active = false; };
  }, [token, room.mode, opponent?.userId]);

  useEffect(() => {
    if (rulesAccepted && draft.turnId === socket.id && !draft.complete && draft.formations?.[socket.id]) socket.emit("requestDraftPack", { roomCode: room.roomCode });
  }, [draft.turnId, draft.round, draft.complete, draft.formations?.[socket.id], room.roomCode, rulesAccepted]);

  useEffect(() => { setMyPositions((current) => syncLineup(current, myPicks, myFormation)); }, [myPicks, myFormation]);

  if (celebration && !finished) {
    const shootout = celebration.shootout;
    const score = (id) => shootout?.kicks?.[id]?.filter(Boolean).length || 0;
    const winner = shootout ? room.players[score(room.players[0].id) > score(room.players[1].id) ? 0 : 1]?.name : room.players[celebration.scoreA > celebration.scoreB ? 0 : 1]?.name;
    return <main className="winner-celebration"><div className="fireworks">{Array.from({ length:18 }, (_, index) => <i key={index} style={{ "--spark":index }} />)}</div><motion.div initial={{ scale:.4, opacity:0 }} animate={{ scale:1, opacity:1 }} className="winner-announcement"><span>🏆</span><small>FULL TIME</small><h1>{winner} wins!</h1><p>{shootout ? "Penalty shootout secured" : "The final whistle blows"}</p></motion.div></main>;
  }
  if (opponentLeft) {
    return <div className="fulltime"><motion.div initial={{ scale:.5, opacity:0 }} animate={{ scale:1, opacity:1 }} className="fulltime-card final-scoreboard"><div className="trophy">👋</div><p>OPPONENT LEFT</p><h1>Your opponent left the match</h1><h2>Return to the lobby to create or join a new room.</h2><button className="primary-btn" onClick={() => { localStorage.removeItem(`footyverse-room-${room.roomCode}`); window.history.replaceState({}, "", window.location.pathname); onLeaveRoom(); }}>Back to lobby</button></motion.div></div>;
  }
  if (finished) {
    const shootout = finished.shootout;
    const penaltyScore = (id) => shootout?.kicks?.[id]?.filter(Boolean).length || 0;
    const shootoutWinnerId = shootout && penaltyScore(room.players[0].id) !== penaltyScore(room.players[1].id) ? (penaltyScore(room.players[0].id) > penaltyScore(room.players[1].id) ? room.players[0].id : room.players[1].id) : null;
    const winner = shootoutWinnerId ? `${room.players.find((player) => player.id === shootoutWinnerId)?.name} wins on penalties (${penaltyScore(room.players[0].id)}–${penaltyScore(room.players[1].id)})` : finished.scoreA === finished.scoreB ? "Draw" : room.players[finished.scoreA > finished.scoreB ? 0 : 1]?.name;
    const rows = room.players.map((player) => ({ player, ...(finished.stats?.[player.id] || { passes:0, interceptions:0, goals:[] }) }));
    const mvp = [...rows].sort((a,b) => (b.goals.length * 5 + b.passes + b.interceptions * 2) - (a.goals.length * 5 + a.passes + a.interceptions * 2))[0];
    return <div className="fulltime"><motion.div initial={{ scale:.5, opacity:0 }} animate={{ scale:1, opacity:1 }} className="fulltime-card final-scoreboard"><div className="trophy">🏆</div><p>FULL TIME</p><h1>{finished.scoreA} <span>–</span> {finished.scoreB}</h1><h2>{winner === "Draw" ? "It ends level" : `${winner} wins the match!`}</h2><div className="mvp-card"><small>MATCH MVP</small><b>{mvp?.goals?.[0] || mvp?.player.name}</b><span>{mvp?.goals?.length || 0} goal{mvp?.goals?.length === 1 ? "" : "s"} · {mvp?.passes || 0} passes</span></div><div className="stats-table">{rows.map((row) => <div key={row.player.id}><b>{row.player.name}</b><span>{row.passes} passes</span><span>{row.interceptions} interceptions</span><span>{row.goals.length ? row.goals.join(", ") : "No goals"}</span></div>)}</div>{me?.userId && finished.rewards?.[me.userId] && <div className={`reward-box ${finished.rewards[me.userId].outcome}`}><small>REWARDS EARNED</small><b>+{finished.rewards[me.userId].coins} 🪙 · +{finished.rewards[me.userId].xp} XP</b>{finished.rewards[me.userId].leveledUp && <span className="reward-level">LEVEL UP! +{finished.rewards[me.userId].bonusCoins} 🪙 bonus</span>}</div>}<div className="post-match-actions">{rematchCount > 0 && !rematchRequested && <p className="rematch-hint">Your opponent wants a rematch!</p>}{rematchRequested ? <button className="primary-btn" disabled>Waiting for opponent · {rematchCount}/2</button> : <button className="primary-btn" onClick={() => { setRematchRequested(true); socket.emit("requestRematch", { roomCode:room.roomCode }); }}>Play again</button>}<button className="secondary-btn" onClick={() => { socket.emit("leaveRoom", { roomCode:room.roomCode }); localStorage.removeItem(`footyverse-room-${room.roomCode}`); window.history.replaceState({}, "", window.location.pathname); onLeaveRoom(); }}>Make another room</button></div></motion.div></div>;
  }
  if (matchData) return <Match room={{ ...room, teams:matchData.teams }} initialData={matchData} />;
  if (room.ai) {
    return <main className="draft-page"><header className="draft-header"><div><span className="eyebrow">VS CPU</span><h1>{room.players[0]?.name} <b>vs</b> {room.players[1]?.name}</h1></div><div className="draft-progress"><strong>{String(room.ai.difficulty || "AI").toUpperCase()}</strong><span>CPU opponent</span></div></header><section className="team-ready"><div className="team-review-head"><span className="eyebrow">MATCHDAY</span><h2>Preparing kick-off…</h2><div className="spinner" /></div></section></main>;
  }
  if (room.mode === "club") {
    if (!clubData) {
      return <main className="draft-page"><header className="draft-header"><div><span className="eyebrow">MY TEAM MATCH</span><h1>{room.players[0]?.name} <b>vs</b> {room.players[1]?.name}</h1></div></header><section className="team-ready"><div className="team-review-head"><span className="eyebrow">OWN SQUADS</span><h2>Loading your squad…</h2><div className="spinner" /></div></section></main>;
    }
    const clubPositions = clubData.positions;
    const clubXi = Object.values(clubPositions).filter(Boolean);
    const clubOverall = clubXi.length === 11 ? Number((clubXi.reduce((sum, player) => sum + effectiveRating(player.rating, player.category, slotCategory[player.slot]), 0) / 11).toFixed(1)) : 0;
    const oppPositions = emptyPositions(DEFAULT_FORMATION);
    (opponentClub?.squad || []).forEach((row) => { if (row.slot && oppPositions[row.slot] !== undefined) oppPositions[row.slot] = row; });
    const oppXi = Object.values(oppPositions).filter(Boolean);
    const oppOverall = oppXi.length === 11 ? Number((oppXi.reduce((sum, player) => sum + effectiveRating(player.rating, player.category, slotCategory[player.slot]), 0) / 11).toFixed(1)) : 0;
    const readyClub = () => { setWaiting(true); socket.emit("playerReady", { roomCode: room.roomCode }); };
    return <main className="draft-page">
      <header className="draft-header"><div><span className="eyebrow">MY TEAM MATCH</span><h1>{room.players[0]?.name} <b>vs</b> {room.players[1]?.name}</h1></div><div className="draft-progress"><strong>CLUB</strong><span>own squad battle</span></div></header>
      <section className="team-ready"><div className="team-review-head"><span className="eyebrow">OWN SQUADS</span><h2>Your XI is set</h2><p>You both play with the squad saved in your club. Tweak it anytime from My Team on the hub — press Ready when you're set.</p></div>
        <div className="team-review-squads">
          <div className="team-review-team"><h3>{me?.name}<small>Your team</small></h3><SquadBoard positions={clubPositions} overall={clubOverall} readOnly /></div>
          <div className="team-review-team"><h3>{opponent?.name}<small>Opponent team</small></h3>
            {opponentClubError ? <div className="opponent-waiting"><i>🛡️</i><p>Couldn't load their squad.</p></div>
              : !opponentClub ? <div className="opponent-waiting"><i>🛡️</i><p>Loading their squad…</p></div>
                : oppXi.length === 0 ? <div className="opponent-waiting"><i>🛡️</i><p>They haven't saved a starting XI yet.</p></div>
                  : <><SquadBoard positions={oppPositions} overall={oppOverall} readOnly />{oppXi.length < 11 && <p className="opponent-incomplete">Only {oppXi.length}/11 set — they'll need a full XI to kick off.</p>}</>}
          </div>
        </div>
        {clubError && <p className="auth-error">{clubError}</p>}
        {waiting ? <button className="primary-btn" disabled>Waiting for opponent · {readyCount}/2</button> : <button className="primary-btn" onClick={readyClub} disabled={Boolean(clubError)}>Ready for match</button>}
      </section>
    </main>;
  }
  if (!rulesAccepted) return <Rulebook onConfirm={() => setRulesAccepted(true)} />;

  const repositionPlayer = (fromSlot, toSlot) => {
    setMyPositions((current) => {
      const player = current[fromSlot], target = current[toSlot];
      if (!player || fromSlot === "GK" || toSlot === "GK" || myFormation.slotCategory[toSlot] !== player.position) return current;
      if (target && target.position !== player.position) return current;
      return { ...current, [fromSlot]:target || null, [toSlot]:player };
    });
  };
  const ready = () => { setWaiting(true); socket.emit("playerReady", { roomCode:room.roomCode, positions, overall }); };
  return <main className="draft-page">
    <header className="draft-header"><div><span className="eyebrow">LIVE DRAFT</span><h1>{room.players[0]?.name} <b>vs</b> {room.players[1]?.name}</h1></div><div className="draft-progress"><strong>{Math.min(draft.round + 1, TOTAL_ROUNDS)} / {TOTAL_ROUNDS}</strong><span>picks completed</span></div></header>
    {!draft.complete ? (draft.formations?.[socket.id] ? <>
      <section className={`turn-banner ${draft.turnId === socket.id ? "your-turn" : "opponent-turn"}`}>
        <span className="turn-dot" />
        <div><strong>{draft.turnId === socket.id ? "Your turn to choose" : `${turnPlayer?.name || "Opponent"} is choosing`}</strong><small>{label[draft.category]} • one legend leaves the pool forever</small></div>
      </section>
      <div className="draft-workspace"><section className="pick-stage">
        {opening && !pack.length && <LoadingOverlay message={`Opening ${label[draft.category]} pack…`} />}
        {pack.length > 0 && <AnimatedPack players={pack} onPick={(player) => socket.emit("draftPick", { roomCode:room.roomCode, player })} />}
        {draft.turnId !== socket.id && <div className="waiting-turn"><div className="spinner" /><h2>Watch the draft unfold</h2><p>{turnPlayer?.name} is selecting from {label[draft.category]?.toLowerCase()}.</p></div>}
      </section><aside className="draft-team"><h2>Your {myFormation.name} XI</h2><SquadBoard positions={positions} overall={overall} onReposition={repositionPlayer} formation={myFormationKey} /></aside></div>
    </> : <FormationPicker onPick={(formation) => socket.emit("chooseFormation", { roomCode:room.roomCode, formation })} opponentChosen={opponentChosenFormation} />) : <section className="team-ready"><div className="team-review-head"><span className="eyebrow">DRAFT COMPLETE</span><h2>Set your starting XI</h2><p>Tap a player, then an empty spot or a teammate in the same category to move or swap. Goalkeepers stay fixed.</p></div><div className="team-review-squads"><div className="team-review-team"><h3>{me?.name}<small>Your team</small></h3><SquadBoard positions={positions} overall={overall} readOnly={waiting} onReposition={repositionPlayer} formation={myFormationKey} /></div><div className="team-review-team"><h3>{opponent?.name}<small>Opponent team</small></h3><SquadBoard positions={opponentPositions} overall={opponentOverall} readOnly formation={opponentFormationKey} /></div></div>{waiting ? <button className="primary-btn" disabled>Waiting for opponent · {readyCount}/2</button> : <button className="primary-btn" onClick={ready}>Ready for match</button>}</section>}
  </main>;
}
