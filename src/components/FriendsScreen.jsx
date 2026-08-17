import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import api from "../api";
import { useAuth } from "../auth";

export default function FriendsScreen({ onBack }) {
  const { token, user } = useAuth();
  const [list, setList] = useState({ friends: [], incoming: [], outgoing: [] });
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = () => api.friends(token).then((data) => setList(data)).catch((err) => setError(err.message));

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [token]);

  const submitRequest = () => {
    if (!username.trim()) return;
    setBusy(true);
    setError("");
    setNotice("");
    api.friendRequest(token, username.trim())
      .then((data) => { setList(data.list); setUsername(""); setNotice("Friend request sent."); })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const respond = (requestId, accept) => {
    setBusy(true);
    setError("");
    api.friendRespond(token, requestId, accept)
      .then((data) => { setList(data.list); if (accept) setNotice("Friend added — you can invite them into a room."); })
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const remove = (friendId) => {
    setBusy(true);
    setError("");
    api.friendRemove(token, friendId)
      .then((data) => setList(data.list))
      .catch((err) => setError(err.message))
      .finally(() => setBusy(false));
  };

  const dot = (online) => <i className={`f-dot ${online ? "f-online" : ""}`} />;

  return (
    <main className="lobby-bg">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <div className="hub-wrap friends-screen">
        <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head">
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <div><span className="eyebrow">CLUB SOCIAL</span><h1>Friends</h1></div>
          <div className="hub-currency"><span>🪙 {user.coins}</span><span>💎 {user.gems}</span></div>
        </motion.header>

        {error && <p className="auth-error pack-error">{error}</p>}
        {notice && <p className="f-notice">{notice}</p>}

        <div className="f-add">
          <input
            className="g-code-input"
            placeholder="ADD MANAGER BY USERNAME"
            value={username}
            maxLength={20}
            onChange={(event) => setUsername(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") submitRequest(); }}
          />
          <button className="g-share" onClick={submitRequest} disabled={busy}>
            {busy ? "…" : "Add friend"}
          </button>
        </div>

        {list.incoming.length > 0 && (
          <section className="f-block">
            <div className="f-block-head"><b>INCOMING REQUESTS</b><span>{list.incoming.length}</span></div>
            {list.incoming.map((req) => (
              <div key={req.id} className="f-row">
                {dot(req.online)}
                <span className="f-avatar">{req.username.slice(0, 2).toUpperCase()}</span>
                <span className="f-name">{req.username}</span>
                <div className="f-actions">
                  <button className="f-accept" onClick={() => respond(req.id, true)} disabled={busy}>✓ Accept</button>
                  <button className="f-decline" onClick={() => respond(req.id, false)} disabled={busy}>✕</button>
                </div>
              </div>
            ))}
          </section>
        )}

        {list.outgoing.length > 0 && (
          <section className="f-block">
            <div className="f-block-head"><b>OUTGOING REQUESTS</b><span>{list.outgoing.length}</span></div>
            {list.outgoing.map((req) => (
              <div key={req.id} className="f-row">
                <i className="f-dot" />
                <span className="f-avatar">{req.username.slice(0, 2).toUpperCase()}</span>
                <span className="f-name">{req.username}</span>
                <div className="f-actions">
                  <span className="f-pending">Pending…</span>
                  <button className="f-decline" onClick={() => remove(req.userId)} disabled={busy}>✕</button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="f-block">
          <div className="f-block-head"><b>MY FRIENDS</b><span>{list.friends.length}</span></div>
          {list.friends.length === 0 && <p className="inventory-empty">No friends yet — add a manager by username above.</p>}
          {list.friends.map((friend) => (
            <motion.div key={friend.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="f-row">
              {dot(friend.online)}
              <span className="f-avatar">{friend.username.slice(0, 2).toUpperCase()}</span>
              <span className="f-name">{friend.username}</span>
              <span className={`f-meta f-h2h ${friend.myWins > friend.theirWins ? "f-h2h-leading" : friend.myWins < friend.theirWins ? "f-h2h-trailing" : ""}`}>{friend.myWins > 0 || friend.theirWins > 0 ? <><span className="f-h2h-score">{friend.myWins}–{friend.theirWins}</span> H2H</> : <>{friend.wins} 🏆</>}{friend.online ? " · online" : ""}</span>
              <div className="f-actions">
                <button className="f-decline" onClick={() => remove(friend.id)} disabled={busy} aria-label="Remove friend">✕</button>
              </div>
            </motion.div>
          ))}
        </section>
      </div>
    </main>
  );
}
