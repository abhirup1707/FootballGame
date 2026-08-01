export default function SquadBoard({ positions, selectedPlayer, assignPlayer, overall }) {
  const allowed = { GK:["GK"], LB:["LB","CB"], CB1:["CB"], CB2:["CB"], RB:["RB","CB"], CM1:["CM","CAM","CDM"], CM2:["CM","CAM","CDM"], CAM:["CAM","CM"], LW:["LW","RW","ST"], ST:["ST","CF"], RW:["RW","LW","ST"] };
  const placePlayer = (positionKey) => {
    if (!selectedPlayer) return;
    if (!allowed[positionKey]?.includes(selectedPlayer.position)) return alert(`${selectedPlayer.name} cannot play in this role`);
    assignPlayer?.(positionKey);
  };
  function Position({ label, positionKey }) {
    const player = positions[positionKey];
    return <button type="button" className={`squad-slot ${player ? "filled" : ""}`} onClick={() => placePlayer(positionKey)} aria-label={`${label} position`}>
      <span className="squad-role">{label}</span>
      {player ? <><span className="squad-avatar">{player.image ? <img src={player.image} alt="" /> : player.name.split(" ").map((word) => word[0]).join("").slice(0, 2)}</span><span className="squad-rating">{player.rating}</span></> : <span className="squad-empty">+</span>}
    </button>;
  }
  return <div className="squad-panel"><div className="squad-panel-head"><h3>PLAYING XI</h3><span>4–3–3</span></div><div className="pitch squad-pitch"><div className="penalty-box-top" /><div className="penalty-box-bottom" /><div className="pitch-row forward-row"><Position label="ST" positionKey="ST" /></div><div className="pitch-row wing-row"><Position label="LW" positionKey="LW" /><Position label="CAM" positionKey="CAM" /><Position label="RW" positionKey="RW" /></div><div className="pitch-row midfield-row"><Position label="CM" positionKey="CM1" /><Position label="CM" positionKey="CM2" /></div><div className="pitch-row defence-row"><Position label="LB" positionKey="LB" /><Position label="CB" positionKey="CB1" /><Position label="CB" positionKey="CB2" /><Position label="RB" positionKey="RB" /></div><div className="pitch-row keeper-row"><Position label="GK" positionKey="GK" /></div></div><div className="overall"><span>TEAM OVR</span><b>{overall}</b></div></div>;
}
