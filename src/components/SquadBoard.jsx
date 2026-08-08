import { useEffect, useState } from "react";
import { slotCategory, effectiveRating } from "../lib/position";

export default function SquadBoard({
  positions,
  overall,
  readOnly = false,
  onReposition,
  onPickForSlot,
  pickedPlayer,
  onPlaceCard,
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const selectedPlayer = selectedSlot ? positions[selectedSlot] : null;

  useEffect(() => {
    setSelectedSlot(null);
  }, [positions]);

  const selectPosition = (positionKey) => {
    if (readOnly) return;
    // Player-first flow: a card from the rack is picked, so tapping any slot
    // places (or swaps) that player into it.
    if (pickedPlayer && onPlaceCard) return onPlaceCard(positionKey);
    if (onPickForSlot && !onReposition) return onPickForSlot(positionKey);
    if (positionKey === "GK") return;
    const targetPlayer = positions[positionKey];
    if (!selectedSlot) {
      if (targetPlayer) setSelectedSlot(positionKey);
      return;
    }
    if (selectedSlot === positionKey) return setSelectedSlot(null);
    if (!selectedPlayer || slotCategory[positionKey] !== selectedPlayer.position)
      return;
    onReposition(selectedSlot, positionKey);
    setSelectedSlot(null);
  };

  function Position({ label, positionKey }) {
    const player = positions[positionKey];
    const canReceive = Boolean(!readOnly && pickedPlayer);
    const category = player ? player.category || player.position : null;
    const effective = player
      ? effectiveRating(player.rating, category, slotCategory[positionKey])
      : null;
    return (
      <button
        type="button"
        disabled={readOnly}
        className={`squad-slot ${player ? "filled" : ""} ${
          selectedSlot === positionKey ? "selected" : ""
        } ${canReceive ? "eligible" : ""} ${readOnly ? "locked" : ""}`}
        onClick={() => selectPosition(positionKey)}
        aria-label={`${label} position`}
      >
        <span className="squad-role">{label}</span>
        {player ? (
          <>
            <span className="squad-avatar">
              {player.image ? (
                <img src={player.image} alt="" />
              ) : (
                player.name
                  .split(" ")
                  .map((word) => word[0])
                  .join("")
                  .slice(0, 2)
              )}
            </span>
            <span className="squad-rating">{effective}</span>
          </>
        ) : (
          <span className="squad-empty">+</span>
        )}
      </button>
    );
  }

  let hint;
  if (readOnly) hint = null;
  else if (pickedPlayer && onPlaceCard)
    hint = `Tap a slot to put ${pickedPlayer.name} in — anyone it replaces returns to your rack.`;
  else if (onPickForSlot && !onReposition)
    hint = "Tap a slot to pick a player — or select a player below first, then tap a slot to swap them in.";
  else if (selectedPlayer)
    hint = `Move ${selectedPlayer.name} to a highlighted ${
      selectedPlayer.position === "ATT"
        ? "forward"
        : selectedPlayer.position === "MID"
          ? "midfield"
          : "defence"
    } spot.`;
  else hint = "Tap a player, then an empty spot or teammate to move or swap.";

  return (
    <div className="squad-panel">
      <div className="squad-panel-head">
        <h3>PLAYING XI</h3>
        <span>4–3–3</span>
      </div>
      {!readOnly && hint && <p className="squad-swap-hint">{hint}</p>}
      <div className="pitch squad-pitch">
        <div className="penalty-box-top" />
        <div className="penalty-box-bottom" />
        <div className="pitch-row forward-row">
          <Position label="ST" positionKey="ST" />
        </div>
        <div className="pitch-row wing-row">
          <Position label="LW" positionKey="LW" />
          <Position label="CAM" positionKey="CAM" />
          <Position label="RW" positionKey="RW" />
        </div>
        <div className="pitch-row midfield-row">
          <Position label="CM" positionKey="CM1" />
          <Position label="CM" positionKey="CM2" />
        </div>
        <div className="pitch-row defence-row">
          <Position label="LB" positionKey="LB" />
          <Position label="CB" positionKey="CB1" />
          <Position label="CB" positionKey="CB2" />
          <Position label="RB" positionKey="RB" />
        </div>
        <div className="pitch-row keeper-row">
          <Position label="GK" positionKey="GK" />
        </div>
      </div>
      <div className="overall">
        <span>TEAM OVR</span>
        <b>{overall}</b>
      </div>
    </div>
  );
}
