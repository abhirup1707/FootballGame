import { useEffect, useMemo, useState } from "react";
import api from "../api";
import FcCard from "./FcCard";
import { lastName } from "../lib/card";

const PAGE_SIZE = 50;

const POSITIONS = [
  { value: "", label: "All positions" },
  { value: "ATT", label: "Attackers" },
  { value: "MID", label: "Midfielders" },
  { value: "DEF", label: "Defenders" },
  { value: "GK", label: "Goalkeepers" },
];

const EVENT_OPTIONS = [
  { value: "all", label: "All events" },
  { value: "club", label: "Regular" },
  { value: "laliga", label: "La Liga Kickoff" },
];

const isLaliga = (c) => c.variant === "laliga" || c.version === "laliga";
const cardRating = (c) => c.base_rating ?? c.rating ?? 0;
const eventLabel = (c) => (isLaliga(c) ? "La Liga Kickoff" : "Regular");

export default function PlayerBrowser() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [view, setView] = useState("table");
  const [page, setPage] = useState(1);

  const [name, setName] = useState("");
  const [position, setPosition] = useState("");
  const [nation, setNation] = useState("");
  const [minOvr, setMinOvr] = useState("");
  const [maxOvr, setMaxOvr] = useState("");
  const [event, setEvent] = useState("all");

  useEffect(() => {
    let active = true;
    api
      .cards()
      .then((data) => { if (active) setCards(data.cards || []); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const nations = useMemo(
    () => [...new Set(cards.map((c) => c.nation).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [cards]
  );

  const ovrOptions = useMemo(() => {
    let min = 99;
    let max = 0;
    cards.forEach((c) => {
      const r = cardRating(c);
      if (r < min) min = r;
      if (r > max) max = r;
    });
    const out = [];
    for (let v = min; v <= max; v += 1) out.push(v);
    return out;
  }, [cards]);

  const filtered = useMemo(() => {
    const q = name.trim().toLowerCase();
    return cards
      .filter((c) => {
        if (q && !(c.name || "").toLowerCase().includes(q) && !(c.club || "").toLowerCase().includes(q)) return false;
        if (position && c.position !== position) return false;
        if (nation && c.nation !== nation) return false;
        const r = cardRating(c);
        if (minOvr && r < Number(minOvr)) return false;
        if (maxOvr && r > Number(maxOvr)) return false;
        const laliga = isLaliga(c);
        if (event === "club" && laliga) return false;
        if (event === "laliga" && !laliga) return false;
        return true;
      })
      .sort((a, b) => cardRating(b) - cardRating(a) || (a.name || "").localeCompare(b.name || ""));
  }, [cards, name, position, nation, minOvr, maxOvr, event]);

  useEffect(() => { setPage(1); }, [name, position, nation, minOvr, maxOvr, event]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageCards = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const start = filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const end = Math.min(page * PAGE_SIZE, filtered.length);

  const reset = () => {
    setName("");
    setPosition("");
    setNation("");
    setMinOvr("");
    setMaxOvr("");
    setEvent("all");
    setPage(1);
  };

  return (
    <section className="player-browser">
      <div className="pl-filters">
        <div className="pl-search">
          <span className="pl-search-icon">🔎</span>
          <input
            type="text"
            placeholder="Search player name or club…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>

        <select value={position} onChange={(e) => setPosition(e.target.value)}>
          {POSITIONS.map((p) => <option key={p.value || "all"} value={p.value}>{p.label}</option>)}
        </select>

        <select value={nation} onChange={(e) => setNation(e.target.value)}>
          <option value="">All nationalities</option>
          {nations.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <div className="pl-ovr">
          <select value={minOvr} onChange={(e) => setMinOvr(e.target.value)}>
            <option value="">Min OVR</option>
            {ovrOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
          <span>—</span>
          <select value={maxOvr} onChange={(e) => setMaxOvr(e.target.value)}>
            <option value="">Max OVR</option>
            {ovrOptions.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <select value={event} onChange={(e) => setEvent(e.target.value)}>
          {EVENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        <button className="pl-reset" onClick={reset} type="button">Reset</button>
      </div>

      <div className="pl-results-head">
        <p className="pl-count">
          {loading ? "Loading players…" : `${filtered.length} player${filtered.length === 1 ? "" : "s"} found`}
        </p>
        <div className="pl-view-toggle">
          <button className={view === "table" ? "active" : ""} onClick={() => setView("table")} type="button">▦ Table</button>
          <button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")} type="button">▧ Cards</button>
        </div>
      </div>

      {error && <p className="auth-error pack-error">{error}</p>}

      {!loading && !error && filtered.length === 0 && (
        <div className="inventory-empty"><i>⚽</i><p>No players match your search. Try clearing some filters.</p></div>
      )}

      {view === "table" && pageCards.length > 0 && (
        <div className="pl-table-wrap">
          <table className="pl-table">
            <thead>
              <tr>
                <th>OVR</th>
                <th>Player</th>
                <th>Pos</th>
                <th>Club</th>
                <th>Nation</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {pageCards.map((c) => (
                <tr key={c.id} className={isLaliga(c) ? "pl-row-laliga" : ""}>
                  <td><strong className="pl-ovr-badge">{cardRating(c)}</strong></td>
                  <td className="pl-player">
                    {c.image
                      ? <img className="pl-avatar" src={c.image} alt="" draggable="false" />
                      : <span className="pl-avatar pl-avatar-text">{(c.name || "?").slice(0, 2).toUpperCase()}</span>}
                    <span className="pl-player-name"><b>{lastName(c.name)}</b></span>
                  </td>
                  <td><span className="pl-pos">{c.position}</span></td>
                  <td>{c.club || "—"}</td>
                  <td>{c.nation || "—"}</td>
                  <td><span className={`pl-event ${isLaliga(c) ? "pl-event-laliga" : ""}`}>{eventLabel(c)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "grid" && pageCards.length > 0 && (
        <div className="pl-grid">
          {pageCards.map((c) => <FcCard key={c.id} player={c} size="sm" />)}
        </div>
      )}

      {pageCards.length > 0 && (
        <div className="pl-pager">
          <span>Showing {start}–{end} of {filtered.length}</span>
          <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Prev</button>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </section>
  );
}
