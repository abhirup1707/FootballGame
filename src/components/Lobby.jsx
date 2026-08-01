import { useEffect, useState } from "react";
import socket from "../socket";

export default function Lobby({ setRoom }) {
  const [playerName, setPlayerName] = useState("");
  const [roomCode, setRoomCode] = useState(() => new URLSearchParams(window.location.search).get("room")?.toUpperCase() || "");
  const [status, setStatus] = useState("");
  const [players, setPlayers] = useState([]);
  const [matchMode, setMatchMode] = useState("goals");
  const [goalLimit, setGoalLimit] = useState(3);
  const [timeLimit, setTimeLimit] = useState(90);
  const inviteLink = roomCode ? `${window.location.origin}${window.location.pathname}?room=${roomCode}` : "";

  const createRoom = () => { if (!playerName.trim()) return alert("Enter your name first"); socket.emit("createRoom", { playerName, matchMode, goalLimit, timeLimit }); };
  const joinRoom = () => { if (!playerName.trim() || !roomCode.trim()) return alert("Enter your name and room code"); socket.emit("joinRoom", { roomCode, playerName }); };
  const shareRoom = async () => { if (!inviteLink) return; try { if (navigator.share) await navigator.share({ title:"Football Draft", text:"Join my Football Draft room", url:inviteLink }); else { await navigator.clipboard.writeText(inviteLink); setStatus("Invite link copied - send it to your opponent."); } } catch { /* dismissed */ } };

  useEffect(() => {
    const created = (code) => { setRoomCode(code); window.history.replaceState({}, "", `?room=${code}`); setStatus("Room created - share the invite link with your opponent."); };
    const ready = (room) => { setPlayers(room.players); setStatus("Opponent found - entering draft"); setTimeout(() => setRoom(room), 1000); };
    socket.on("roomCreated", created); socket.on("roomReady", ready); socket.on("errorMessage", alert);
    return () => { socket.off("roomCreated", created); socket.off("roomReady", ready); socket.off("errorMessage", alert); };
  }, [setRoom]);

  return <main className="lobby-bg"><section className="lobby-shell"><div className="lobby-intro"><span className="eyebrow">ONLINE 1V1 FOOTBALL DRAFT</span><h1>Build the XI.<br /><em>Own the pitch.</em></h1><p>Draft unique legends, read your opponent&apos;s passes, then find the winning corner.</p><div className="feature-row"><span>Expanded player pool</span><span>5-pass attacks</span><span>OVR battles</span></div></div><div className="lobby-card"><div className="lobby-card-head"><span>⚽</span><div><small>READY TO PLAY?</small><h2>Start a match</h2></div></div><label>Your manager name</label><input className="hero-input" value={playerName} onChange={(event) => setPlayerName(event.target.value)} /><label>Match type</label><select className="hero-input" value={matchMode} onChange={(event) => setMatchMode(event.target.value)}><option value="goals">First to goals</option><option value="time">Play for time</option></select><div className="match-selects"><label>First to goals<select className="hero-input" value={goalLimit} disabled={matchMode !== "goals"} onChange={(event) => setGoalLimit(Number(event.target.value))}>{[1,3,5].map((value) => <option key={value} value={value}>{value} goal{value > 1 ? "s" : ""}</option>)}</select></label><label>Play for seconds<select className="hero-input" value={timeLimit} disabled={matchMode !== "time"} onChange={(event) => setTimeLimit(Number(event.target.value))}>{[90,120,150,180].map((value) => <option key={value} value={value}>{value} seconds</option>)}</select></label></div><button className="hero-btn" onClick={createRoom}>Create room</button>{inviteLink && <div className="invite-card"><small>INVITE LINK</small><code>{inviteLink}</code><button className="share-btn" onClick={shareRoom}>Share room</button></div>}<div className="divider"><span>OR JOIN A FRIEND</span></div><input className="hero-input" placeholder="Six-letter room code" value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} /><button className="join-btn" onClick={joinRoom}>Join room</button>{status && <div className="status-box">{status}</div>}{players.length > 0 && <div className="players-box">{players.map((player) => <span key={player.id}>✓ {player.name}</span>)}</div>}</div></section></main>;
}
