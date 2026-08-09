import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import socket from "./socket";
import AuthGate from "./components/AuthGate";
import Hub from "./components/Hub";
import TeamScreen from "./components/TeamScreen";
import PackScreen from "./components/PackScreen";
import QuestScreen from "./components/QuestScreen";
import Leaderboard from "./components/Leaderboard";
import EventsScreen from "./components/EventsScreen";
import Lobby from "./components/Lobby";
import Draft from "./components/Draft";
import WelcomePopup from "./components/WelcomePopup";

function Shell() {
  const { user, checking, token, welcomeGift, dismissWelcomeGift, refreshUser } = useAuth();
  const [screen, setScreen] = useState("hub");
  const [room, setRoom] = useState(null);

  useEffect(() => {
    if (token) socket.emit("authSocket", { token });
  }, [token]);

  // The server is authoritative about who's in a room (socket ids change on
  // reconnect). Re-sync the room state whenever the server announces it so
  // turns and matches never point at a stale player id.
  useEffect(() => {
    const onReady = (next) => { if (next?.roomCode) setRoom(next); };
    socket.on("roomReady", onReady);
    return () => socket.off("roomReady", onReady);
  }, []);

  // Survive a full page reload mid-match: rejoin the room from the saved
  // session so the server remaps us to this fresh socket and we pick up the
  // draft/match state instead of being stuck on the hub.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("room")?.toUpperCase();
    if (!code) return;
    const session = JSON.parse(localStorage.getItem(`footyverse-room-${code}`) || "null");
    if (!session?.resumeToken) return;
    socket.emit("rejoinRoom", { roomCode: code, resumeToken: session.resumeToken });
  }, []);

  // AI rooms have no URL code, so rejoin from live room state on reconnects.
  useEffect(() => {
    const onReconnect = () => {
      if (!room) return;
      const session = JSON.parse(localStorage.getItem(`footyverse-room-${room.roomCode}`) || "null");
      socket.emit("rejoinRoom", { roomCode: room.roomCode, resumeToken: session?.resumeToken });
    };
    socket.on("reconnect", onReconnect);
    return () => socket.off("reconnect", onReconnect);
  }, [room]);

  // The server restarted or the room was cleaned up while we were away — kick
  // the player back to the hub instead of leaving them frozen in a dead match.
  useEffect(() => {
    const onGone = () => setRoom(null);
    socket.on("matchGone", onGone);
    return () => socket.off("matchGone", onGone);
  }, []);

  if (checking) return <div className="boot-screen"><span>⚽</span><p>Loading your club…</p></div>;
  if (!user) return <AuthGate />;
  if (room) return <Draft room={room} onLeaveRoom={() => setRoom(null)} />;
  if (screen === "team") return <TeamScreen onBack={() => setScreen("hub")} />;
  if (screen === "packs") return <PackScreen onBack={() => setScreen("hub")} />;
  if (screen === "quests") return <QuestScreen onBack={() => setScreen("hub")} />;
  if (screen === "leaderboard") return <Leaderboard onBack={() => setScreen("hub")} />;
  if (screen === "events") return <EventsScreen onBack={() => setScreen("hub")} />;
  if (screen === "play") return <Lobby setRoom={setRoom} onBack={() => setScreen("hub")} />;
  return (
    <>
      <Hub onNavigate={(next) => setScreen(next)} />
      {welcomeGift && <WelcomePopup gift={welcomeGift} onAccept={() => { dismissWelcomeGift(); refreshUser(); }} />}
    </>
  );
}

export default function App() {
  return <AuthProvider><Shell /></AuthProvider>;
}
