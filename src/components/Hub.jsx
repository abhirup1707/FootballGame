import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../auth";
import api from "../api";

const NAV = [
  {
    key: "play",
    icon: "⚡",
    title: "Play a match",
    desc: "Take on the CPU or challenge a friend in live 1v1.",
    color: "#ffd24a",
    tag: "1V1 · VS CPU",
  },
  {
    key: "team",
    icon: "🛡️",
    title: "My team",
    desc: "Build your starting XI from the players you own.",
    color: "#3ad8ff",
    tag: "SQUAD",
  },
  {
    key: "packs",
    icon: "🎁",
    title: "Packs",
    desc: "Open players to strengthen your club.",
    color: "#ff7ee0",
    tag: "OPENER",
  },
  {
    key: "quests",
    icon: "📋",
    title: "Quests",
    desc: "Complete objectives for big rewards.",
    color: "#6bff8f",
    tag: "DAILY",
  },
  {
    key: "leaderboard",
    icon: "🏆",
    title: "Leaderboard",
    desc: "Top managers by wins, goals & saves.",
    color: "#ff8a3c",
    tag: "RANKED",
  },
  {
    key: "events",
    icon: "🎪",
    title: "Events",
    desc: "Live events feed — cups, promos & limited-time rewards.",
    color: "#c77dff",
    tag: "LIVE",
  },
  {
    key: "players",
    icon: "📊",
    title: "Players list",
    desc: "Search the full player database by name, position, nation, OVR & event.",
    color: "#4fe3a0",
    tag: "DATABASE",
  },
  {
    key: "exchange",
    icon: "🪙",
    title: "Exchange",
    desc: "Trade up your players and earn Footyverse tokens for 83-85 signings.",
    color: "#ffd24a",
    tag: "TRADES",
  },
];

export default function Hub({ onNavigate }) {
  const { user, token, logout } = useAuth();
  const [record, setRecord] = useState(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    api
      .leaderboard(token, "wins")
      .then(({ me }) => {
        if (active) setRecord(me || null);
      })
      .catch(() => {
        if (active) setRecord(null);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const level = user.level || 1;
  const xp = user.xp || 0;
  const xpPct = Math.min(100, Math.round((xp / (level * 100)) * 100));

  return (
    <main className="lobby-bg hub-page">
      <div className="lobby-orb orb-one" />
      <div className="lobby-orb orb-two" />
      <div className="lobby-noise" />
      <div className="hub-wrap">
        <motion.header
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          className="g-hud"
        >
          <div className="g-hud-brand">
            <span className="g-hud-logo">⚽</span>
            <div>
              <small>FOOTYVERSE</small>
              <b>CLUB HEADQUARTERS</b>
            </div>
          </div>
          <div className="g-profile">
            <div className="g-avatar">
              {user.username.slice(0, 2).toUpperCase()}
            </div>
            <div className="g-profile-info">
              <small>MANAGER</small>
              <b>{user.username}</b>
            </div>
            <div className="g-lvl">LV {level}</div>
            <div className="g-xp">
              <div className="g-xp-track">
                <div
                  className="g-xp-fill"
                  style={{ width: `${xpPct}%` }}
                />
              </div>
              <small>
                {xp}/{level * 100} XP
              </small>
            </div>
            <div className="g-currency">
              <span className="g-coin">🪙 {user.coins}</span>
              <span className="g-gem">💎 {user.gems}</span>
            </div>
          </div>
        </motion.header>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="g-hero"
        >
          <div className="g-hero-scan" />
          <span className="eyebrow">MATCHDAY LIVE · ONLINE FOOTBALL CLUB</span>
          <h1>
            Own your club.
            <br />
            <em>Win the weekend.</em>
          </h1>
          <p>
            Draft legends, build your team, and outplay rivals in live 1v1
            matches.
          </p>
          {record && (
            <div className="g-record">
              <span>
                <b>{record.wins}</b> WINS
              </span>
              <span>
                <b>{record.goals}</b> GOALS
              </span>
              <span>
                <b>{record.saves}</b> SAVES
              </span>
            </div>
          )}
          <button
            className="g-cta g-cta-hero"
            onClick={() => onNavigate("play")}
          >
            <span>Enter the Arena</span>
            <em>⚡ PLAY</em>
          </button>
        </motion.section>

        <div className="hub-grid g-mode-grid">
          {NAV.map((item, index) => (
            <motion.button
              key={item.key}
              initial={{ opacity: 0, y: 18 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14 + index * 0.07 }}
              className="g-mode"
              style={{ "--mode": item.color }}
              onClick={() => onNavigate(item.key)}
            >
              <span className="g-mode-accent" />
              <i className="g-mode-icon">{item.icon}</i>
              <div className="g-mode-body">
                <b>{item.title}</b>
                <span>{item.desc}</span>
              </div>
              <em className="g-mode-tag">
                {item.tag} <span>→</span>
              </em>
            </motion.button>
          ))}
        </div>

        <button className="g-signout" onClick={logout}>
          Sign out
        </button>
      </div>
    </main>
  );
}
