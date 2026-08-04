import { useEffect, useRef, useState } from "react";
import socket from "../socket";

const sessionKey = (code) => `footyverse-room-${code}`;
const newToken = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export default function Lobby({ setRoom }) {
  const initialCode = new URLSearchParams(window.location.search).get("room")?.toUpperCase() || "";
  const savedSession = initialCode ? JSON.parse(localStorage.getItem(sessionKey(initialCode)) || "null") : null;
  const sessionRef = useRef(savedSession);
  const [playerName, setPlayerName] = useState(savedSession?.playerName || "");
  const [roomCode, setRoomCode] = useState(initialCode);
  const [status, setStatus] = useState("");
  const [players, setPlayers] = useState([]);
  const [matchMode, setMatchMode] = useState("goals");
  const [goalLimit, setGoalLimit] = useState(3);
  const [timeLimit, setTimeLimit] = useState(90);
  const [isRoomOwner, setIsRoomOwner] = useState(Boolean(savedSession && initialCode));
  const ownerWaiting = isRoomOwner && Boolean(roomCode);
  const joiningFromInvite = Boolean(initialCode) && !ownerWaiting;
  const inviteLink = roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";
  const saveSession = (code, name) => { const session = { playerName:name, resumeToken:sessionRef.current?.resumeToken || newToken() }; sessionRef.current = session; localStorage.setItem(sessionKey(code), JSON.stringify(session)); };

  const createRoom = () => { if (!playerName.trim()) return alert("Enter your manager name first"); sessionRef.current = { playerName:playerName.trim(), resumeToken:newToken() }; socket.emit("createRoom", { playerName:playerName.trim(), matchMode, goalLimit, timeLimit, resumeToken:sessionRef.current.resumeToken }); };
  const joinRoom = () => { if (!playerName.trim() || !roomCode.trim()) return alert("Enter your manager name and room code"); if (!sessionRef.current) sessionRef.current = { playerName:playerName.trim(), resumeToken:newToken() }; socket.emit("joinRoom", { roomCode:roomCode.trim(), playerName:playerName.trim(), resumeToken:sessionRef.current.resumeToken }); };
  const shareRoom = async () => { if (!inviteLink) return; try { if (navigator.share) await navigator.share({ title:"Footyverse", text:"Join my Footyverse match", url:inviteLink }); else { await navigator.clipboard.writeText(inviteLink); setStatus("Invite link copied — send it to your opponent."); } } catch { /* Share sheet dismissed. */ } };

  useEffect(() => {
    const created = (code) => { setRoomCode(code); setIsRoomOwner(true); saveSession(code, playerName.trim()); setStatus("Room created — share the match link with your opponent."); };
    const ready = (room) => { saveSession(room.roomCode, playerName.trim()); setPlayers(room.players); setStatus("Opponent connected — preparing matchday."); setTimeout(() => setRoom(room), 750); };
    socket.on("roomCreated", created); socket.on("roomReady", ready); socket.on("errorMessage", alert);
    return () => { socket.off("roomCreated", created); socket.off("roomReady", ready); socket.off("errorMessage", alert); };
  }, [playerName, setRoom]);

  return <main className="lobby-bg"><div className="lobby-orb orb-one" /><div className="lobby-orb orb-two" /><div className="lobby-noise" /><section className="lobby-shell"><div className="lobby-intro"><div className="brand-mark"><span>⚽</span><b>FOOTYVERSE</b></div><span className="eyebrow">ONLINE 1V1 • LIVE DRAFT FOOTBALL</span><h1>{joiningFromInvite ? <>A rival<br /><em>awaits you.</em></> : <>Draft legends.<br /><em>Own the moment.</em></>}</h1><p>{joiningFromInvite ? "Enter your manager name and join the room. Your opponent is waiting for kick-off." : "Build a unique XI, outthink your opponent, and turn every pass into a match-winning move."}</p><div className="feature-row"><span><i>11</i> unique picks</span><span><i>3</i> passing lanes</span><span><i>1v1</i> live tactics</span></div><div className="lobby-scout"><div className="scout-ball">⚽</div><div><small>{joiningFromInvite ? "PRIVATE MATCH INVITE" : "MATCHDAY READY"}</small><b>{joiningFromInvite ? "Join the squad selection." : "Pick. Predict. Prevail."}</b></div><span>LIVE</span></div></div><div className="lobby-card">{ownerWaiting ? <><div className="lobby-card-head"><span>⚽</span><div><small>ROOM CREATED</small><h2>Your match is ready</h2></div><i className="card-spark">✦</i></div><div className="room-code-card"><small>YOUR MATCH CODE</small><code>{roomCode}</code></div><div className="invite-card"><small>SHARE THIS MATCH LINK</small><code>{inviteLink}</code><button className="share-btn" onClick={shareRoom}>Share invite <span>↗</span></button></div><div className="status-box">Waiting for your opponent to join.</div></> : <><div className="lobby-card-head"><span>⚽</span><div><small>{joiningFromInvite ? "MATCH INVITE" : "CREATE OR JOIN"}</small><h2>{joiningFromInvite ? "Join the arena" : "Enter the arena"}</h2></div><i className="card-spark">✦</i></div><label>Your manager name</label><input className="hero-input" value={playerName} onChange={(event) => setPlayerName(event.target.value)} />{joiningFromInvite ? <button className="join-btn" onClick={joinRoom}>Join room</button> : <><label>Match type</label><select className="hero-input" value={matchMode} onChange={(event) => setMatchMode(event.target.value)}><option value="goals">First to goals</option><option value="time">Play for time</option></select><div className="match-selects"><label>First to goals<select className="hero-input" value={goalLimit} disabled={matchMode !== "goals"} onChange={(event) => setGoalLimit(Number(event.target.value))}>{[1,3,5].map((value) => <option key={value} value={value}>{value} goal{value > 1 ? "s" : ""}</option>)}</select></label><label>Play for seconds<select className="hero-input" value={timeLimit} disabled={matchMode !== "time"} onChange={(event) => setTimeLimit(Number(event.target.value))}>{[90,120,150,180].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label></div><button className="hero-btn" onClick={createRoom}>Create match <span>→</span></button><div className="divider"><span>OR JOIN A FRIEND</span></div><input className="hero-input" placeholder="Six-letter room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /><button className="join-btn" onClick={joinRoom}>Join room</button></>}{status && <div className="status-box">{status}</div>}{players.length > 0 && <div className="players-box">{players.map((player) => <span key={player.id}>✓ {player.name}</span>)}</div>}</>}</div></section></main>;
}
