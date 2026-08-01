import { io } from "socket.io-client";

// Vite replaces this at build time.  Keep localhost as the development
// default, but never hard-code it into a production deployment.
const serverUrl = import.meta.env.VITE_SOCKET_URL || "http://localhost:5000";

const socket = io(serverUrl, {
  transports: ["websocket", "polling"],
  reconnection: true,
});

export default socket;
