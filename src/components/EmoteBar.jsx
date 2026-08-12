import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import socket from "../socket";

export const MATCH_EMOTES = [
  { key: "GG", icon: "🤝", label: "GG" },
  { key: "LAUGH", icon: "😂", label: "LAUGH" },
  { key: "CRY", icon: "😭", label: "CRY" },
  { key: "ANGRY", icon: "😡", label: "ANGRY" },
  { key: "SHUSH", icon: "🤫", label: "SHUSH" },
];

const emoteMap = Object.fromEntries(MATCH_EMOTES.map((emote) => [emote.key, emote]));

export default function EmoteBar({ roomCode }) {
  const [incoming, setIncoming] = useState(null);
  const [cooling, setCooling] = useState(false);
  const timer = useRef(null);

  useEffect(() => {
    const onEmote = (next) => {
      setIncoming({ ...next, at: Date.now() });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setIncoming(null), 2400);
    };
    socket.on("opponentEmote", onEmote);
    return () => {
      socket.off("opponentEmote", onEmote);
      clearTimeout(timer.current);
    };
  }, []);

  const send = (key) => {
    if (cooling) return;
    setCooling(true);
    setTimeout(() => setCooling(false), 1200);
    socket.emit("sendEmote", { roomCode, emote: key });
  };

  return (
    <>
      {incoming && (
        <motion.div
          key={`${incoming.emote}-${incoming.at}`}
          className="emote-pop"
          initial={{ opacity: 0, scale: 0.3, x: "-50%", y: 24 }}
          animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
          transition={{ type: "spring", stiffness: 220, damping: 14 }}
        >
          <span>{emoteMap[incoming.emote]?.icon || "😀"}</span>
          <small>{incoming.name}{emoteMap[incoming.emote] ? ` · ${emoteMap[incoming.emote].label}` : ""}</small>
        </motion.div>
      )}
      <div className="emote-bar">
        {MATCH_EMOTES.map((emote) => (
          <button
            key={emote.key}
            className={`emote-btn ${cooling ? "cooling" : ""}`}
            onClick={() => send(emote.key)}
            title={emote.label}
          >
            <span>{emote.icon}</span>
            <small>{emote.label}</small>
          </button>
        ))}
      </div>
    </>
  );
}
