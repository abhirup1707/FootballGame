import { useEffect, useState } from "react";
import { effectiveRating } from "../lib/position";
import { clubLogoPath, isLaligaCard } from "../lib/card";
import FORMATIONS from "../data/formations.json";

const slotLabel = (slot) => slot.replace(/[0-9]+$/, "");

export default function SquadBoard({
  positions,
  overall,
  readOnly = false,
  onReposition,
  onPickForSlot,
  pickedPlayer,
  onPlaceCard,
  formation,
}) {
  const shape = formation ? FORMATIONS[formation] || FORMATIONS["4-3-3"] : FORMATIONS["4-3-3"];
  const slotCategory = shape.slotCategory;
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

  function Position({ positionKey }) {
    const player = positions[positionKey];
    const canReceive = Boolean(!readOnly && pickedPlayer);
    const category = player ? player.category || player.position : null;
    const effective = player
      ? effectiveRating(player.rating, category, slotCategory[positionKey])
      : null;
    const rating = player ? (player.base_rating ?? player.rating) : null;
    const tier = player
      ? isLaligaCard(player)
        ? "laliga"
        : player.version === "purple" || (rating >= 77 && rating <= 80)
          ? "purple"
          : rating >= 80
            ? "gold"
            : rating >= 70
              ? "silver"
              : "bronze"
      : "";
    const laligaClub = isLaligaCard(player) ? clubLogoPath(player.club) : null;
    return (
      <button
        type="button"
        disabled={readOnly}
        className={`squad-slot ${player ? "filled" : ""} ${
          selectedSlot === positionKey ? "selected" : ""
        } ${canReceive ? "eligible" : ""} ${readOnly ? "locked" : ""} ${
          player ? `squad-tier-${tier}` : ""
        }`}
        onClick={() => selectPosition(positionKey)}
        aria-label={`${slotLabel(positionKey)} position`}
      >
        <span className="squad-role">{slotLabel(positionKey)}</span>
        {player ? (
          <>
            <span className="squad-card">
              {laligaClub && <img className="squad-club-bg" src={laligaClub} alt="" aria-hidden="true" />}
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
              <span className="squad-name">{player.name.split(/\s+/).filter(Boolean).pop()}</span>
              <span className="squad-pos">{player.position || player.category}</span>
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
        <span>{shape.name}</span>
      </div>
      {!readOnly && hint && <p className="squad-swap-hint">{hint}</p>}
      <div className="pitch squad-pitch" style={{ gridTemplateRows: `repeat(${shape.rows.length}, 1fr)` }}>
        <div className="penalty-box-top" />
        <div className="penalty-box-bottom" />
        {shape.rows.slice().reverse().map((row, rowIndex) => (
          <div className="pitch-row" key={rowIndex} style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}>
            {row.map((slot) => (
              <Position key={slot} positionKey={slot} />
            ))}
          </div>
        ))}
      </div>
      <div className="overall">
        <span>TEAM OVR</span>
        <b>{overall}</b>
      </div>
    </div>
  );
}
