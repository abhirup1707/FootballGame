import { countryFlagPath } from "../lib/countries";

const STAT_ITEMS = [
  ["PAC", "pace"],
  ["SHO", "shooting"],
  ["PAS", "passing"],
  ["DRI", "dribbling"],
  ["DEF", "defending"],
  ["PHY", "physicality"],
];

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

export default function FcCard({ player, size = "md", className = "", onClick }) {
  const rating = player.rating ?? player.base_rating ?? 0;
  const position = player.position || player.category || "?";
  const tier = rating >= 70 ? "silver" : "bronze";
  const clickable = Boolean(onClick);
  return (
    <div className={`fcc fcc-${tier} fcc-${size} ${clickable ? "fcc-clickable" : ""} ${className}`} onClick={onClick}>
      <StadiumSilhouette />
      <div className="fcc-head">
        <span className="fcc-ovr">{rating}</span>
        <span className="fcc-pos">{position}</span>
        {countryFlagPath(player.nation) && <img className="fcc-nation" src={countryFlagPath(player.nation)} alt={player.nation} />}
      </div>
      <div className="fcc-name">{player.name}</div>
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
