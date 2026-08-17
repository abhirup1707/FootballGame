import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../auth";
import api from "../api";

const STATUS_STYLE = {
  IN_PLAY: { label: "LIVE", color: "#ff4444", pulse: true },
  PAUSED: { label: "HT", color: "#ffaa00", pulse: false },
  FINISHED: { label: "FT", color: "#667788", pulse: false },
  SCHEDULED: { label: "", color: "#445566", pulse: false },
};

function formatKickoff(utcDate) {
  const d = new Date(utcDate);
  const now = new Date();
  const diffDays = Math.floor((d - now) / (1000 * 60 * 60 * 24));
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Today ${time}`;
  if (diffDays === 1) return `Tomorrow ${time}`;
  if (diffDays === -1) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" }) + " " + time;
}

function MatchCard({ match }) {
  const st = STATUS_STYLE[match.status] || STATUS_STYLE.SCHEDULED;
  const isLive = match.status === "IN_PLAY" || match.status === "PAUSED";
  const hasScore = match.homeScore != null;

  return (
    <div className={`ls-match ${isLive ? "ls-match-live" : ""} ${match.status === "FINISHED" ? "ls-match-done" : ""}`}>
      <div className="ls-match-header">
        {st.label && <span className="ls-status" style={{ background: st.color }}>{st.label}</span>}
        {isLive && match.minute && <span className="ls-minute">{match.minute}'</span>}
        <span className="ls-matchday">MD {match.matchday}</span>
      </div>
      <div className="ls-match-teams">
        <div className="ls-team">
          {match.homeCrest && <img className="ls-crest" src={match.homeCrest} alt="" />}
          <span className="ls-team-name">{match.homeTeam}</span>
        </div>
        <div className="ls-score">
          {hasScore ? <b>{match.homeScore} - {match.awayScore}</b> : <span className="ls-vs">VS</span>}
        </div>
        <div className="ls-team ls-team-away">
          <span className="ls-team-name">{match.awayTeam}</span>
          {match.awayCrest && <img className="ls-crest" src={match.awayCrest} alt="" />}
        </div>
      </div>
      {!hasScore && <div className="ls-kickoff">{formatKickoff(match.utcDate)}</div>}
    </div>
  );
}

export default function LiveScoresScreen({ onBack }) {
  const { token } = useAuth();
  const [competitions, setCompetitions] = useState([]);
  const [activeComp, setActiveComp] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    api.liveScores(token).then((data) => {
      if (data.competitions?.length) {
        setCompetitions(data.competitions);
        setActiveComp(data.competitions[0].id);
      }
    }).catch((e) => setError(e.message));
  }, [token]);

  const fetchMatches = async (comp) => {
    if (!token || !comp) return;
    setLoading(true);
    setError("");
    try {
      const data = await api.liveScoresCompetition(token, comp);
      setMatches(data.matches || []);
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  useEffect(() => { if (activeComp) fetchMatches(activeComp); }, [activeComp]);

  useEffect(() => {
    if (!activeComp) return;
    const iv = setInterval(() => fetchMatches(activeComp), 60000);
    return () => clearInterval(iv);
  }, [activeComp]);

  const liveMatches = matches.filter((m) => m.status === "IN_PLAY" || m.status === "PAUSED");
  const finished = matches.filter((m) => m.status === "FINISHED");
  const upcoming = matches.filter((m) => m.status === "SCHEDULED");

  return (
    <main className="lobby-bg">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <div className="hub-wrap">
        <motion.header initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} className="team-head">
          <button className="icon-btn" onClick={onBack} aria-label="Back">←</button>
          <div><span className="eyebrow">LIVE</span><h1>Live Scores</h1></div>
        </motion.header>

        {error && <p className="auth-error pack-error">{error}</p>}

        <div className="ls-tabs">
          {competitions.map((c) => (
            <button key={c.id} className={`ls-tab ${activeComp === c.id ? "ls-tab-active" : ""}`} onClick={() => setActiveComp(c.id)}>
              {c.name}
            </button>
          ))}
        </div>

        {loading && !matches.length ? (
          <div className="ls-loading">Loading scores...</div>
        ) : (
          <div className="ls-content">
            {liveMatches.length > 0 && (
              <section className="ls-section">
                <h3 className="ls-section-title"><span className="ls-live-dot" /> Live Now</h3>
                {liveMatches.map((m) => <MatchCard key={m.id} match={m} />)}
              </section>
            )}
            {upcoming.length > 0 && (
              <section className="ls-section">
                <h3 className="ls-section-title">Upcoming</h3>
                {upcoming.map((m) => <MatchCard key={m.id} match={m} />)}
              </section>
            )}
            {finished.length > 0 && (
              <section className="ls-section">
                <h3 className="ls-section-title">Results</h3>
                {finished.map((m) => <MatchCard key={m.id} match={m} />)}
              </section>
            )}
            {!matches.length && !loading && <div className="ls-empty">No matches found for this competition.</div>}
          </div>
        )}
      </div>
    </main>
  );
}
