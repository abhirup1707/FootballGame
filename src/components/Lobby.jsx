import { useEffect, useRef, useState } from "react";
import socket from "../socket";
import { useAuth } from "../auth";

const sessionKey = (code) => `footyverse-room-${code}`;
const newToken = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
const DIFFICULTIES = [
  {
    key: "easy",
    name: "Rookie",
    icon: "🟢",
    rank: "#3ddc6a",
    stars: "★",
    desc: "A weak squad below yours.",
    you: 5,
    cpu: 3,
  },
  {
    key: "medium",
    name: "Contender",
    icon: "🟡",
    rank: "#ffd24a",
    stars: "★★",
    desc: "An evenly matched squad.",
    you: 3,
    cpu: 3,
  },
  {
    key: "hard",
    name: "Elite",
    icon: "🟠",
    rank: "#ff8a3c",
    stars: "★★★",
    desc: "A stronger squad above yours.",
    you: 5,
    cpu: 5,
  },
  {
    key: "extreme",
    name: "Legend",
    icon: "🔴",
    rank: "#ff4d5e",
    stars: "★★★★",
    desc: "The strongest squad possible.",
    you: 3,
    cpu: 5,
  },
];

export default function Lobby({ setRoom, onBack }) {
  const initialCode =
    new URLSearchParams(window.location.search).get("room")?.toUpperCase() ||
    "";
  const savedSession = initialCode
    ? JSON.parse(localStorage.getItem(sessionKey(initialCode)) || "null")
    : null;
  const sessionRef = useRef(savedSession);
  const { user } = useAuth();
  const [playerName] = useState(
    savedSession?.playerName || user?.username || "",
  );
  const [roomCode, setRoomCode] = useState(initialCode);
  const [status, setStatus] = useState("");
  const [players, setPlayers] = useState([]);
  const [matchMode, setMatchMode] = useState("goals");
  const [mode, setMode] = useState("draft");
  const [goalLimit, setGoalLimit] = useState(3);
  const [timeLimit, setTimeLimit] = useState(90);
  const [gameMode, setGameMode] = useState("ai");
  const [difficulty, setDifficulty] = useState("easy");
  const [isRoomOwner, setIsRoomOwner] = useState(
    Boolean(savedSession && initialCode),
  );
  const ownerWaiting = isRoomOwner && Boolean(roomCode);
  const joiningFromInvite = Boolean(initialCode) && !ownerWaiting;
  const inviteLink = roomCode
    ? `${window.location.origin}${window.location.pathname}?room=${roomCode}`
    : "";
  const saveSession = (code, name) => {
    const session = {
      playerName: name,
      resumeToken: sessionRef.current?.resumeToken || newToken(),
    };
    sessionRef.current = session;
    localStorage.setItem(sessionKey(code), JSON.stringify(session));
  };
  const opponent = DIFFICULTIES.find((level) => level.key === difficulty);

  const createRoom = () => {
    if (!playerName.trim()) return alert("Enter your manager name first");
    sessionRef.current = {
      playerName: playerName.trim(),
      resumeToken: newToken(),
    };
    socket.emit("createRoom", {
      playerName: playerName.trim(),
      mode,
      matchMode,
      goalLimit,
      timeLimit,
      resumeToken: sessionRef.current.resumeToken,
    });
  };
  const joinRoom = () => {
    if (!playerName.trim() || !roomCode.trim())
      return alert("Enter your manager name and room code");
    if (!sessionRef.current)
      sessionRef.current = {
        playerName: playerName.trim(),
        resumeToken: newToken(),
      };
    socket.emit("joinRoom", {
      roomCode: roomCode.trim(),
      playerName: playerName.trim(),
      resumeToken: sessionRef.current.resumeToken,
    });
  };
  const startAiMatch = () => {
    setStatus("Preparing your CPU opponent…");
    socket.emit("createAiMatch", {
      playerName: user?.username || "You",
      difficulty,
      matchMode,
      goalLimit,
      timeLimit,
    });
  };
  const shareRoom = async () => {
    if (!inviteLink) return;
    try {
      if (navigator.share)
        await navigator.share({
          title: "Footyverse",
          text: "Join my Footyverse match",
          url: inviteLink,
        });
      else {
        await navigator.clipboard.writeText(inviteLink);
        setStatus("Invite link copied — send it to your opponent.");
      }
    } catch {
      /* Share sheet dismissed. */
    }
  };

  useEffect(() => {
    const created = (code) => {
      setRoomCode(code);
      setIsRoomOwner(true);
      saveSession(code, playerName.trim());
      setStatus("Room created — share the match link with your opponent.");
    };
    const ready = (room) => {
      saveSession(room.roomCode, playerName.trim());
      setPlayers(room.players);
      setStatus(
        room.ai
          ? `CPU ready — ${room.players[1]?.name} awaits.`
          : "Opponent connected — preparing matchday.",
      );
      setTimeout(() => setRoom(room), 750);
    };
    socket.on("roomCreated", created);
    socket.on("roomReady", ready);
    socket.on("errorMessage", alert);
    return () => {
      socket.off("roomCreated", created);
      socket.off("roomReady", ready);
      socket.off("errorMessage", alert);
    };
  }, [playerName, setRoom]);

  const formatBlock = () => (
    <>
      <div className="g-panel-head">
        <span>📜</span>
        <div>
          <small>MATCH FORMAT</small>
          <h3>Set the rules</h3>
        </div>
      </div>
      <div className="g-format">
        <button
          className={matchMode === "goals" ? "active" : ""}
          onClick={() => setMatchMode("goals")}
        >
          <i>🎯</i>
          <div>
            <b>First to</b>
            <strong>
              {goalLimit} goal{goalLimit > 1 ? "s" : ""}
            </strong>
          </div>
        </button>
        <button
          className={matchMode === "time" ? "active" : ""}
          onClick={() => setMatchMode("time")}
        >
          <i>⏱️</i>
          <div>
            <b>Play for</b>
            <strong>{timeLimit}s</strong>
          </div>
        </button>
      </div>
      <div className="g-values">
        {matchMode === "goals" ? (
          <div className="g-chip-row">
            <small>TARGET</small>
            {[1, 3, 5].map((value) => (
              <button
                key={value}
                className={goalLimit === value ? "active" : ""}
                onClick={() => setGoalLimit(value)}
              >
                {value}
              </button>
            ))}
          </div>
        ) : (
          <div className="g-chip-row">
            <small>TIME</small>
            {[90, 120, 150, 180].map((value) => (
              <button
                key={value}
                className={timeLimit === value ? "active" : ""}
                onClick={() => setTimeLimit(value)}
              >
                {value}s
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );

  return (
    <main className="lobby-bg">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <section className="lobby-shell">
        <div className="lobby-intro">
          <div className="lobby-topbar">
            <button
              className="icon-btn"
              onClick={onBack}
              aria-label="Back to hub"
            >
              ←
            </button>
            <span className="lobby-manager">MANAGER · {user?.username}</span>
          </div>
          <div className="brand-mark">
            <span>⚽</span>
            <b>FOOTYVERSE</b>
          </div>
          <span className="eyebrow">ONLINE 1V1 · LIVE DRAFT FOOTBALL</span>
          <h1>
            {joiningFromInvite ? (
              <>
                A rival
                <br />
                <em>awaits you.</em>
              </>
            ) : gameMode === "ai" ? (
              <>
                Beat the
                <br />
                <em>{opponent?.name}.</em>
              </>
            ) : (
              <>
                Draft legends.
                <br />
                <em>Own the moment.</em>
              </>
            )}
          </h1>
          <p>
            {joiningFromInvite
              ? "Enter your manager name and join the room. Your opponent is waiting for kick-off."
              : gameMode === "ai"
                ? "Take on the CPU with your club XI. Pick a difficulty, set the rules, and kick off."
                : "Build a unique XI, outthink your opponent, and turn every pass into a match-winning move."}
          </p>
          <div className="feature-row">
            <span>
              <i>11</i> player XI
            </span>
            <span>
              <i>1v1</i> live tactics
            </span>
            <span>
              <i>⚽</i> mind-game duels
            </span>
          </div>
          <div className="lobby-scout">
            <div className="scout-ball">⚽</div>
            <div>
              <small>
                {joiningFromInvite
                  ? "PRIVATE MATCH INVITE"
                  : gameMode === "ai"
                    ? "SOLO MATCHDAY"
                    : "MATCHDAY READY"}
              </small>
              <b>
                {joiningFromInvite
                  ? "Join the squad selection."
                  : gameMode === "ai"
                    ? `You vs CPU · ${opponent?.name}.`
                    : "Pick. Predict. Prevail."}
              </b>
            </div>
            <span>{gameMode === "ai" ? "CPU" : "LIVE"}</span>
          </div>
        </div>
        <div className="lobby-card game-console">
          <span className="g-brackets" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          {ownerWaiting ? (
            <>
              <div className="g-console-head">
                <span className="g-console-icon">⚽</span>
                <div>
                  <small>ROOM CREATED</small>
                  <h2>Your match is ready</h2>
                </div>
                <i className="g-live-dot">● WAITING</i>
              </div>
              <div className="g-room-code">
                <small>ROOM CODE</small>
                <code>{roomCode}</code>
              </div>
              <div className="g-invite">
                <small>SHARE THIS MATCH LINK</small>
                <code>{inviteLink}</code>
                <button className="g-share" onClick={shareRoom}>
                  Share invite <span>↗</span>
                </button>
              </div>
              <div className="g-wait">
                <i />
                Waiting for your opponent to join…
              </div>
            </>
          ) : joiningFromInvite ? (
            <>
              <div className="g-console-head">
                <span className="g-console-icon">📡</span>
                <div>
                  <small>MATCH INVITE</small>
                  <h2>Join the arena</h2>
                </div>
                <i className="g-live-dot">● LIVE</i>
              </div>
              <p className="g-hint">
                You were invited to a private match. Ready to step on the
                pitch?
              </p>
              <button className="g-cta" onClick={joinRoom}>
                <span>JOIN ROOM</span>
                <em>Enter the match</em>
              </button>
            </>
          ) : (
            <>
              <div className="g-console-head">
                <span className="g-console-icon">
                  {gameMode === "ai" ? "🤖" : "👥"}
                </span>
                <div>
                  <small>MATCH SETUP</small>
                  <h2>
                    {gameMode === "ai"
                      ? "Choose your challenge"
                      : "Set up a battle"}
                  </h2>
                </div>
                <i className="g-live-dot">● LIVE</i>
              </div>
              <div className="g-mode-select">
                <button
                  className={`g-mode-tab ${gameMode === "ai" ? "active" : ""}`}
                  onClick={() => setGameMode("ai")}
                >
                  <i>🤖</i>
                  <div>
                    <b>Vs AI</b>
                    <small>Quick solo matchday</small>
                  </div>
                  <em>{gameMode === "ai" ? "✓" : ""}</em>
                </button>
                <button
                  className={`g-mode-tab ${gameMode === "friends" ? "active" : ""}`}
                  onClick={() => setGameMode("friends")}
                >
                  <i>👥</i>
                  <div>
                    <b>Vs Friends</b>
                    <small>Room code + invite</small>
                  </div>
                  <em>{gameMode === "friends" ? "✓" : ""}</em>
                </button>
              </div>
              {gameMode === "ai" ? (
                <div className="g-setup">
                  <div className="g-panel-head">
                    <span>🕹️</span>
                    <div>
                      <small>SELECT DIFFICULTY</small>
                      <h3>Choose your opponent</h3>
                    </div>
                  </div>
                  <div className="g-difficulty-list">
                    {DIFFICULTIES.map((level) => (
                      <button
                        key={level.key}
                        className={`g-difficulty ${difficulty === level.key ? "active" : ""}`}
                        style={{ "--rank": level.rank }}
                        onClick={() => setDifficulty(level.key)}
                      >
                        <i className="g-diff-badge">{level.icon}</i>
                        <div className="g-diff-info">
                          <b>{level.name}</b>
                          <small className="g-diff-stars">{level.stars}</small>
                          <span>{level.desc}</span>
                        </div>
                        <div className="g-diff-pass">
                          <div>
                            <small>YOU</small>
                            <b>{level.you}</b>
                          </div>
                          <i>vs</i>
                          <div>
                            <small>CPU</small>
                            <b>{level.cpu}</b>
                          </div>
                        </div>
                        <em className="g-diff-check">✓</em>
                      </button>
                    ))}
                  </div>
                  {formatBlock()}
                  <p className="g-hint">
                    🛡️ You play with the 11 players saved in your My Team
                    squad.
                  </p>
                  <button className="g-cta" onClick={startAiMatch}>
                    <span>KICK OFF</span>
                    <em>vs {opponent?.name}</em>
                  </button>
                </div>
              ) : (
                <div className="g-setup">
                  <div className="g-panel-head">
                    <span>🛠️</span>
                    <div>
                      <small>ROOM TYPE</small>
                      <h3>How do you want to play?</h3>
                    </div>
                  </div>
                  <div className="g-room-mode">
                    <button
                      className={mode === "draft" ? "active" : ""}
                      onClick={() => setMode("draft")}
                    >
                      <i>⚡</i>
                      <div>
                        <b>Manual Draft</b>
                        <small>Pick a fresh squad live</small>
                      </div>
                    </button>
                    <button
                      className={mode === "club" ? "active" : ""}
                      onClick={() => setMode("club")}
                    >
                      <i>🛡️</i>
                      <div>
                        <b>My Team</b>
                        <small>Both use their saved XI</small>
                      </div>
                    </button>
                  </div>
                  {formatBlock()}
                  <button className="g-cta" onClick={createRoom}>
                    <span>CREATE ROOM</span>
                    <em>+ share the code</em>
                  </button>
                  <div className="g-or">
                    <span>OR JOIN A FRIEND</span>
                  </div>
                  <div className="g-join">
                    <input
                      className="g-code-input"
                      placeholder="ENTER 6-LETTER ROOM CODE"
                      value={roomCode}
                      maxLength={6}
                      onChange={(event) =>
                        setRoomCode(event.target.value.toUpperCase())
                      }
                    />
                    <button className="g-join-btn" onClick={joinRoom}>
                      JOIN ARENA <span>→</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          {status && <div className="status-box">{status}</div>}
          {players.length > 0 && (
            <div className="players-box">
              {players.map((player) => (
                <span key={player.id}>✓ {player.name}</span>
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
