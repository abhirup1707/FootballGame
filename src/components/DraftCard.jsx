
export default function DraftCard({
  player,
  onPick,
}) {
  return (
    <div
      className="draft-card"
      onClick={() => onPick(player)}
    >
      <div className="card-top">

        <div className="card-rating">
          {player.rating}
        </div>

        <div className="card-main">

          <div className="card-name">
            {player.name}
          </div>

          <div className="card-details">
            {player.position}
            {" • "}
            {player.club}
            {" • "}
            {player.season}
          </div>

        </div>

      </div>

      <div className="card-stats">

        <span>
          ⚽ {player.goals ?? "-"}
        </span>

        <span>
          🎯 {player.assists ?? "-"}
        </span>

        <span>
          🛡️ {player.cleanSheets ?? "-"}
        </span>

        <span>
          🧤 {player.saves ?? "-"}
        </span>

      </div>
    </div>
  );
}

