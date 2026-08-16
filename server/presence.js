// In-memory presence registry: which user ids are connected to the socket
// server right now. Used for the friends list (online/offline dots) and to
// route room invites to the right sockets. Not authoritative for anything
// else — rooms stay in memory as usual.
const online = new Map(); // userId -> Set of socket ids

function markOnline(userId, socketId) {
  if (!userId) return;
  if (!online.has(userId)) online.set(userId, new Set());
  online.get(userId).add(socketId);
}

function markOffline(socketId) {
  for (const [userId, sockets] of online) {
    if (sockets.delete(socketId) && sockets.size === 0) online.delete(userId);
  }
}

function isOnline(userId) {
  return Boolean(userId && online.get(userId)?.size);
}

function socketIdsFor(userId) {
  return online.get(userId) ? [...online.get(userId)] : [];
}

module.exports = { markOnline, markOffline, isOnline, socketIdsFor };
