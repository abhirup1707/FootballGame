import confetti from "canvas-confetti";

export function fireGoalConfetti() {
  const colors = ["#ffd24a", "#ff6b6b", "#4fe3a0", "#a78bfa", "#3ad8ff"];
  confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 }, colors });
}

export function fireWalkoutConfetti() {
  const duration = 3000;
  const end = Date.now() + duration;
  const colors = ["#ffd24a", "#ff7ee0", "#a78bfa", "#ffffff"];
  (function frame() {
    confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0, y: 0.7 }, colors });
    confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1, y: 0.7 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}

export function fireWinConfetti() {
  const count = 200;
  const defaults = { origin: { y: 0.7 }, colors: ["#ffd24a", "#4fe3a0", "#ff6b6b", "#a78bfa"] };
  function fire(particleRatio, opts) {
    confetti({ ...defaults, particleCount: Math.floor(count * particleRatio), ...opts });
  }
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2, { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  fire(0.1, { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1, { spread: 120, startVelocity: 45 });
}

export function fireSideBurst() {
  confetti({ particleCount: 40, angle: 60, spread: 40, origin: { x: 0, y: 0.5 }, colors: ["#ffd24a", "#ff6b6b"] });
  confetti({ particleCount: 40, angle: 120, spread: 40, origin: { x: 1, y: 0.5 }, colors: ["#4fe3a0", "#a78bfa"] });
}
