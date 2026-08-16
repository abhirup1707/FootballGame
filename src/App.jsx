import { useEffect, useState } from "react";
import { AuthProvider, useAuth } from "./auth";
import socket from "./socket";
import { MusicProvider, useMusic } from "./music";
import AuthGate from "./components/AuthGate";
import Hub from "./components/Hub";
import TeamScreen from "./components/TeamScreen";
import PackScreen from "./components/PackScreen";
import QuestScreen from "./components/QuestScreen";
import Leaderboard from "./components/Leaderboard";
import EventsScreen from "./components/EventsScreen";
import PlayersScreen from "./components/PlayersScreen";
import ExchangeScreen from "./components/ExchangeScreen";
import FriendsScreen from "./components/FriendsScreen";
import Lobby from "./components/Lobby";
import Draft from "./components/Draft";
import WelcomePopup from "./components/WelcomePopup";
import LoginRewardPopup from "./components/LoginRewardPopup";
import MusicToggle from "./components/MusicToggle";

function Shell() {
  const { user, checking, token, welcomeGift, dismissWelcomeGift, refreshUser, loginReward, dismissLoginReward, claimLoginReward } = useAuth();
  const [screen, setScreen] = useState("hub");
  const [room, setRoom] = useState(null);
  const [invite, setInvite] = useState(null);
  const [inviteJoin, setInviteJoin] = useState(null);
  const { setMatch } = useMusic();

  // Menu music ducks out while a match is running so it doesn't clash.
  useEffect(() => {
    setMatch(Boolean(room));
  }, [room, setMatch]);

  useEffect(() => {
    if (token) socket.emit("authSocket", { token });
  }, [token]);

  // The server is authoritative about who's in a room (socket ids change on
  // reconnect). Re-sync the room state whenever the server announces it so
  // turns and matches never point at a stale player id.
  useEffect(() => {
    const onReady = (next) => { if (next?.roomCode) { setRoom(next); setInviteJoin(null); } };
    socket.on("roomReady", onReady);
    return () => socket.off("roomReady", onReady);
  }, []);

  // A friend pings a live invite into their room — surface it anywhere in the
  // app so accepting drops you straight into the join flow.
  useEffect(() => {
    const onInvite = (data) => { if (!room && data?.roomCode) setInvite(data); };
    socket.on("roomInvite", onInvite);
    return () => socket.off("roomInvite", onInvite);
  }, [room]);

  const acceptInvite = () => {
    if (!invite) return;
    setInviteJoin(invite.roomCode);
    setInvite(null);
    setScreen("play");
  };
  const declineInvite = () => {
    if (!invite) return;
    socket.emit("declineRoomInvite", { roomCode: invite.roomCode, fromUserId: invite.fromUserId });
    setInvite(null);
  };

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

  let content;
  if (checking) content = <div className="boot-screen"><span>⚽</span><p>Loading your club…</p></div>;
  else if (!user) content = <AuthGate />;
  else if (room) content = <Draft room={room} onLeaveRoom={() => setRoom(null)} />;
  else if (screen === "team") content = <TeamScreen onBack={() => setScreen("hub")} />;
  else if (screen === "packs") content = <PackScreen onBack={() => setScreen("hub")} />;
  else if (screen === "quests") content = <QuestScreen onBack={() => setScreen("hub")} />;
  else if (screen === "leaderboard") content = <Leaderboard onBack={() => setScreen("hub")} />;
  else if (screen === "events") content = <EventsScreen onBack={() => setScreen("hub")} />;
  else if (screen === "players") content = <PlayersScreen onBack={() => setScreen("hub")} />;
  else if (screen === "exchange") content = <ExchangeScreen onBack={() => setScreen("hub")} />;
  else if (screen === "friends") content = <FriendsScreen onBack={() => setScreen("hub")} />;
  else if (screen === "play") content = <Lobby setRoom={setRoom} onBack={() => setScreen("hub")} inviteRoom={inviteJoin} />;
  else content = (
    <>
      <MusicToggle />
      <Hub onNavigate={(next) => setScreen(next)} />
      {welcomeGift && <WelcomePopup gift={welcomeGift} onAccept={() => { dismissWelcomeGift(); refreshUser(); }} />}
      {!welcomeGift && loginReward?.available && (
        <LoginRewardPopup reward={loginReward} onClaim={claimLoginReward} onDone={dismissLoginReward} />
      )}
    </>
  );
  return (
    <>
      {content}
      {invite && user && !room && <InviteToast invite={invite} onAccept={acceptInvite} onDecline={declineInvite} />}
    </>
  );
}

function InviteToast({ invite, onAccept, onDecline }) {
  return (
    <div className="invite-toast">
      <div className="invite-toast-card">
        <span className="invite-toast-icon">⚽</span>
        <div className="invite-toast-body">
          <small>MATCH INVITE</small>
          <b>{invite.fromName} invited you to a room</b>
          <span>First to {invite.goalLimit} · {invite.matchMode === "time" ? "timed match" : "live duel"}</span>
        </div>
        <div className="invite-toast-actions">
          <button className="f-accept" onClick={onAccept}>Accept</button>
          <button className="f-decline" onClick={onDecline}>Decline</button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <MusicProvider>
        <Shell />
      </MusicProvider>
    </AuthProvider>
  );
}
