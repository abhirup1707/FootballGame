const configuredApiUrl = import.meta.env.VITE_API_URL || import.meta.env.VITE_SOCKET_URL;
const API_URL = (configuredApiUrl || (import.meta.env.DEV ? "http://localhost:5000" : "")).replace(/\/+$/, "");

async function request(path, { method = "GET", body, token } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const api = {
  register: (username, password) => request("/api/auth/register", { method: "POST", body: { username, password } }),
  login: (username, password) => request("/api/auth/login", { method: "POST", body: { username, password } }),
  logout: (token) => request("/api/auth/logout", { method: "POST", token }),
  me: (token) => request("/api/me", { token }),
  cards: () => request("/api/cards"),
  leaderboard: (token, type) => request(`/api/leaderboard?type=${type}`, { token }),
  inventory: (token) => request("/api/inventory", { token }),
  team: (token) => request("/api/team", { token }),
  teamPublic: (token, userId) => request(`/api/team/${userId}`, { token }),
  saveTeam: (token, slots) => request("/api/team", { method: "POST", token, body: { slots } }),
  packs: (token) => request("/api/packs", { token }),
  openPack: (token, packKey) => request("/api/packs/open", { method: "POST", token, body: { packKey } }),
  pickPack: (token, pickId, selections) => request("/api/packs/pick", { method: "POST", token, body: { pickId, selections } }),
  quests: (token) => request("/api/quests", { token }),
  claimQuest: (token, questId) => request("/api/quests/claim", { method: "POST", token, body: { questId } }),
  events: (token) => request("/api/events", { token }),
  claimEventQuest: (token, questId) => request("/api/events/quests/claim", { method: "POST", token, body: { questId } }),
  exchangePurple: (token, ids) => request("/api/events/exchange", { method: "POST", token, body: { ids } }),
  exchange: (token, ids) => request("/api/exchange", { method: "POST", token, body: { ids } }),
  exchangeTokens: (token, ids) => request("/api/exchange/tokens", { method: "POST", token, body: { ids } }),
  redeemTokens: (token) => request("/api/exchange/tokens/redeem", { method: "POST", token }),
  tokenConfig: (token) => request("/api/exchange/tokens", { token }),
  loginReward: (token) => request("/api/login-reward", { token }),
  claimLoginReward: (token) => request("/api/login-reward/claim", { method: "POST", token }),
};

export default api;
