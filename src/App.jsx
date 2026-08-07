import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import socket from "./socket";
import AuthGate from "./components/AuthGate";
import Hub from "./components/Hub";
import TeamScreen from "./components/TeamScreen";
import PackScreen from "./components/PackScreen";
import QuestScreen from "./components/QuestScreen";
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

  if (checking) return <div className="boot-screen"><span>⚽</span><p>Loading your club…</p></div>;
  if (!user) return <AuthGate />;
  if (room) return <Draft room={room} onLeaveRoom={() => setRoom(null)} />;
  if (screen === "team") return <TeamScreen onBack={() => setScreen("hub")} />;
  if (screen === "packs") return <PackScreen onBack={() => setScreen("hub")} />;
  if (screen === "quests") return <QuestScreen onBack={() => setScreen("hub")} />;
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
