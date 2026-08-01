export default function MiniSquadBoard({

  positions,

  attackerName,

  defenderName,

}) {

  function Spot({
    player,
  }) {

    const hasBall =
      player?.name ===
      attackerName;

    const defending =
      player?.name ===
      defenderName;

    return (

      <div
        style={{
          position:
            "relative",

          width:
            "42px",

          height:
            "42px",
        }}
      >

        {(hasBall ||
          defending) && (

          <div
            style={{
              position:
                "absolute",

              top:
                "-18px",

              width:
                "100%",

              textAlign:
                "center",

              fontSize:
                "18px",
            }}
          >

            {
              hasBall
                ? "⚽"
                : "🛡"
            }

          </div>

        )}

        <img
          src={
            player?.image
          }
          alt=""
          style={{
            width:
              "50px",

            height:
              "50px",

            borderRadius:
              "50%",

            objectFit:
              "cover",

 border:
  hasBall
    ? "4px solid #22c55e"
    : defending
    ? "4px solid #60a5fa"
    : "2px solid white",

boxShadow:
  hasBall
    ? "0 0 25px #22c55e"
    : defending
    ? "0 0 25px #60a5fa"
    : "none",
            boxShadow:"0 0 12px rgba(255,215,0,.5)",
          }}
        />

      </div>

    );
  }

  return (

    <div
      className="mini-pitch"
    >

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.ST
          }
        />
      </div>

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.LW
          }
        />

        <Spot
          player={
            positions.RW
          }
        />
      </div>

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.CAM
          }
        />
      </div>

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.CM1
          }
        />

        <Spot
          player={
            positions.CM2
          }
        />
      </div>

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.LB
          }
        />

        <Spot
          player={
            positions.CB1
          }
        />

        <Spot
          player={
            positions.CB2
          }
        />

        <Spot
          player={
            positions.RB
          }
        />
      </div>

      <div
        className="mini-row"
      >
        <Spot
          player={
            positions.GK
          }
        />
      </div>

    </div>

  );
}