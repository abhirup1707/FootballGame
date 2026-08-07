const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");
const routes = require("./routes");
const { db } = require("./db");
require("./seed");
const { resolveMatchRewards } = require("./economy");
const { userByToken } = require("./auth");
const { computeOVR, effectiveStats, positionPenalty } = require("./ovr");
const { DRAFT_POOL } = require("./draftPool");

const app = express();
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";
const corsOptions = { origin: allowedOrigins };

app.use(cors(corsOptions));
app.use(express.json());
app.use("/api", routes);
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
const rooms = {};
// 22 rounds: each manager drafts an 11-man starting XI.
const DRAFT_ROUNDS = [...Array(6).fill("ATT"), ...Array(6).fill("MID"), ...Array(8).fill("DEF"), ...Array(2).fill("GK")];
const STARTER_COUNT = 11;
const PITCH_COORDINATES = { GK:[50,88], LB:[17,70], CB1:[38,74], CB2:[62,74], RB:[83,70], CM1:[32,53], CM2:[68,53], CAM:[50,43], LW:[19,25], ST:[50,18], RW:[81,25] };
const FORMATION_CATEGORY = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };
const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MOVE_TIMEOUT = 7000;
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
  const draftedById = new Map(drafted.map((player) => [player.id, player]));
  const usedIds = new Set();
  return Object.entries(FORMATION_CATEGORY).every(([slot, category]) => {
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

function draftPayload(room) { return { turnId:room.draft.turnId, round:room.draft.round, category:DRAFT_ROUNDS[room.draft.round] || null, picks:room.draft.picks, complete:room.draft.round >= DRAFT_ROUNDS.length }; }
function sendDraftState(room) { io.to(room.roomCode).emit("draftState", draftPayload(room)); }
function teamName(room, teamId) { return `${room.players.find((player) => player.id === teamId)?.name || "Unknown"}'s team`; }
function playerPosition(team, playerId) { return Object.keys(team.positions).find((key) => team.positions[key]?.id === playerId); }
function passOptions(room) {
  if (room.match.phase !== "PASS") return [];
  const team = room.teams[room.possession];
  const carrierPosition = playerPosition(team, room.match.carrier.id);
  const [carrierX, carrierY] = PITCH_COORDINATES[carrierPosition] || [50, 50];
  // Every pass presents exactly the three closest teammates. This keeps the
  // choice competitive and adapts naturally to whichever player has the ball.
  return Object.entries(team.positions)
    .filter(([position, player]) => player && position !== carrierPosition)
    .map(([position, player]) => {
      const [x, y] = PITCH_COORDINATES[position] || [50, 50];
      return { player, distance:(x - carrierX) ** 2 + (y - carrierY) ** 2 };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
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
  const rewards = resolveMatchRewards(room);
  io.to(room.roomCode).emit("matchFinished", { scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats, shootout:room.shootout || null, rewards });
}
function shootoutScore(room, id) { return room.shootout.kicks[id].filter(Boolean).length; }
function startShootout(room) {
  const [first, second] = room.players.map((player) => player.id);
  const order = room.teams[first].overall >= room.teams[second].overall ? [first, second] : [second, first];
  room.shootout = { order, currentTeam:order[0], phase:"SELECT", kicks:{ [first]:[], [second]:[] }, usedShooters:{ [first]:[], [second]:[] }, selectedShooter:null, choices:{}, result:null };
  room.match = { phase:"PENALTY", passCount:0, carrier:null, choices:{} };
  addStory(room, `Penalty shootout! ${room.players.find((p) => p.id === order[0]).name} start because of their higher OVR.`);
  sendMatch(room, "penaltyStarted");
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
  sendMatch(room);
}
function resolvePenalty(room) {
  const shootout = room.shootout, attackId = shootout.currentTeam, defendId = room.players.find((p) => p.id !== attackId).id;
  const shot = shootout.choices[attackId], dive = shootout.choices[defendId];
  const shooter = shootout.selectedShooter, keeper = room.teams[defendId].positions.GK;
  const shooterSHO = effectiveStats(shooter, shooter.stamina).shooting;
  const keeperREF = effectiveStats(keeper, keeper.stamina).defending;
  // Diving the right way always saves the penalty — the mind-game is the core.
  // Stats only move the odds when the keeper guesses wrong.
  let goal;
  if (shot === dive) goal = false;
  else goal = Math.random() * 100 < clamp(70 + (shooterSHO - keeperREF) * 2, 40, 94);
  shootout.kicks[attackId].push(goal); shootout.result = { attackId, shooter, keeper, shot, dive, goal };
  shootout.phase = "RESULT";
  addStory(room, goal ? `GOAL! ${shooter.name} sends ${keeper.name} the wrong way.` : `SAVED! ${keeper.name} reads the penalty.`);
  sendMatch(room, "penaltyResult");
  setTimeout(() => { if (!room.finished && room.shootout?.phase === "RESULT") advanceShootout(room); }, 1900);
}
function startMatchClock(room) {
  room.matchStartedAt = Date.now();
  room.timer = setInterval(() => {
    if (room.finished || room.shootout) return;
    const elapsed = Date.now() - room.matchStartedAt;
    if (room.matchMode === "time" && elapsed >= room.timeLimit * 1000) {
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
function addStory(room, line) { room.commentary.unshift(line); room.commentary = room.commentary.slice(0, 5); }
function startPossession(room, teamId, story, carrier) {
  room.possession = teamId;
  const team = room.teams[teamId];
  const openingCarrier = carrier || room.nextKickoffCarrier || randomItem([team.positions.CB1, team.positions.CB2].filter(Boolean));
  delete room.nextKickoffCarrier;
  room.match = { phase:"PASS", passCount:0, carrier:openingCarrier, choices:{}, deadline:Date.now() + MOVE_TIMEOUT };
  if (story) addStory(room, story);
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
function resolvePass(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const receiver = passOptions(room).find((player) => player.id === room.match.choices[attackId]);
  const markedId = room.match.choices[defendId];
  if (!receiver) return;
  const carrier = room.match.carrier;
  const markedCorrectly = markedId === receiver.id;
  const interceptor = closestDefender(room, defendId, receiver);
  // Reading the pass correctly always wins the ball — the defender picked the
  // exact teammate the carrier targeted. Stats only shape the unlucky cases.
  if (markedCorrectly) {
    room.match.choices = {};
    room.match.deadline = Date.now() + MOVE_TIMEOUT;
    if (!interceptor) return;
    room.stats[defendId].interceptions += 1;
    room.match.phase = "INTERCEPTION";
    room.match.interception = { receiver, interceptor };
    addStory(room, `INTERCEPTED! ${interceptor.name} steps in ahead of ${receiver.name} and wins the ball.`);
    sendMatch(room);
    io.to(room.roomCode).emit("interceptionMade", { interceptor:interceptor.name, receiver:receiver.name });
    setTimeout(() => {
      if (room.match?.phase !== "INTERCEPTION") return;
      startPossession(room, defendId, `${room.players.find((p) => p.id === defendId).name} begin a new five-pass move with ${interceptor.name}.`, interceptor);
      sendMatch(room);
    }, 1050);
    return;
  }
  // An unmarked pass can still be pressed into a giveaway, but far less often.
  room.match.choices = {};
  room.match.deadline = Date.now() + MOVE_TIMEOUT;
  room.match.carrier = receiver;
  room.match.passCount += 1;
  room.stats[attackId].passes += 1;
  const flair = "finds space";
  room.match.lastPass = { team:teamName(room, attackId), passer:carrier.name, receiver:receiver.name };
  addStory(room, `⚽ ${teamName(room, attackId)}: ${carrier.name} passes to ${receiver.name} — ${flair}.`);
  if (room.match.passCount >= 5) {
    room.match.phase = "GOAL";
    addStory(room, `⚡ FIVE PASSES COMPLETE — ${receiver.name} has the final chance!`);
  }
}
function resolveShot(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const shot = room.match.choices[attackId];
  const save = room.match.choices[defendId];
  const shooter = room.match.carrier;
  const keeper = room.teams[defendId].positions.GK;
  const matched = shot === save;
  // The keeper covering the same corner always saves it. Stats only shape the
  // cases where the keeper guessed wrong and has to react to the ball.
  const goal = !matched;
  room.match.choices = {};
  if (goal) {
    if (attackId === room.players[0].id) room.scoreA += 1; else room.scoreB += 1;
    room.stats[attackId].goals.push(shooter.name);
    addStory(room, `🚀 GOAL! ${shooter.name} fires ${shot.toLowerCase()} past ${keeper.name}.`);
    if (room.matchMode === "goals" && (room.scoreA >= room.goalLimit || room.scoreB >= room.goalLimit)) {
      sendMatch(room);
      finishMatch(room);
      return true;
    }
    room.match.phase = "CELEBRATE";
    room.nextKickoffCarrier = midfieldKickoffPlayer(room.teams[defendId]);
    sendMatch(room);
    io.to(room.roomCode).emit("goalScored", { scorer:shooter.name, shot, scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats });
    setTimeout(() => { startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} restart after the goal.`); sendMatch(room); }, 2800);
    return true;
  } else addStory(room, `🧱 SAVE! ${keeper.name} reads ${shooter.name}'s ${shot.toLowerCase()} finish.`);
  startPossession(room, defendId, `🔄 ${room.players.find((p) => p.id === defendId).name} build again from defence.`);
  io.to(room.roomCode).emit("saveMade", { keeper:keeper.name, shooter:shooter.name, shot });
  return false;
}
function autoPickMoves(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const isGoal = room.match.phase === "GOAL";
  const randomPass = () => randomItem(passOptions(room))?.id;
  if (!room.match.choices[attackId]) room.match.choices[attackId] = isGoal ? randomItem(["LEFT", "CENTER", "RIGHT"]) : randomPass();
  if (!room.match.choices[defendId]) room.match.choices[defendId] = isGoal ? randomItem(["LEFT", "CENTER", "RIGHT"]) : randomPass();
  addStory(room, "⏰ Time up — a move was chosen automatically.");
  if (isGoal) { if (resolveShot(room)) return; }
  else resolvePass(room);
  if (room.match?.phase === "INTERCEPTION") return;
  sendMatch(room);
}

io.on("connection", (socket) => {
  socket.on("authSocket", ({ token }) => {
    const user = userByToken(token);
    socket.data.userId = user ? user.id : undefined;
  });
  socket.on("createRoom", ({ playerName, goalLimit, matchMode, timeLimit, resumeToken, mode }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { roomCode, mode: mode === "club" ? "club" : "draft", goalLimit:[1,3,5].includes(Number(goalLimit)) ? Number(goalLimit) : 3, matchMode:matchMode === "time" ? "time" : "goals", timeLimit:[90,120,150,180].includes(Number(timeLimit)) ? Number(timeLimit) : 90, players:[{ id:socket.id, name:playerName, resumeToken, userId:socket.data.userId }], readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{}, draft:{ round:0, turnId:socket.id, picks:{}, takenIds:[] }, match:null, timer:null, finished:false, shootout:null, reconnectTimers:{}, rematchVotes:[] };
    socket.join(roomCode); socket.emit("roomCreated", roomCode);
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
  socket.on("getDraftState", ({ roomCode }) => { const room = rooms[roomCode]; if (!room) return; socket.emit("draftState", draftPayload(room)); if (room.match) socket.emit("enterMatch", matchPayload(room)); });
  socket.on("requestDraftPack", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || room.draft.turnId !== socket.id) return;
    const category = DRAFT_ROUNDS[room.draft.round];
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
    const room = rooms[roomCode], category = room && DRAFT_ROUNDS[room.draft.round];
    if (!room || room.draft.turnId !== socket.id || !player) return;
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
      const ownedRows = db.prepare(`
        SELECT oc.*, c.name, c.season, c.club, c.position, c.category, c.base_rating, c.tier, c.image, c.pace, c.shooting, c.passing, c.dribbling, c.defending, c.physicality
        FROM owned_cards oc JOIN cards c ON c.id = oc.card_id
        WHERE oc.user_id = ?
      `).all(socket.data.userId);
      const inXI = ownedRows.filter((row) => row.is_in_xi === 1);
      if (inXI.length !== 11) return socket.emit("errorMessage", "Set your starting XI (11 players) in My Team before playing.");
      const xiPositions = {};
      for (const row of inXI) {
        if (!row.slot || !FORMATION_CATEGORY[row.slot]) return socket.emit("errorMessage", "Your saved squad is invalid.");
        if (xiPositions[row.slot]) return socket.emit("errorMessage", "Your saved squad has duplicate players.");
        // Any player can play any slot; out-of-position players lose OVR here so
        // the match sees the same rating penalty the team screen shows.
        const penalty = positionPenalty(row.category, FORMATION_CATEGORY[row.slot]);
        xiPositions[row.slot] = { ...ownedPlayer(row), rating: row.rating + penalty };
      }
      const verifiedOverall = Number((Object.values(xiPositions).reduce((sum, player) => sum + player.rating, 0) / STARTER_COUNT).toFixed(1));
      team = { positions: buildTeam(xiPositions), overall: verifiedOverall };
    } else {
      if (!validLineup(room, socket.id, positions)) return socket.emit("errorMessage", "Your lineup must keep each player in their own category.");
      const verifiedOverall = Number((Object.keys(FORMATION_CATEGORY).reduce((sum, slot) => sum + positions[slot].rating, 0) / STARTER_COUNT).toFixed(1));
      team = { positions: buildTeam(positions), overall: verifiedOverall };
    }
    room.teams[socket.id] = team; room.readyPlayers += 1; io.to(roomCode).emit("readyCount", room.readyPlayers);
    if (room.readyPlayers === 2) {
      const [first, second] = room.players.map((player) => player.id);
      room.stats = { [first]:{ passes:0, interceptions:0, goals:[] }, [second]:{ passes:0, interceptions:0, goals:[] } };
      const kickoffId = pickKickoff(room);
      room.nextKickoffCarrier = highestRatedPlayer(room.teams[kickoffId]);
      startPossession(room, kickoffId, "🏟️ Kick-off! The stronger side starts from the back — for now.");
      startMatchClock(room);
      sendMatch(room, "enterMatch");
    }
  });
  socket.on("submitMove", ({ roomCode, move }) => {
    const room = rooms[roomCode]; if (!room?.match || !["PASS", "GOAL"].includes(room.match.phase) || ![room.possession, room.players.find((p) => p.id !== room.possession)?.id].includes(socket.id)) return;
    const isGoal = room.match.phase === "GOAL";
    if (isGoal && !["LEFT","CENTER","RIGHT"].includes(move)) return;
    if (!isGoal && !passOptions(room).some((player) => player.id === move)) return;
    room.match.choices[socket.id] = move;
    if (Object.keys(room.match.choices).length < 2) return sendMatch(room);
    if (isGoal && resolveShot(room)) return;
    if (!isGoal) resolvePass(room);
    sendMatch(room);
  });
  socket.on("selectPenaltyShooter", ({ roomCode, playerId }) => {
    const room = rooms[roomCode], shootout = room?.shootout;
    if (!shootout || shootout.phase !== "SELECT" || shootout.currentTeam !== socket.id) return;
    const shooter = Object.values(room.teams[socket.id].positions).find((player) => player?.id === playerId);
    if (!shooter || shooter.position === "GK" || shootout.usedShooters[socket.id].includes(playerId)) return;
    shootout.usedShooters[socket.id].push(playerId);
    shootout.selectedShooter = shooter; shootout.phase = "DUEL"; shootout.choices = {};
    sendMatch(room);
  });
  socket.on("submitPenaltyDirection", ({ roomCode, direction }) => {
    const room = rooms[roomCode], shootout = room?.shootout;
    if (!shootout || shootout.phase !== "DUEL" || !["LEFT", "CENTER", "RIGHT"].includes(direction)) return;
    const defendId = room.players.find((p) => p.id !== shootout.currentTeam).id;
    if (socket.id !== shootout.currentTeam && socket.id !== defendId) return;
    shootout.choices[socket.id] = direction;
    if (Object.keys(shootout.choices).length === 2) resolvePenalty(room); else sendMatch(room);
  });
  socket.on("requestRematch", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || !room.players.some((player) => player.id === socket.id)) return;
    if (room.rematchVotes.includes(socket.id)) return;
    room.rematchVotes.push(socket.id);
    io.to(roomCode).emit("rematchRequested", { count:room.rematchVotes.length, total:room.players.length });
    if (room.rematchVotes.length < room.players.length) return;
    if (room.timer) clearInterval(room.timer);
    const reset = {
      roomCode:room.roomCode, mode:room.mode, goalLimit:room.goalLimit, matchMode:room.matchMode, timeLimit:room.timeLimit, players:room.players,
      readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{},
      draft:{ round:0, turnId:room.players[0].id, picks:{}, takenIds:[] },
      match:null, timer:null, finished:false, shootout:null, reconnectTimers:room.reconnectTimers, rematchVotes:[]
    };
    rooms[roomCode] = reset;
    io.to(roomCode).emit("rematchConfirmed", { room });
  });
  socket.on("leaveRoom", ({ roomCode }) => {
    const room = rooms[roomCode]; if (!room || !room.players.some((player) => player.id === socket.id)) return;
    if (room.timer) clearInterval(room.timer);
    room.players = room.players.filter((player) => player.id !== socket.id);
    delete room.reconnectTimers?.[socket.id];
    if (!room.players.length) { delete rooms[roomCode]; return; }
    io.to(roomCode).emit("opponentLeft", { name:room.players.find((player) => player.id !== socket.id)?.name });
  });
  socket.on("disconnect", () => { Object.keys(rooms).forEach((code) => { const room = rooms[code]; const player = room.players.find((participant) => participant.id === socket.id); if (!player) return; room.rematchVotes = room.rematchVotes.filter((id) => id !== socket.id); room.reconnectTimers ||= {}; room.reconnectTimers[socket.id] = setTimeout(() => { const currentRoom = rooms[code]; if (!currentRoom) return; currentRoom.players = currentRoom.players.filter((participant) => participant.id !== socket.id); delete currentRoom.reconnectTimers[socket.id]; if (!currentRoom.players.length) { if (currentRoom.timer) clearInterval(currentRoom.timer); delete rooms[code]; } }, 60000); }); });
});
const port = Number(process.env.PORT) || 5000;
server.listen(port, () => console.log(`Server running on ${port}`));
