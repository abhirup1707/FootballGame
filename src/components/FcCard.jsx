import { useState, useRef, useCallback } from "react";
import { countryFlagPath } from "../lib/countries";
import { clubLogoPath, isLaligaCard, lastName } from "../lib/card";

function useTilt(ref) {
  const frame = useRef(null);
  const handleMove = useCallback((e) => {
    if (!ref.current) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      el.style.transform = `perspective(600px) rotateY(${x * 18}deg) rotateX(${-y * 18}deg) scale(1.06)`;
      el.style.zIndex = "10";
    });
  }, [ref]);
  const handleLeave = useCallback(() => {
    if (frame.current) cancelAnimationFrame(frame.current);
    if (ref.current) {
      ref.current.style.transform = "";
      ref.current.style.zIndex = "";
    }
  }, [ref]);
  return { onMouseMove: handleMove, onMouseLeave: handleLeave };
}

const STAT_ITEMS = [
  ["PAC", "pace"],
  ["SHO", "shooting"],
  ["PAS", "passing"],
  ["DRI", "dribbling"],
  ["DEF", "defending"],
  ["PHY", "physicality"],
];

function PlayerShadow() {
  return (
    <span className="fcc-shadow">
      <svg viewBox="0 0 64 84" aria-hidden="true">
        <path d="M32 8a12 12 0 1 1 0 24 12 12 0 0 1 0-24z" />
        <path d="M13 84c0-11 8.5-17.5 19-17.5S51 73 51 84z" />
        <path d="M23 45c0-5 3-7 9-7s9 2 9 7v9c0 4-2 6-5 6v5l-3 12h-2l-2-12-2-7z" />
        <path d="M42 48v14l2 22h2l3-12-1-22z" />
        <circle cx="14" cy="68" r="5" />
        <path d="M14 63v-2h-4c-2 0-2 4 0 4z" />
      </svg>
    </span>
  );
}

function LaligaHexCard({ player, size = "md", className = "", onClick }) {
  const rating = player.rating ?? player.base_rating ?? 0;
  const position = player.position || player.category || "?";
  const clickable = Boolean(onClick);
  const logo = clubLogoPath(player.club);
  const flag = countryFlagPath(player.nation);
  const tiltRef = useRef(null);
  const tilt = useTilt(tiltRef);
  return (
    <div ref={tiltRef} className={`laliga-card laliga-card-${size} ${clickable ? "laliga-card-clickable" : ""} ${className}`} onClick={onClick} {...tilt}>
      <div className="laliga-card-frame">
        <div className="laliga-card-bg">
          {logo && <img className="laliga-card-logo" src={logo} alt="" aria-hidden="true" draggable="false" />}
          <div className="laliga-card-shine" />
          <span className="laliga-card-brand">LALIGA</span>
          <div className="laliga-card-ovr">{rating}</div>
          <div className="laliga-card-details">
            {flag && <img className="laliga-card-flag" src={flag} alt={player.nation} />}
            <span className="laliga-card-pos">{position}</span>
            {logo && <img className="laliga-card-club" src={logo} alt={player.club} />}
          </div>
          <div className="laliga-card-portrait">
            {player.image
              ? <img src={player.image} alt={player.name} className="laliga-card-img" draggable="false" />
              : <PlayerShadow />}
          </div>
          <div className="laliga-card-name">{lastName(player.name)}</div>
        </div>
      </div>
    </div>
  );
}

function StadiumSilhouette() {
  return (
    <svg className="fcc-stadium" viewBox="0 0 220 140" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <path d="M0 140 V118 H220 V140 Z" />
      <path d="M14 118 V100 q10-8 22 0 V118 Z M48 118 V96 q12-9 26 0 V118 Z M86 118 V92 q14-10 28 0 V118 Z M126 118 V92 q12-10 24 0 V118 Z M162 118 V96 q12-8 26 0 V118 Z M198 118 V100 q8-7 22 0 V118 Z" />
      <path d="M6 100 q0-40 20-58 M214 100 q0-40-20-58" fill="none" strokeWidth="5" strokeLinecap="round" />
      <circle cx="6" cy="38" r="4" />
      <circle cx="214" cy="38" r="4" />
      <path d="M96 52 h28 M96 60 h28 M100 52 v10 M120 52 v10" strokeWidth="3" />
    </svg>
  );
}

export default function FcCard({ player, size = "md", className = "", onClick }) {
  if (isLaligaCard(player)) {
    return <LaligaHexCard player={player} size={size} className={className} onClick={onClick} />;
  }

  const rating = player.rating ?? player.base_rating ?? 0;
  const position = player.position || player.category || "?";
  const tier = player.version === "purple" || (rating >= 77 && rating <= 80)
    ? "purple"
    : rating >= 80
      ? "gold"
      : rating >= 70
        ? "silver"
        : "bronze";
  const clickable = Boolean(onClick);
  const tiltRef = useRef(null);
  const tilt = useTilt(tiltRef);
  return (
    <div ref={tiltRef} className={`fcc fcc-${tier} fcc-${size} ${clickable ? "fcc-clickable" : ""} ${className}`} onClick={onClick} {...tilt}>
      <StadiumSilhouette />
      <div className="fcc-head">
        <span className="fcc-ovr">{rating}</span>
        <span className="fcc-pos">{position}</span>
        {countryFlagPath(player.nation) && <img className="fcc-nation" src={countryFlagPath(player.nation)} alt={player.nation} />}
      </div>
      <div className="fcc-name">{lastName(player.name)}</div>
      <div className="fcc-photo-wrap">
        <div className="fcc-photo">
          {player.image
            ? <img src={player.image} alt={player.name} className="fcc-img" />
            : <PlayerShadow />}
        </div>
      </div>
      <div className="fcc-stats">
        {STAT_ITEMS.map(([label, key]) => <span className="fcc-stat" key={key}><em>{label}</em><b>{player[key] ?? "-"}</b></span>)}
      </div>
    </div>
  );
}
