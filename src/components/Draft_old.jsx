import socket from "../socket";
import { useEffect, useState } from "react";
import playersData from "../data/playerSeasons.json";
import DraftPack from "./DraftPack";
import SquadBoard from "./SquadBoard";

export default function Draft({ room }) {
  const [pack, setPack] = useState([]);

  const [draftedPlayers, setDraftedPlayers] =
    useState([]);

  const [refreshPenalty, setRefreshPenalty] =
    useState(0);

  const [selectedPlayer, setSelectedPlayer] =
    useState(null);
const [phase, setPhase] =
  useState("draft");
const [readyCount, setReadyCount] =
  useState(0);
const [startCount, setStartCount] =
  useState(0);
const [opponentTeam, setOpponentTeam] =
  useState(null);

const [waiting, setWaiting] =
  useState(false);
const [scoreA, setScoreA] =
  useState(0);
const [openingPack, setOpeningPack] =
  useState(false);

const [showCards, setShowCards] =
  useState(false);
const [scoreB, setScoreB] =
  useState(0);

const [passes, setPasses] =
  useState(0);

const [goalMode, setGoalMode] =
  useState(false);

const [possession, setPossession] =
  useState(null);
  const [commentary, setCommentary] =
  useState("Kick Off!");


  const [shieldUsed, setShieldUsed] =
  useState(false);
  const [winner, setWinner] =
  useState(null);
  const [positions, setPositions] =
    useState({
      GK: null,

      LB: null,
      CB1: null,
      CB2: null,
      RB: null,

      CM1: null,
      CM2: null,
      CAM: null,

      LW: null,
      ST: null,
      RW: null,
    });

useEffect(() => {
  generatePack();

  socket.on(
    "readyCount",
    (count) => {
      setReadyCount(count);
    }
  );

  socket.on(
    "showReveal",
    ({ teams }) => {

      const enemy =
        Object.entries(teams)
          .find(
            ([id]) =>
              id !== socket.id
          );

      if (enemy) {
        setOpponentTeam(
          enemy[1]
        );
      }

      setWaiting(false);
      setPhase("reveal");
    }
  );
socket.on(
  "startCount",
  (count) => {
    setStartCount(count);
  }
);

socket.on(
  "enterMatch",
  (data) => {

    setScoreA(
      data.scoreA
    );

    setScoreB(
      data.scoreB
    );

    setPasses(
      data.passes
    );

    setGoalMode(
      data.goalMode
    );

    setPossession(
      data.possession
    );
    setCommentary(
  data.commentary
);


setShieldUsed(
  data.shieldUsed
);
    setPhase("match");
  }
);
socket.on(
  "matchUpdate",
  (data) => {

    setScoreA(
      data.scoreA
    );

    setScoreB(
      data.scoreB
    );

    setPasses(
      data.passes
    );

    setGoalMode(
      data.goalMode
    );

    setPossession(
      data.possession
    );
    setCommentary(
  data.commentary
);


    setShieldUsed(
  data.shieldUsed
);
  }
);
socket.on(
  "matchFinished",
  (data) => {

    setScoreA(
      data.scoreA
    );

    setScoreB(
      data.scoreB
    );

    if (
      data.scoreA >
      data.scoreB
    ) {
      setWinner(
        room.players[0]?.name
      );
    } else {
      setWinner(
        room.players[1]?.name
      );
    }

    setPhase(
      "finished"
    );
  }
);

return () => {
  socket.off("readyCount");
  socket.off("showReveal");
  socket.off("startCount");

  socket.off("enterMatch");
  socket.off("matchUpdate");
  socket.off("matchFinished");
};
}, []);

  function generatePack() {
    const availablePlayers =
      playersData.filter(
        (player) =>
          !draftedPlayers.some(
            (p) => p.name === player.name
          )
      );

    const uniquePlayers = [];

    const usedNames = new Set();

    availablePlayers.forEach((player) => {
      if (!usedNames.has(player.name)) {
        usedNames.add(player.name);
        uniquePlayers.push(player);
      }
    });

    const shuffled = [...uniquePlayers]
      .sort(() => Math.random() - 0.5)
      .slice(0, 5);

    setPack(shuffled);
  }

  function refreshPack() {
    generatePack();

    setRefreshPenalty(
      (prev) => prev + 0.5
    );
  }

  function pickPlayer(player) {
    const updated = [
      ...draftedPlayers,
      player,
    ];

    setDraftedPlayers(updated);

    if (updated.length < 14) {
      const availablePlayers =
        playersData.filter(
          (p) =>
            !updated.some(
              (dp) =>
                dp.name === p.name
            )
        );

      const shuffled =
        availablePlayers
          .sort(
            () => Math.random() - 0.5
          )
          .slice(0, 5);

      setPack(shuffled);
    } else {
      setPack([]);
    }
  }

  function assignPlayer(positionKey) {
    if (!selectedPlayer) return;

    const newPositions = {
      ...positions,
    };

    Object.keys(newPositions).forEach(
      (key) => {
        if (
          newPositions[key]?.id ===
          selectedPlayer.id
        ) {
          newPositions[key] = null;
        }
      }
    );

    newPositions[positionKey] =
      selectedPlayer;

    setPositions(newPositions);
  }

  function autoBuildTeam() {
  const sorted = [...draftedPlayers]
    .sort((a, b) => b.rating - a.rating);

  const team = {
    GK: null,

    LB: null,
    CB1: null,
    CB2: null,
    RB: null,

    CM1: null,
    CM2: null,
    CAM: null,

    LW: null,
    ST: null,
    RW: null,
  };

  const used = new Set();

  function take(posList) {
    const player = sorted.find(
      (p) =>
        !used.has(p.id) &&
        posList.includes(
          p.position
        )
    );

    if (player) {
      used.add(player.id);
    }

    return player || null;
  }

  team.GK = take(["GK"]);

  team.LB = take(["LB", "CB"]);

  team.CB1 = take(["CB"]);
  team.CB2 = take(["CB"]);

  team.RB = take(["RB", "CB"]);

  team.CM1 = take([
    "CM",
    "CDM",
    "CAM",
  ]);

  team.CM2 = take([
    "CM",
    "CDM",
    "CAM",
  ]);

  team.CAM = take([
    "CAM",
    "CM",
  ]);

  team.LW = take([
    "LW",
    "RW",
    "ST",
  ]);

  team.ST = take([
    "ST",
    "CF",
  ]);

  team.RW = take([
    "RW",
    "LW",
    "ST",
  ]);

  setPositions(team);
}

const playingXI =
  Object.values(positions).filter(
    Boolean
  );

  const baseOverall =
    playingXI.length === 0
      ? 0
      : playingXI.reduce(
          (sum, player) =>
            sum + player.rating,
          0
        ) / playingXI.length;

  const overall = Number(
    Math.max(
      0,
      baseOverall - refreshPenalty
    ).toFixed(1)
  );

  const allPositionsFilled =
    Object.values(positions).every(
      (pos) => pos !== null
    );
    if (waiting) {
  return (
    <div
      style={{
        padding: "50px",
        textAlign: "center",
      }}
    >
      <h1>
        Waiting For Opponent...
      </h1>

      <h2>
        Ready Players:
        {readyCount}/2
      </h2>
    </div>
  );
}
if (
  phase ===
  "waitingStart"
) {
  return (
    <div
      style={{
        textAlign:
          "center",
        marginTop:
          "100px",
      }}
    >
      <h1>
        Waiting To Start
      </h1>

      <h2>
        {startCount}/2
      </h2>
    </div>
  );
}

if (phase === "match") {

  return (
    <div
      style={{
        textAlign: "center",
        padding: "40px",
      }}
    >
      <h1>
        ⚽ MATCH
      </h1>

      <h1>
  {room.players[0]?.name}
  {" "}
  {scoreA}
  {" - "}
  {scoreB}
  {" "}
  {room.players[1]?.name}
</h1>

      <h2>
        Passes: {passes}/6
      </h2>
      {!shieldUsed &&
 possession === socket.id && (
  <h3
    style={{
      color: "gold",
    }}
  >
    🛡 Shield Available
  </h3>
)}
<h2
  style={{
    color:
      possession === socket.id
        ? "green"
        : "red",
  }}
>
  {possession === socket.id
    ? "⚽ YOUR POSSESSION"
    : "🛡️ DEFENDING"}
</h2>
      <h2>
        {goalMode
          ? "⚽ SHOOT"
          : "🔄 PASS"}
      </h2>

      {!goalMode ? (

        <div>

          {[1, 2, 3, 4].map(
            (num) => (
              <button
                key={num}
                onClick={() =>
                  socket.emit(
                    "submitChoice",
                    {
                      roomCode:
                        room.roomCode,
                      number: num,
                    }
                  )
                }
                style={{
                  width: "80px",
                  height: "80px",
                  fontSize: "28px",
                  margin: "10px",
                  cursor: "pointer",
                }}
              >
                {num}
              </button>
            )
          )}

        </div>

      ) : (

        <div>

          {[5, 6].map(
            (num) => (
              <button
                key={num}
                onClick={() =>
                  socket.emit(
                    "submitChoice",
                    {
                      roomCode:
                        room.roomCode,
                      number: num,
                    }
                  )
                }
                style={{
                  width: "120px",
                  height: "120px",
                  fontSize: "40px",
                  margin: "15px",
                  cursor: "pointer",
                }}
              >
                {num}
              </button>
            )
          )}

        </div>

      )}

    </div>
  );
}
if (phase === "reveal") {
  return (
    <div
      style={{
        padding: "30px",
      }}
    >
      <h1>
        TEAM REVEAL
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: "30px",
        }}
      >
        <div>
          <h2>
            Your Team
          </h2>

          {Object.values(positions)
            .filter(Boolean)
            .map((player) => (
              <div
                key={player.id}
              >
                {player.name}
                {" - "}
                {player.position}
              </div>
            ))}
        </div>

  <div>
  <h2>
    Opponent Team
  </h2>

  {opponentTeam ? (
    Object.values(
      opponentTeam.positions
    )
      .filter(Boolean)
      .map((player) => (
        <div key={player.id}>
          {player.name}
          {" - "}
          {player.position}
        </div>
      ))
  ) : (
    <p>
      Waiting for opponent team...
    </p>
  )}
</div>
      </div>

      <button
       onClick={() => {

  setPhase(
    "waitingStart"
  );

  socket.emit(
    "playerStartedMatch",
    {
      roomCode:
        room.roomCode,
    }
  );
}}
        style={{
          marginTop: "30px",
          padding:
            "12px 25px",
        }}
      >
        START MATCH
      </button>
    </div>
  );
}
if (
  phase ===
  "finished"
) {
  return (
    <div
      style={{
        textAlign: "center",
        marginTop: "100px",
      }}
    >
      <h1>
        🏆 FULL TIME
      </h1>

      <h1>
        {scoreA} - {scoreB}
      </h1>

      <h2>
        Winner:
        {" "}
        {winner}
      </h2>
    </div>
  );
}


  return (
    <div
      style={{
        width: "95%",
        margin: "20px auto",
      }}
    >
      <h1>⚽ Draft Room</h1>

      <h2>
        {room.players[0]?.name}
        {" VS "}
        {room.players[1]?.name}
      </h2>

      <div className="draft-layout">
        <div className="draft-left">
          {draftedPlayers.length < 14 ? (
            <>
  <h3>
    Choose Player (
    {draftedPlayers.length}
    /14)
  </h3>

  <button
    onClick={refreshPack}
    style={{
      padding: "10px 18px",
      marginBottom: "15px",
      borderRadius: "8px",
      cursor: "pointer",
      fontWeight: "bold",
    }}
  >
    🔄 Refresh Pack
  </button>

  <div
    style={{
      marginBottom: "15px",
      fontWeight: "bold",
      color: "red",
    }}
  >
    Refresh Penalty:
    {" "}
    -{refreshPenalty.toFixed(1)}
  </div>

  <DraftPack
    players={pack}
    onPick={pickPlayer}
  />
</>
         ) : (
  <>
  <h2>
    Team Complete ✅
  </h2>

  {!allPositionsFilled ? (
    <h3
      style={{
        color: "red",
        marginTop: "20px",
      }}
    >
      Fill all 11 positions first
    </h3>
  ) : (
    <button
    onClick={() => {

  setWaiting(true);

  socket.emit(
    "playerReady",
    {
      roomCode:
        room.roomCode,

      positions,

      overall,
    }
  );
  
}}
      style={{
        padding: "12px 25px",
        fontSize: "18px",
        cursor: "pointer",
        marginTop: "20px",
        borderRadius: "10px",
        border: "none",
        background: "#4e9b4f",
        color: "white",
        fontWeight: "bold",
      }}
    >
      READY
    </button>
  )}
</>
)}
        </div>

        <div className="draft-right">
         <>
  <button
    onClick={autoBuildTeam}
    style={{
      width: "100%",
      padding: "12px",
      marginBottom: "15px",
      background: "#1f7a1f",
      color: "white",
      border: "none",
      borderRadius: "10px",
      cursor: "pointer",
      fontWeight: "bold",
      fontSize: "16px",
    }}
  >
    ⚡ Auto Build XI
  </button>

  <SquadBoard
    positions={positions}
    draftedPlayers={draftedPlayers}
    selectedPlayer={selectedPlayer}
    setSelectedPlayer={setSelectedPlayer}
    assignPlayer={assignPlayer}
    overall={overall}
  />
</>
        </div>
      </div>
    </div>
  );
}

