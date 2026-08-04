import { useState } from "react";
import Lobby from "./components/Lobby";
import Draft from "./components/Draft";

export default function App() {
  const [room, setRoom] = useState(null);

  if (room) {
    return <Draft room={room} onLeaveRoom={() => setRoom(null)} />;
  }

  return <Lobby setRoom={setRoom} />;
}