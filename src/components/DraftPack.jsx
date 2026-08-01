import DraftCard from "./DraftCard";

export default function DraftPack({
  players,
  onPick,
}) {
  return (
    <div className="draft-pack">
      {players.map((player) => (
        <DraftCard
          key={player.id}
          player={player}
          onPick={onPick}
        />
      ))}
    </div>
  );
}