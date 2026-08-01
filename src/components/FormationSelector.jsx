export default function FormationSelector({
  formation,
  setFormation,
}) {
  return (
    <div className="formation-bar">
      <button
        className={
          formation === "4-3-3" ? "active" : ""
        }
        onClick={() => setFormation("4-3-3")}
      >
        4-3-3
      </button>

      <button
        className={
          formation === "4-4-2" ? "active" : ""
        }
        onClick={() => setFormation("4-4-2")}
      >
        4-4-2
      </button>

      <button
        className={
          formation === "3-5-2" ? "active" : ""
        }
        onClick={() => setFormation("3-5-2")}
      >
        3-5-2
      </button>
    </div>
  );
}