const express = require("express");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");
const cors = require("cors");
const { Server } = require("socket.io");
const routes = require("./routes");
const { db } = require("./db");
const { resolveMatchRewards } = require("./economy");
const { userByToken } = require("./auth");
const { computeOVR, effectiveStats, positionPenalty } = require("./ovr");
const { DRAFT_POOL } = require("./draftPool");
const { buildAiTeam, AI_DIFFICULTIES, AI_NAMES, AI_READ_RATE, AI_ATTACK_SMART } = require("./ai");
const { markOnline, markOffline, socketIdsFor } = require("./presence");

// How many pass options each side sees in Vs AI matches: [user, cpu].
// Vs Friends always uses 3 for both.
const AI_PASS_OPTIONS = { easy:{ user:5, ai:3 }, medium:{ user:3, ai:3 }, hard:{ user:5, ai:5 }, extreme:{ user:3, ai:5 } };

// Rooms live in memory, so an uncaught exception inside one socket handler
// would take every active match down with it. Log and keep the process alive;
// the per-move timeouts below recover the room from the bad state.
process.on("uncaughtException", (err) => console.error("Uncaught exception:", err && err.stack || err));
process.on("unhandledRejection", (reason) => console.error("Unhandled rejection:", reason));

const app = express();
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim().replace(/\/+$/, "")).filter(Boolean)
  : "*";
const corsOptions = { origin: allowedOrigins };

app.use(cors(corsOptions));
app.use(express.json());
app.use("/api", routes);
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
const rooms = {};
// Each manager drafts an 11-man starting XI matching the formation they chose
// at the start of the draft (22 total picks, one per player per turn).
const FORMATIONS = require(path.join(__dirname, "..", "src", "data", "formations.json"));
const DEFAULT_FORMATION = "4-3-3";
const DRAFT_ORDER = ["ATT", "MID", "DEF", "GK"];
const DRAFT_TOTAL = 22;
const STARTER_COUNT = 11;
const PITCH_COORDINATES = Object.fromEntries(Object.values(FORMATIONS).flatMap((formation) => Object.entries(formation.coords)));
const FORMATION_CATEGORY = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };
function formationOf(room, playerId) { return FORMATIONS[room.draft?.formations?.[playerId]] || FORMATIONS[DEFAULT_FORMATION]; }
// The category the given manager still needs to draft for their formation, in a
// fixed order (attackers first, keeper last) so the pack always matches their XI.
function nextNeeded(formation, picks) {
  const counts = { ATT: formation.att, MID: formation.mid, DEF: formation.def, GK: 1 };
  for (const category of DRAFT_ORDER) {
    if ((picks || []).filter((player) => player.position === category).length < counts[category]) return category;
  }
  return null;
}
const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MOVE_TIMEOUT = 7000;
const PENALTY_TIMEOUT = 10000;
// Stat-duel helpers: aggregate two stamina-adjusted stats into one "ability"
// number so every card's six stats can tilt a resolution. Missing stats fall
// back to the player's rating so both draft legends (1-99) and catalog cards
// (60-75) resolve on the same relative scale.
const statAbility = (player, keyA, keyB) => { if (!player) return 60; const s = effectiveStats(player, player.stamina || 100); return ((s[keyA] || player.rating || 60) + (s[keyB] || player.rating || 60)) / 2; };
const effectiveStat = (player, key) => { if (!player) return 60; const s = effectiveStats(player, player.stamina || 100); return s[key] || player.rating || 60; };
function cardPayload(card) {
  return { id: card.id, name: card.name, season: card.season, club: card.club, position: card.category, rating: card.base_rating, tier: card.tier, image: card.image, pace: card.pace, shooting: card.shooting, passing: card.passing, dribbling: card.dribbling, defending: card.defending, physicality: card.physicality };
}
// A joined owned_cards row converted into the same shape the match engine uses.
function ownedPlayer(row) {
  return { id: row.id, name: row.name, season: row.season, club: row.club, position: row.category, rating: row.rating, tier: row.tier, image: row.image, pace: row.pace, shooting: row.shooting, passing: row.passing, dribbling: row.dribbling, defending: row.defending, physicality: row.physicality, owned: true };
}
function validLineup(room, playerId, positions) {
  const drafted = room.draft.picks[playerId] || [];
  if (!positions || drafted.length < STARTER_COUNT) return false;
  const slotCategory = formationOf(room, playerId).slotCategory;
  const draftedById = new Map(drafted.map((player) => [player.id, player]));
  const usedIds = new Set();
  return Object.entries(slotCategory).every(([slot, category]) => {
    const player = positions[slot], draftedPlayer = player && draftedById.get(player.id);
    if (!draftedPlayer || draftedPlayer.position !== category || usedIds.has(player.id)) return false;
    usedIds.add(player.id);
    return true;
  }) && usedIds.size === STARTER_COUNT;
}
function buildTeam(positions) {
  const copy = {};
  for (const [slot, player] of Object.entries(positions)) {
    copy[slot] = player ? { ...player, stamina: 100 } : null;
  }
  return copy;
}
function pickKickoff(room) {
  const [first, second] = room.players.map((player) => player.id);
  const chance = clamp(50 + (room.teams[first].overall - room.teams[second].overall) * 3, 25, 75);
  return Math.random() * 100 < chance ? first : second;
}
function movePlayerState(room, previousId, nextId) {
  if (previousId === nextId) return;
  const moveKey = (object) => { if (object && Object.prototype.hasOwnProperty.call(object, previousId)) { object[nextId] = object[previousId]; delete object[previousId]; } };
  if (room.draft.turnId === previousId) room.draft.turnId = nextId;
  moveKey(room.draft.picks); moveKey(room.teams); moveKey(room.stats);
  if (room.possession === previousId) room.possession = nextId;
  if (room.match?.choices) moveKey(room.match.choices);
  if (room.shootout) {
    if (room.shootout.currentTeam === previousId) room.shootout.currentTeam = nextId;
    moveKey(room.shootout.kicks); moveKey(room.shootout.usedShooters); moveKey(room.shootout.choices);
    room.shootout.order = room.shootout.order.map((id) => id === previousId ? nextId : id);
  }
}

