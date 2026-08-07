import { io } from "socket.io-client";

// Vite replaces this at build time.  Keep localhost as the development
// default, but never hard-code it into a production deployment.
const configuredServerUrl = import.meta.env.VITE_SOCKET_URL || import.meta.env.VITE_API_URL;
const serverUrl = (configuredServerUrl || (import.meta.env.DEV ? "http://localhost:5000" : window.location.origin)).replace(/\/+$/, "");

const socket = io(serverUrl, {
  transports: ["websocket", "polling"],
  reconnection: true,
});

socket.on("connect", () => {
  try {
    const raw = localStorage.getItem("footyverse-auth");
    if (raw) socket.emit("authSocket", { token: JSON.parse(raw).token });
  } catch { /* not signed in yet */ }
});

export default socket;
