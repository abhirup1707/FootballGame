import { useMusic } from "../music";

export default function MusicToggle() {
  const { on, volume, setVolume, toggle } = useMusic();

  return (
    <div className="music-toggle">
      <button
        className={`music-btn ${on ? "music-on" : ""}`}
        onClick={toggle}
        aria-label={on ? "Mute music" : "Play music"}
        title={on ? "Mute music" : "Play music"}
      >
        {on ? "🔊" : "🔇"}
      </button>
      {on && (
        <input
          className="music-vol"
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Music volume"
        />
      )}
    </div>
  );
}