function draftPayload(room) {
  const turnId = room.draft.turnId;
  return { turnId, round:room.draft.round, category:room.draft.round < DRAFT_TOTAL ? nextNeeded(formationOf(room, turnId), room.draft.picks[turnId]) : null, picks:room.draft.picks, complete:room.draft.round >= DRAFT_TOTAL, formations:room.draft.formations || {} };
}
function sendDraftState(room) { io.to(room.roomCode).emit("draftState", draftPayload(room)); }
function teamName(room, teamId) { return `${room.players.find((player) => player.id === teamId)?.name || "Unknown"}'s team`; }
function playerPosition(team, playerId) { return Object.keys(team.positions).find((key) => team.positions[key]?.id === playerId); }
function passOptions(room) {
  if (room.match.phase !== "PASS" || !room.match.carrier) return [];
  const team = room.teams[room.possession];
  const carrierPosition = playerPosition(team, room.match.carrier.id);
  const [carrierX, carrierY] = PITCH_COORDINATES[carrierPosition] || [50, 50];
  // Vs AI matches use an asymmetric option count per difficulty (how many passes
  // the human sees vs how many the CPU sees). Vs Friends keeps the classic three
  // for both sides.
  const preset = room.ai ? AI_PASS_OPTIONS[room.ai.difficulty] : null;
  const optionCount = preset ? (room.possession === room.ai.id ? preset.ai : preset.user) : 3;
  return Object.entries(team.positions)
    .filter(([position, player]) => player && position !== carrierPosition)
    .map(([position, player]) => {
      const [x, y] = PITCH_COORDINATES[position] || [50, 50];
      return { player, distance:(x - carrierX) ** 2 + (y - carrierY) ** 2 };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, optionCount)
    .map(({ player }) => player);
}
function matchPayload(room) {
  const options = passOptions(room);
  // Keep penalty directions secret until both players have made their choice.
  const shootout = room.shootout ? { ...room.shootout, choices:{} } : null;
  return { teams:room.teams, scoreA:room.scoreA, scoreB:room.scoreB, possession:room.possession, commentary:room.commentary, stats:room.stats,
    config:{ mode:room.matchMode, goalLimit:room.goalLimit, timeLimit:room.timeLimit }, elapsedMs:Math.max(0, Date.now() - (room.matchStartedAt || Date.now())),
    shootout,
    match: { phase:room.match.phase, passCount:room.match.passCount, carrier:room.match.carrier, lastPass:room.match.lastPass || null, options, choicesLocked:Object.keys(room.match.choices).length, deadline:room.match.deadline || null, deadlineLeft:room.match.deadline ? Math.max(0, room.match.deadline - Date.now()) : null } };
}
function sendMatch(room, event = "matchUpdate") { io.to(room.roomCode).emit(event, matchPayload(room)); }
function finishMatch(room) {
  if (room.finished) return;
  room.finished = true;
  if (room.timer) clearInterval(room.timer);
  let rewards = {};
  try { rewards = resolveMatchRewards(room); } catch (error) { console.error(`[match] reward grant failed for room ${room.roomCode}:`, error.message); }
  io.to(room.roomCode).emit("matchFinished", { scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats, shootout:room.shootout || null, rewards });
  const [pA, pB] = room.players;
  if (pA?.userId && pB?.userId) {
    let winnerId = null;
    if (room.scoreA > room.scoreB) winnerId = pA.userId;
    else if (room.scoreB > room.scoreA) winnerId = pB.userId;
    else if (room.shootout) {
      const sA = (room.shootout.kicks[pA.id] || []).filter(Boolean).length;
      const sB = (room.shootout.kicks[pB.id] || []).filter(Boolean).length;
      if (sA > sB) winnerId = pA.userId;
      else if (sB > sA) winnerId = pB.userId;
    }
    try { db.prepare("INSERT INTO match_history (player_a_id, player_b_id, score_a, score_b, winner_id) VALUES (?, ?, ?, ?, ?)").run(pA.userId, pB.userId, room.scoreA, room.scoreB, winnerId); } catch (e) { console.error("[match] failed to record history:", e.message); }
  }
}
function shootoutScore(room, id) { return room.shootout.kicks[id].filter(Boolean).length; }
function startShootout(room) {
  const [first, second] = room.players.map((player) => player.id);
  const order = room.teams[first].overall >= room.teams[second].overall ? [first, second] : [second, first];
  room.shootout = { order, currentTeam:order[0], phase:"SELECT", deadline:Date.now() + PENALTY_TIMEOUT, kicks:{ [first]:[], [second]:[] }, usedShooters:{ [first]:[], [second]:[] }, selectedShooter:null, choices:{}, result:null };
  room.match = { phase:"PENALTY", passCount:0, carrier:null, choices:{} };
  addStory(room, `Penalty shootout! ${room.players.find((p) => p.id === order[0]).name} start because of their higher OVR.`);
  sendMatch(room, "penaltyStarted");
  aiShootoutTick(room);
}
function advanceShootout(room) {
  const shootout = room.shootout, [first, second] = shootout.order;
  const kicksA = shootout.kicks[first].length, kicksB = shootout.kicks[second].length;
  const scoreA = shootoutScore(room, first), scoreB = shootoutScore(room, second);
  // Stop as soon as the trailing team cannot equal the leader with its remaining
  // regulation penalties (e.g. 4–2 after four kicks each).
  if (scoreA > scoreB + (5 - kicksB) || scoreB > scoreA + (5 - kicksA)) return finishMatch(room);
  if (kicksA === kicksB && kicksA >= 5 && shootoutScore(room, first) !== shootoutScore(room, second)) return finishMatch(room);
  const currentIndex = shootout.order.indexOf(shootout.currentTeam);
  shootout.currentTeam = shootout.order[(currentIndex + 1) % 2];
  shootout.phase = "SELECT"; shootout.selectedShooter = null; shootout.choices = {}; shootout.result = null;
  shootout.deadline = Date.now() + PENALTY_TIMEOUT;
  sendMatch(room);
  aiShootoutTick(room);
}
function resolvePenalty(room) {
  const shootout = room.shootout, attackId = shootout.currentTeam, defendId = room.players.find((p) => p.id !== attackId).id;
  const shot = shootout.choices[attackId], dive = shootout.choices[defendId];
  const shooter = shootout.selectedShooter, keeper = room.teams[defendId].positions.GK;
  const shooterName = shooter?.name || "Unknown", keeperName = keeper?.name || "the keeper";
  const goal = shot !== dive;
  if (!goal) room.stats[defendId].saves += 1;
  shootout.kicks[attackId].push(goal); shootout.result = { attackId, shooter, keeper, shot, dive, goal };
  shootout.phase = "RESULT";
  shootout.deadline = null;
  addStory(room, goal ? `GOAL! ${shooterName} sends ${keeperName} the wrong way.` : `SAVED! ${keeperName} reads the penalty.`);
  sendMatch(room, "penaltyResult");
  setTimeout(() => { if (!room.finished && room.shootout?.phase === "RESULT") advanceShootout(room); }, 1900);
}
function startMatchClock(room) {
  room.matchStartedAt = Date.now();
  room.timer = setInterval(() => {
    if (room.finished) return;
    if (room.shootout) {
      resolveShootoutTick(room);
      return;
    }
    const elapsed = Date.now() - room.matchStartedAt;
    if (room.matchMode === "time" && elapsed >= (room.timeLimit || 90) * 1000) {
      if (room.scoreA === room.scoreB) startShootout(room); else finishMatch(room);
    } else {
      if ((room.match?.phase === "PASS" || room.match?.phase === "GOAL") && room.match.deadline && Date.now() >= room.match.deadline && Object.keys(room.match.choices).length < 2) {
        autoPickMoves(room);
        return;
      }
      sendMatch(room);
    }
  }, 250);
}
// The shootout has no per-move clock of its own, so the match heartbeat enforces
// one: nobody can stall the shootout forever by never picking a taker/dive.
function resolveShootoutTick(room) {
  const shootout = room.shootout;
  if (!shootout || !shootout.deadline || Date.now() < shootout.deadline) return;
  if (shootout.phase === "SELECT" && shootout.currentTeam !== room.ai?.id) {
    const team = room.teams[shootout.currentTeam]?.positions || {};
    shootout.usedShooters[shootout.currentTeam] = shootout.usedShooters[shootout.currentTeam] || [];
    const candidates = Object.values(team).filter((player) => player && player.position !== "GK" && !shootout.usedShooters[shootout.currentTeam].includes(player.id));
    if (!candidates.length) return;
    candidates.sort((a, b) => b.rating - a.rating);
    shootout.usedShooters[shootout.currentTeam].push(candidates[0].id);
    shootout.selectedShooter = candidates[0];
    shootout.phase = "DUEL"; shootout.choices = {}; shootout.deadline = Date.now() + PENALTY_TIMEOUT;
    addStory(room, `⏰ Time up — ${candidates[0].name} steps up for the penalty.`);
    sendMatch(room);
    return;
  }
  if (shootout.phase === "DUEL" && Object.keys(shootout.choices).length < 2) {
    const defendId = room.players.find((p) => p.id !== shootout.currentTeam)?.id;
    if (!defendId) return;
    for (const id of [shootout.currentTeam, defendId]) {
      if (shootout.choices[id] === undefined) shootout.choices[id] = room.ai && id === room.ai.id ? aiPenaltyDirection(room) : randomItem(["LEFT", "CENTER", "RIGHT"]);
    }
    addStory(room, "⏰ Time up — a penalty direction was chosen automatically.");
    resolvePenalty(room);
  }
}
function addStory(room, line) { room.commentary.unshift(line); room.commentary = room.commentary.slice(0, 5); }
function startPossession(room, teamId, story, carrier) {
  if (room.finished) return;
  room.possession = teamId;
  const team = room.teams[teamId];
  const openingCarrier = carrier || room.nextKickoffCarrier || randomItem([team.positions.CB1, team.positions.CB2].filter(Boolean));
  delete room.nextKickoffCarrier;
  room.match = { phase:"PASS", passCount:0, carrier:openingCarrier, choices:{}, deadline:Date.now() + MOVE_TIMEOUT };
  if (story) addStory(room, story);
  ensureAiChoice(room);
}
function closestDefender(room, defendId, receiver) {
  const receiverPosition = playerPosition(room.teams[room.possession], receiver.id);
  const [receiverX, receiverY] = PITCH_COORDINATES[receiverPosition] || [50, 50];
  return Object.entries(room.teams[defendId].positions)
    .filter(([, player]) => player)
    .map(([position, player]) => {
      const [x, rawY] = PITCH_COORDINATES[position] || [50, 50];
      return { player, distance:(x - receiverX) ** 2 + ((100 - rawY) - receiverY) ** 2 };
    })
    .sort((a, b) => a.distance - b.distance)[0]?.player;
}
function highestRatedPlayer(team) {
  return Object.values(team.positions).filter(Boolean).sort((a, b) => b.rating - a.rating)[0];
}
function midfieldKickoffPlayer(team) {
  return [team.positions.CM1, team.positions.CM2, team.positions.CAM].filter(Boolean).sort((a, b) => b.rating - a.rating)[0] || highestRatedPlayer(team);
}
function averageDefence(team) {
  const players = [team.positions.GK, team.positions.LB, team.positions.CB1, team.positions.CB2, team.positions.RB].filter(Boolean);
  if (!players.length) return 60;
  return players.reduce((sum, player) => sum + effectiveStats(player, player.stamina).defending, 0) / players.length;
}
function beginInterception(room, defendId, receiver, interceptor, story) {
  room.match.choices = {};
  room.match.deadline = Date.now() + MOVE_TIMEOUT;
  if (!interceptor) return;
  room.stats[defendId].interceptions += 1;
  room.match.phase = "INTERCEPTION";
  room.match.interception = { receiver, interceptor };
  addStory(room, story);
  sendMatch(room);
  io.to(room.roomCode).emit("interceptionMade", { interceptor:interceptor.name, receiver:receiver.name });
  setTimeout(() => {
    if (room.finished) return;
    if (room.match?.phase !== "INTERCEPTION") return;
    startPossession(room, defendId, `${room.players.find((p) => p.id === defendId).name} begin a new five-pass move with ${interceptor.name}.`, interceptor);
    sendMatch(room);
  }, 1050);
}
// A dribble-past/beat-the-press outcome: the pass survives a correctly read
// mark, or an unmarked pass survives a press, and the move continues.
function completePass(room, attackId, defendId, carrier, receiver, story) {
  room.match.choices = {};
  room.match.deadline = Date.now() + MOVE_TIMEOUT;
  room.match.carrier = receiver;
  room.match.passCount += 1;
  room.stats[attackId].passes += 1;
  room.match.lastPass = { team:teamName(room, attackId), passer:carrier.name, receiver:receiver.name };
  addStory(room, story);
  if (room.match.passCount >= 5) {
    room.match.phase = "GOAL";
    addStory(room, `⚡ FIVE PASSES COMPLETE — ${receiver.name} has the final chance!`);
  }
  if (room.ai && room.possession === room.ai.id) ensureAiChoice(room);
}
function resolvePass(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const choice = room.match.choices[attackId];
  const markedId = room.match.choices[defendId];
  if (choice === "LONG_SHOT") return resolveLongShot(room);
  const receiver = passOptions(room).find((player) => player.id === choice);
  if (!receiver) return;
  const carrier = room.match.carrier;
  const interceptor = closestDefender(room, defendId, receiver);
  // Reading the pass correctly means the defender has the ball. No stat roll —
  // a correct read is always an interception.
  if (markedId === receiver.id && interceptor) {
    beginInterception(room, defendId, receiver, interceptor, `INTERCEPTED! ${interceptor.name} reads ${carrier.name}'s pass to ${receiver.name} and wins the ball.`);
    return;
  }
  // Unmarked pass: completes most of the time, but a press can force a loose
  // ball out of a sloppy passer.
  if (markedId !== receiver.id) {
    let turnover = clamp(0.1 - (effectiveStat(carrier, "passing") - statAbility(interceptor, "defending", "pace")) * 0.004, 0.02, 0.2);
    if (markedId === "PRESS") turnover += 0.06;
    if (interceptor && Math.random() * 100 < turnover * 100) {
      beginInterception(room, defendId, receiver, interceptor, `⚠️ ${interceptor.name} pressures ${carrier.name} into a loose pass — intercepted!`);
      return;
    }
    completePass(room, attackId, defendId, carrier, receiver, `⚽ ${teamName(room, attackId)}: ${carrier.name} passes to ${receiver.name} — finds space.`);
    return;
  }
  completePass(room, attackId, defendId, carrier, receiver, `⚽ ${teamName(room, attackId)}: ${carrier.name} passes to ${receiver.name}.`);
}
function resolveLongShot(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const shooter = room.match.carrier;
  const keeper = room.teams[defendId].positions.GK;
  const pressed = room.match.choices[defendId] === "PRESS";
  // A long shot skips the five-pass build-up, so it lands far less often than a
  // set-up shot. Pressing closes the space hard; a hot striker and a flowing
  // move (passCount) nudge the odds back up.
  const base = pressed ? 0.2 : 0.28;
  const goalChance = clamp(base + (effectiveStat(shooter, "shooting") - statAbility(keeper, "defending", "physicality")) * 0.004 + (room.match.passCount / 10) * 0.04, 0.08, 0.5);
  const keeperName = keeper?.name || "the keeper";
  room.match.choices = {};
  if (Math.random() * 100 < goalChance * 100) {
    if (attackId === room.players[0].id) room.scoreA += 1; else room.scoreB += 1;
    room.stats[attackId].goals.push(shooter.name);
    addStory(room, `🚀 GOAL FROM DISTANCE! ${shooter.name} unleashes a rocket past ${keeperName}${pressed ? " despite the press" : ""}.`);
    if (room.matchMode === "goals" && (room.scoreA >= room.goalLimit || room.scoreB >= room.goalLimit)) {
      sendMatch(room);
      finishMatch(room);
      return;
    }
    room.match.phase = "CELEBRATE";
    room.nextKickoffCarrier = midfieldKickoffPlayer(room.teams[defendId]);
    sendMatch(room);
    io.to(room.roomCode).emit("goalScored", { scorer:shooter.name, shot:"LONG", scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats });
    setTimeout(() => { if (room.finished) return; startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} restart after the goal.`); sendMatch(room); }, 2800);
    return;
  }
  // Miss: most are straight at the keeper, some fly wide.
  const onTarget = Math.random() * 100 < 70;
  if (onTarget) room.stats[defendId].saves += 1;
  addStory(room, onTarget
    ? `🧤 ${keeperName} collects ${shooter.name}'s long-range effort${pressed ? " under pressure" : ""}.`
    : `📐 ${shooter.name}'s long shot flashes wide.`);
  startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} build again from defence.`);
  if (onTarget) io.to(room.roomCode).emit("saveMade", { keeper:keeperName, shooter:shooter.name, shot:"LONG" });
}
function resolveShot(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const shot = room.match.choices[attackId];
  const save = room.match.choices[defendId];
  const shooter = room.match.carrier;
  const keeper = room.teams[defendId].positions.GK;
  const matched = shot === save;
  const keeperName = keeper?.name || "the keeper";
  room.match.choices = {};
  // A correct read by the keeper is always a save; a wrong read is almost
  // always a goal — stats only tilt the miss/finish odds when the read is off.
  if (matched) {
    room.stats[defendId].saves += 1;
    addStory(room, `🧱 SAVE! ${keeperName} reads ${shooter.name}'s ${shot.toLowerCase()} finish.`);
    startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} build again from defence.`);
    io.to(room.roomCode).emit("saveMade", { keeper:keeperName, shooter:shooter.name, shot });
    return false;
  }
  // Keeper guessed wrong — the shot has a good chance of going in.
  const shooterSHO = effectiveStat(shooter, "shooting");
  const keeperAbility = statAbility(keeper, "defending", "physicality");
  const goal = Math.random() * 100 < clamp(0.88 - (keeperAbility - shooterSHO) * 0.006, 0.7, 0.98) * 100;
  if (goal) {
    if (attackId === room.players[0].id) room.scoreA += 1; else room.scoreB += 1;
    room.stats[attackId].goals.push(shooter.name);
    addStory(room, `🚀 GOAL! ${shooter.name} fires ${shot.toLowerCase()} past ${keeperName}.`);
    if (room.matchMode === "goals" && (room.scoreA >= room.goalLimit || room.scoreB >= room.goalLimit)) {
      sendMatch(room);
      finishMatch(room);
      return true;
    }
    room.match.phase = "CELEBRATE";
    room.nextKickoffCarrier = midfieldKickoffPlayer(room.teams[defendId]);
    sendMatch(room);
    io.to(room.roomCode).emit("goalScored", { scorer:shooter.name, shot, scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats });
    setTimeout(() => { if (room.finished) return; startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} restart after the goal.`); sendMatch(room); }, 2800);
    return true;
  }
  // Keeper wrong but the shot misses.
  room.stats[defendId].saves += 1;
  addStory(room, `📐 ${shooter.name}'s effort goes wide despite ${keeperName} committing the wrong way.`);
  startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} build again from defence.`);
  io.to(room.roomCode).emit("saveMade", { keeper:keeperName, shooter:shooter.name, shot });
  return false;
}
function autoPickMoves(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const isGoal = room.match.phase === "GOAL";
  const randomPass = () => randomItem(passOptions(room))?.id;
  if (!room.match.choices[attackId]) room.match.choices[attackId] = isGoal ? randomItem(["LEFT", "CENTER", "RIGHT"]) : (Math.random() < 0.06 ? "LONG_SHOT" : randomPass());
  ensureAiChoice(room);
  if (!room.match.choices[defendId]) room.match.choices[defendId] = isGoal ? randomItem(["LEFT", "CENTER", "RIGHT"]) : (Math.random() < 0.1 ? "PRESS" : randomPass());
  addStory(room, "⏰ Time up — a move was chosen automatically.");
  if (isGoal) { if (resolveShot(room)) return; }
  else resolvePass(room);
  if (room.match?.phase === "INTERCEPTION") return;
  sendMatch(room);
}

// ----- AI opponent -----
// The CPU shares the normal match engine. When the CPU holds the ball it locks
// in its move instantly at the start of the phase; when defending it waits for
// the human's move and "reads" it with a difficulty-based chance before
// answering, so the resolution still happens the moment the human submits.
function aiAttackerChoice(room, difficulty) {
  const isGoal = room.match.phase === "GOAL";
  if (isGoal) return randomItem(["LEFT", "CENTER", "RIGHT"]);
  const options = passOptions(room);
  if (!options.length) return undefined;
  const smart = AI_ATTACK_SMART[difficulty] || 0;
  // Smarter CPUs and clinical finishers occasionally pull the trigger from
  // range instead of passing — the keeper's reach decides how tempting it is.
  if (smart > 0) {
    const opponent = room.players.find((player) => player.id !== room.possession);
    const keeper = room.teams[opponent.id].positions.GK;
    const edge = effectiveStat(room.match.carrier, "shooting") - statAbility(keeper, "defending", "physicality");
    if (Math.random() < smart * 0.12 + Math.max(0, edge) * 0.004) return "LONG_SHOT";
  }
  return smart >= 1 || Math.random() < smart ? options[0].id : randomItem(options).id;
}
function aiDefendChoice(room, difficulty) {
  const botId = room.ai.id;
  const user = room.players.find((player) => player.id !== botId);
  const userChoice = room.match.choices[user.id];
  const read = AI_READ_RATE[difficulty] || 0;
  const isGoal = room.match.phase === "GOAL";
  if (isGoal) {
    const dirs = ["LEFT", "CENTER", "RIGHT"];
    if (userChoice && (read >= 1 || Math.random() < read)) return userChoice;
    return userChoice ? randomItem(dirs.filter((direction) => direction !== userChoice)) : randomItem(dirs);
  }
  const options = passOptions(room);
  if (!options.length) return undefined;
  if (userChoice === "LONG_SHOT") return read >= 1 || Math.random() < read ? "PRESS" : randomItem(options).id;
  if (userChoice && (read >= 1 || Math.random() < read)) return userChoice;
  const others = options.filter((option) => option.id !== userChoice);
  if (Math.random() < read * 0.08) return "PRESS";
  return (userChoice && others.length ? randomItem(others) : randomItem(options)).id;
}
function ensureAiChoice(room) {
  const bot = room.ai;
  if (!bot || !room.match || !["PASS", "GOAL"].includes(room.match.phase)) return;
  if (room.match.choices[bot.id] !== undefined) return;
  room.match.choices[bot.id] = room.possession === bot.id ? aiAttackerChoice(room, bot.difficulty) : aiDefendChoice(room, bot.difficulty);
}
function aiShootoutTick(room) {
  const shootout = room.shootout;
  if (!shootout || shootout.phase !== "SELECT" || shootout.currentTeam !== room.ai.id) return;
  const team = room.teams[room.ai.id].positions;
  const candidates = Object.values(team).filter((player) => player && player.position !== "GK" && !shootout.usedShooters[room.ai.id].includes(player.id));
  if (!candidates.length) return;
  candidates.sort((a, b) => b.rating - a.rating);
  const shooter = candidates[0];
  shootout.usedShooters[room.ai.id].push(shooter.id);
  shootout.selectedShooter = shooter;
  shootout.phase = "DUEL";
  shootout.choices = {};
  sendMatch(room);
}
function aiPenaltyDirection(room) {
  const shootout = room.shootout;
  const botId = room.ai.id;
  const user = room.players.find((player) => player.id !== botId);
  const dirs = ["LEFT", "CENTER", "RIGHT"];
  if (shootout.currentTeam === botId) return randomItem(dirs);
  const read = AI_READ_RATE[room.ai.difficulty] || 0;
  const userChoice = shootout.choices[user.id];
  if (userChoice && (read >= 1 || Math.random() < read)) return userChoice;
  return userChoice ? randomItem(dirs.filter((direction) => direction !== userChoice)) : randomItem(dirs);
}
function resetAiRoom(room) {
  if (room.timer) clearInterval(room.timer);
  room.readyPlayers = 2;
  room.scoreA = 0;
  room.scoreB = 0;
  room.possession = null;
  room.commentary = [];
  room.match = null;
  room.finished = false;
  room.shootout = null;
  room.rematchVotes = [];
  io.to(room.roomCode).emit("rematchConfirmed", { room });
  beginMatch(room);
}
function beginMatch(room) {
  const [first, second] = room.players.map((player) => player.id);
  room.stats = { [first]:{ passes:0, interceptions:0, goals:[], saves:0 }, [second]:{ passes:0, interceptions:0, goals:[], saves:0 } };
  const kickoffId = pickKickoff(room);
  room.nextKickoffCarrier = highestRatedPlayer(room.teams[kickoffId]);
  startPossession(room, kickoffId, "🏟️ Kick-off! The stronger side starts from the back — for now.");
  startMatchClock(room);
  sendMatch(room, "enterMatch");
}
function loadOwnTeam(userId) {
  const ownedRows = db.prepare(`
    SELECT oc.*, c.name, c.season, c.club, c.position, c.category, c.base_rating, c.tier, c.image, c.pace, c.shooting, c.passing, c.dribbling, c.defending, c.physicality
    FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
    WHERE oc.user_id = ?
  `).all(userId);
  const inXI = ownedRows.filter((row) => row.is_in_xi === 1);
  if (inXI.length !== 11) return { error: "Set your starting XI (11 players) in My Team before playing." };
  const xiPositions = {};
  for (const row of inXI) {
    if (!row.slot || !FORMATION_CATEGORY[row.slot]) return { error: "Your saved squad is invalid." };
    if (xiPositions[row.slot]) return { error: "Your saved squad has duplicate players." };
    const penalty = positionPenalty(row.category, FORMATION_CATEGORY[row.slot]);
    xiPositions[row.slot] = { ...ownedPlayer(row), rating: row.rating + penalty };
  }
  const verifiedOverall = Number((Object.values(xiPositions).reduce((sum, player) => sum + player.rating, 0) / STARTER_COUNT).toFixed(1));
  return { team: { positions: buildTeam(xiPositions), overall: verifiedOverall } };
}


io.on("connection", (socket) => {
  socket.on("authSocket", ({ token }) => {
    const user = userByToken(token);
    socket.data.userId = user ? user.id : undefined;
    if (user) markOnline(user.id, socket.id);
  });
  socket.on("createRoom", ({ playerName, goalLimit, matchMode, timeLimit, resumeToken, mode }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { roomCode, mode: mode === "club" ? "club" : "draft", goalLimit:[1,3,5].includes(Number(goalLimit)) ? Number(goalLimit) : 3, matchMode:matchMode === "time" ? "time" : "goals", timeLimit:[90,120,150,180].includes(Number(timeLimit)) ? Number(timeLimit) : 90, players:[{ id:socket.id, name:playerName, resumeToken, userId:socket.data.userId }], readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{}, draft:{ round:0, turnId:socket.id, picks:{}, takenIds:[], formations:{} }, match:null, timer:null, finished:false, shootout:null, reconnectTimers:{}, rematchVotes:[] };
    socket.join(roomCode); socket.emit("roomCreated", roomCode);
  });
  socket.on("createAiMatch", ({ playerName, difficulty, matchMode, goalLimit, timeLimit }) => {
    const userId = socket.data.userId;
    if (!userId) return socket.emit("errorMessage", "Log in to play against the CPU.");
    const aiDiff = AI_DIFFICULTIES.includes(difficulty) ? difficulty : "easy";
    const own = loadOwnTeam(userId);
    if (own.error) return socket.emit("errorMessage", own.error);
    const aiTeam = buildAiTeam(aiDiff, own.team.overall);
    if (!aiTeam) return socket.emit("errorMessage", "No players available to build the CPU squad yet.");
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const botId = `ai-${socket.id}`;
    const room = { roomCode, mode: "club", ai:{ id: botId, difficulty: aiDiff }, goalLimit:[1,3,5].includes(Number(goalLimit)) ? Number(goalLimit) : 3, matchMode:matchMode === "time" ? "time" : "goals", timeLimit:[90,120,150,180].includes(Number(timeLimit)) ? Number(timeLimit) : 90, players:[{ id:socket.id, name:String(playerName || "").slice(0, 20) || "You", userId }, { id:botId, name:AI_NAMES[aiDiff], isBot:true }], readyPlayers:2, teams:{ [socket.id]: own.team, [botId]: aiTeam }, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{}, draft:{ round:0, turnId:socket.id, picks:{}, takenIds:[] }, match:null, timer:null, finished:false, shootout:null, reconnectTimers:{}, rematchVotes:[] };
    rooms[roomCode] = room;
    socket.join(roomCode);
    socket.emit("roomReady", room);
    beginMatch(room);
  });
  socket.on("joinRoom", ({ roomCode, playerName, resumeToken }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMessage", "Room not found");
    const returningPlayer = resumeToken && room.players.find((player) => player.resumeToken === resumeToken);
    if (returningPlayer) {
      const previousId = returningPlayer.id;
      if (room.reconnectTimers?.[previousId]) { clearTimeout(room.reconnectTimers[previousId]); delete room.reconnectTimers[previousId]; }
      returningPlayer.id = socket.id; movePlayerState(room, previousId, socket.id); socket.join(roomCode);
      room.rematchVotes = room.rematchVotes.filter((id) => id !== previousId);
      socket.emit("roomReady", room); return;
    }
    if (room.players.length >= 2) return socket.emit("errorMessage", "Room full");
    room.players.push({ id:socket.id, name:playerName, resumeToken, userId:socket.data.userId }); socket.join(roomCode);
    io.to(roomCode).emit("roomReady", room); sendDraftState(room);
  });
  // A room owner can ping an online friend straight into their open room. The
  // friend must be on the friend list and not already sitting in a match.
  socket.on("inviteToRoom", ({ roomCode, targetUserId }) => {
    const inviterId = socket.data.userId;
    if (!inviterId) return socket.emit("errorMessage", "Log in to invite friends.");
    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMessage", "Room not found");
    const inviter = room.players.find((player) => player.id === socket.id);
    if (!inviter) return socket.emit("errorMessage", "You're not in that room.");
    if (room.players.length >= 2) return socket.emit("errorMessage", "That room is already full.");
    const target = Number(targetUserId);
    if (!Number.isInteger(target) || target <= 0) return socket.emit("errorMessage", "Invalid friend.");
    const friendship = db.prepare(`
      SELECT 1 FROM friends
      WHERE status = 'accepted'
        AND ((user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?))
      LIMIT 1
    `).get(inviterId, target, target, inviterId);
    if (!friendship) return socket.emit("errorMessage", "You can only invite managers on your friend list.");
    if (!socketIdsFor(target).length) return socket.emit("errorMessage", "That friend isn't online right now.");
    // Only an *active* room counts as busy: a finished match leaves its room
    // object in memory until the players disconnect, so checking every room
    // would wrongly flag a friend who just finished playing. The target must
    // also be present on one of their current sockets.
    const targetSockets = new Set(socketIdsFor(target));
    const busy = Object.values(rooms).some((other) =>
      other !== room &&
      !other.finished &&
      other.players.some((player) => player.userId === target && !player.isBot && targetSockets.has(player.id)),
    );
    if (busy) return socket.emit("errorMessage", "That friend is already in a match.");
    io.to(socketIdsFor(target)).emit("roomInvite", {
      roomCode, fromUserId: inviterId, fromName: inviter.name,
      matchMode: room.matchMode, goalLimit: room.goalLimit,
    });
    socket.emit("inviteSent", { targetUserId: target, roomCode });
  });
  socket.on("declineRoomInvite", ({ roomCode, fromUserId }) => {
    const sender = Number(fromUserId);
    const target = socket.data.userId;
    if (!sender || !target) return;
    const user = db.prepare("SELECT username FROM users WHERE id = ?").get(target);
    io.to(socketIdsFor(sender)).emit("inviteDeclined", { roomCode, name: user?.username || target });
  });
  socket.on("getDraftState", ({ roomCode }) => { const room = rooms[roomCode]; if (!room) return; socket.emit("draftState", draftPayload(room)); if (room.match) socket.emit("enterMatch", matchPayload(room)); });
  // A dropped socket silently reconnects with a brand-new id. Without this, the
  // room keeps pointing at the stale id: turns freeze for everyone ("X is
  // choosing" forever) and matches stall mid-move. This remaps the returning
  // player to the fresh socket and re-syncs their full state.
  socket.on("rejoinRoom", ({ roomCode, resumeToken }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("matchGone");
    const returningPlayer = resumeToken && room.players.find((player) => player.resumeToken === resumeToken);
    if (!returningPlayer) return;
    const previousId = returningPlayer.id;
    if (previousId === socket.id) {
      socket.emit("roomReady", room); sendDraftState(room); if (room.match) socket.emit("enterMatch", matchPayload(room));
      return;
    }
    if (room.reconnectTimers?.[previousId]) { clearTimeout(room.reconnectTimers[previousId]); delete room.reconnectTimers[previousId]; }
    returningPlayer.id = socket.id;
    movePlayerState(room, previousId, socket.id);
    socket.join(roomCode);
    room.rematchVotes = room.rematchVotes.filter((id) => id !== previousId);
    socket.emit("roomReady", room);
    sendDraftState(room);
    if (room.match) socket.emit("enterMatch", matchPayload(room));
  });
  socket.on("chooseFormation", ({ roomCode, formation }) => {
    const room = rooms[roomCode];
    if (!room || room.mode !== "draft" || !FORMATIONS[formation]) return;
    room.draft.formations = room.draft.formations || {};
    room.draft.formations[socket.id] = formation;
    sendDraftState(room);
  });
  socket.on("requestDraftPack", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || room.draft.turnId !== socket.id) return;
    const category = nextNeeded(formationOf(room, socket.id), room.draft.picks[socket.id]);
    if (!category) return;
    const taken = room.draft.takenIds || [];
    const candidates = DRAFT_POOL.filter((card) => card.category === category && !taken.includes(card.id));
    const pack = [];
    const pool = [...candidates];
    for (let i = 0; i < Math.min(4, pool.length); i++) {
      const idx = Math.floor(Math.random() * pool.length);
      pack.push(pool.splice(idx, 1)[0]);
    }
    socket.emit("draftPack", { pack: pack.map(cardPayload), category });
  });
  socket.on("draftPick", ({ roomCode, player }) => {
    const room = rooms[roomCode];
    if (!room || room.draft.turnId !== socket.id || !player) return;
    const category = nextNeeded(formationOf(room, socket.id), room.draft.picks[socket.id]);
    if (!category) return;
    const card = DRAFT_POOL.find((c) => c.id === player.id && c.category === category);
    if (!card || room.draft.takenIds.includes(card.id)) return;
    room.draft.takenIds.push(card.id); room.draft.picks[socket.id] = [...(room.draft.picks[socket.id] || []), cardPayload(card)]; room.draft.round += 1;
    room.draft.turnId = room.players.find((participant) => participant.id !== socket.id)?.id || socket.id; sendDraftState(room);
  });
  socket.on("playerReady", ({ roomCode, positions, overall }) => {
    const room = rooms[roomCode]; if (!room || room.teams[socket.id]) return;
    let team;
    if (room.mode === "club") {
      // Own-team mode: the server builds the XI from the manager's saved squad,
      // so the draft is skipped entirely and the lineup can't be tampered with.
      if (!socket.data.userId) return socket.emit("errorMessage", "Log in to play with your own team.");
      const own = loadOwnTeam(socket.data.userId);
      if (own.error) return socket.emit("errorMessage", own.error);
      team = own.team;
    } else {
      if (!validLineup(room, socket.id, positions)) return socket.emit("errorMessage", "Your lineup must keep each player in their own category.");
      const verifiedOverall = Number((Object.keys(formationOf(room, socket.id).slotCategory).reduce((sum, slot) => sum + positions[slot].rating, 0) / STARTER_COUNT).toFixed(1));
      team = { positions: buildTeam(positions), overall: verifiedOverall };
    }
    room.teams[socket.id] = team; room.readyPlayers += 1; io.to(roomCode).emit("readyCount", room.readyPlayers);
    if (room.readyPlayers === 2) {
      beginMatch(room);
    }
  });
  socket.on("submitMove", ({ roomCode, move }) => {
    const room = rooms[roomCode]; if (!room?.match || !["PASS", "GOAL"].includes(room.match.phase) || ![room.possession, room.players.find((p) => p.id !== room.possession)?.id].includes(socket.id)) return;
    const isGoal = room.match.phase === "GOAL";
    if (isGoal && !["LEFT","CENTER","RIGHT"].includes(move)) return;
    if (!isGoal && !(socket.id === room.possession ? move === "LONG_SHOT" : move === "PRESS") && !passOptions(room).some((player) => player.id === move)) return;
    room.match.choices[socket.id] = move;
    ensureAiChoice(room);
    if (Object.keys(room.match.choices).length < 2) return sendMatch(room);
    if (isGoal && resolveShot(room)) return;
    if (!isGoal) resolvePass(room);
    sendMatch(room);
  });
  socket.on("selectPenaltyShooter", ({ roomCode, playerId }) => {
    const room = rooms[roomCode], shootout = room?.shootout;
    if (!shootout || shootout.phase !== "SELECT" || shootout.currentTeam !== socket.id) return;
    const shooter = Object.values(room.teams[socket.id].positions).find((player) => player?.id === playerId);
    if (!shooter || shooter.position === "GK" || (shootout.usedShooters[socket.id] || []).includes(playerId)) return;
    shootout.usedShooters[socket.id] = shootout.usedShooters[socket.id] || [];
    shootout.usedShooters[socket.id].push(playerId);
    shootout.selectedShooter = shooter; shootout.phase = "DUEL"; shootout.choices = {}; shootout.deadline = Date.now() + PENALTY_TIMEOUT;
    sendMatch(room);
  });
  socket.on("submitPenaltyDirection", ({ roomCode, direction }) => {
    const room = rooms[roomCode], shootout = room?.shootout;
    if (!shootout || shootout.phase !== "DUEL" || !["LEFT", "CENTER", "RIGHT"].includes(direction)) return;
    const defendId = room.players.find((p) => p.id !== shootout.currentTeam).id;
    if (socket.id !== shootout.currentTeam && socket.id !== defendId) return;
    shootout.choices[socket.id] = direction;
    if (room.ai && shootout.choices[room.ai.id] === undefined) shootout.choices[room.ai.id] = aiPenaltyDirection(room);
    if (Object.keys(shootout.choices).length === 2) resolvePenalty(room); else sendMatch(room);
  });
  socket.on("requestRematch", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || !room.players.some((player) => player.id === socket.id)) return;
    if (room.ai) { resetAiRoom(room); return; }
    if (room.rematchVotes.includes(socket.id)) return;
    room.rematchVotes.push(socket.id);
    io.to(roomCode).emit("rematchRequested", { count:room.rematchVotes.length, total:room.players.length });
    if (room.rematchVotes.length < room.players.length) return;
    if (room.timer) clearInterval(room.timer);
    const reset = {
      roomCode:room.roomCode, mode:room.mode, goalLimit:room.goalLimit, matchMode:room.matchMode, timeLimit:room.timeLimit, players:room.players,
      readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{},
      draft:{ round:0, turnId:room.players[0].id, picks:{}, takenIds:[], formations:{} },
      match:null, timer:null, finished:false, shootout:null, reconnectTimers:room.reconnectTimers, rematchVotes:[]
    };
    rooms[roomCode] = reset;
    io.to(roomCode).emit("rematchConfirmed", { room });
  });
  socket.on("sendEmote", ({ roomCode, emote }) => {
    const room = rooms[roomCode];
    if (!room || (!room.match && !room.shootout)) return;
    const player = room.players.find((participant) => participant.id === socket.id);
    if (!player || !["GG", "LAUGH", "CRY", "ANGRY", "SHUSH"].includes(emote)) return;
    socket.to(roomCode).emit("opponentEmote", { emote, name: player.name });
  });
  socket.on("leaveRoom", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || !room.players.some((player) => player.id === socket.id)) return;
    if (room.timer) clearInterval(room.timer);
    room.players = room.players.filter((player) => player.id !== socket.id);
    delete room.reconnectTimers?.[socket.id];
    if (room.ai || !room.players.length) { delete rooms[roomCode]; return; }
    io.to(roomCode).emit("opponentLeft", { name:room.players.find((player) => player.id !== socket.id)?.name });
  });
  socket.on("disconnect", () => { markOffline(socket.id); Object.keys(rooms).forEach((code) => { const room = rooms[code]; const player = room.players.find((participant) => participant.id === socket.id); if (!player) return; room.rematchVotes = room.rematchVotes.filter((id) => id !== socket.id); room.reconnectTimers ||= {}; room.reconnectTimers[socket.id] = setTimeout(() => { const currentRoom = rooms[code]; if (!currentRoom) return; currentRoom.players = currentRoom.players.filter((participant) => participant.id !== socket.id); delete currentRoom.reconnectTimers[socket.id]; if (currentRoom.ai || !currentRoom.players.length) { if (currentRoom.timer) clearInterval(currentRoom.timer); delete rooms[code]; } else { io.to(code).emit("opponentLeft", { name: player.name }); } }, 60000); }); });
});
const port = Number(process.env.PORT) || 5000;
server.listen(port, () => {
  console.log(`Server running on ${port}`);
  // Run catalog seeding in a background child process so the server's event
  // loop stays responsive (and Render's /health check passes) while the DB
  // is populated.
  const seedChild = spawn(process.execPath, [path.join(__dirname, "seed.js")], { env: process.env, stdio: "inherit" });
  seedChild.on("error", (err) => console.error("Seed process error:", err.message));
  seedChild.on("exit", (code) => console.log(`Seed process exited with code ${code}`));
});
