export default function PlayerList({ players, pickPlayer }) {
  return (
    <div className="player-list">
      <h2>PLAYERS AVAILABLE</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "15px",
        }}
      >
        {players.map((player) => (
          <div
            key={player.id}
            onClick={() => pickPlayer(player)}
            style={{
              background: "#ffffff",
              border: "2px solid #ddd",
              borderRadius: "18px",
              padding: "18px",
              boxShadow: "0 6px 15px rgba(0,0,0,0.08)",
              cursor: "pointer",
              transition: "0.2s",
            }}
          >
            <div
              style={{
                display: "flex",
                gap: "15px",
                alignItems: "center",
              }}
            >
              <div
                style={{
                  width: "65px",
                  height: "65px",
                  borderRadius: "50%",
                  background: "#4e9b4f",
                  color: "white",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  fontSize: "24px",
                  fontWeight: "bold",
                }}
              >
                {player.rating}
              </div>

              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: "20px",
                    fontWeight: "700",
                  }}
                >
                  {player.name}
                </div>

                <div
                  style={{
                    fontSize: "13px",
                    color: "#666",
                    marginTop: "4px",
                  }}
                >
                  {player.position} • {player.club} • {player.season}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: "15px",
                borderTop: "1px solid #eee",
                paddingTop: "10px",
                display: "flex",
                justifyContent: "space-between",
                fontWeight: "600",
                fontSize: "14px",
              }}
            >
              <span>⚽ {player.goals ?? "-"}</span>
              <span>🎯 {player.assists ?? "-"}</span>
              <span>🛡️ {player.cleanSheets ?? "-"}</span>
              <span>🧤 {player.saves ?? "-"}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}