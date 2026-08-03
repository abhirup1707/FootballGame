const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : "*";
const corsOptions = { origin: allowedOrigins };

app.use(cors(corsOptions));
app.get("/health", (_req, res) => res.status(200).json({ status: "ok" }));
const server = http.createServer(app);
const io = new Server(server, { cors: corsOptions });
const rooms = {};
const DRAFT_ROUNDS = [...Array(6).fill("ATT"), ...Array(6).fill("MID"), ...Array(8).fill("DEF"), ...Array(2).fill("GK")];
const PITCH_COORDINATES = { GK:[50,88], LB:[17,70], CB1:[38,74], CB2:[62,74], RB:[83,70], CM1:[32,53], CM2:[68,53], CAM:[50,43], LW:[19,25], ST:[50,18], RW:[81,25] };
const FORMATION_CATEGORY = { GK:"GK", LB:"DEF", CB1:"DEF", CB2:"DEF", RB:"DEF", CM1:"MID", CM2:"MID", CAM:"MID", LW:"ATT", ST:"ATT", RW:"ATT" };
const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
function validLineup(room, playerId, positions) {
  const drafted = room.draft.picks[playerId] || [];
  if (!positions || drafted.length !== Object.keys(FORMATION_CATEGORY).length) return false;
  const draftedById = new Map(drafted.map((player) => [player.id, player]));
  const usedIds = new Set();
  return Object.entries(FORMATION_CATEGORY).every(([slot, category]) => {
    const player = positions[slot], draftedPlayer = player && draftedById.get(player.id);
    if (!draftedPlayer || draftedPlayer.position !== category || usedIds.has(player.id)) return false;
    usedIds.add(player.id);
    return true;
  }) && usedIds.size === drafted.length;
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
    match: { phase:room.match.phase, passCount:room.match.passCount, carrier:room.match.carrier, lastPass:room.match.lastPass || null, options, choicesLocked:Object.keys(room.match.choices).length } };
}
function sendMatch(room, event = "matchUpdate") { io.to(room.roomCode).emit(event, matchPayload(room)); }
function finishMatch(room) {
  if (room.finished) return;
  room.finished = true;
  if (room.timer) clearInterval(room.timer);
  io.to(room.roomCode).emit("matchFinished", { scoreA:room.scoreA, scoreB:room.scoreB, stats:room.stats, shootout:room.shootout || null });
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
  const shot = shootout.choices[attackId], dive = shootout.choices[defendId], goal = shot !== dive;
  shootout.kicks[attackId].push(goal); shootout.result = { attackId, shooter:shootout.selectedShooter, keeper:room.teams[defendId].positions.GK, shot, dive, goal };
  shootout.phase = "RESULT";
  addStory(room, goal ? `GOAL! ${shootout.selectedShooter.name} sends ${room.teams[defendId].positions.GK.name} the wrong way.` : `SAVED! ${room.teams[defendId].positions.GK.name} reads the penalty.`);
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
    } else sendMatch(room);
  }, 250);
}
function addStory(room, line) { room.commentary.unshift(line); room.commentary = room.commentary.slice(0, 5); }
function startPossession(room, teamId, story, carrier) {
  room.possession = teamId;
  const team = room.teams[teamId];
  const openingCarrier = carrier || room.nextKickoffCarrier || randomItem([team.positions.CB1, team.positions.CB2].filter(Boolean));
  delete room.nextKickoffCarrier;
  room.match = { phase:"PASS", passCount:0, carrier:openingCarrier, choices:{} };
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
  return players.reduce((sum, player) => sum + player.rating, 0) / players.length;
}
function resolvePass(room) {
  const attackId = room.possession;
  const defendId = room.players.find((player) => player.id !== attackId).id;
  const receiver = passOptions(room).find((player) => player.id === room.match.choices[attackId]);
  const markedId = room.match.choices[defendId];
  if (!receiver) return;
  const carrier = room.match.carrier;
  const markedCorrectly = markedId === receiver.id;
  const interceptionChance = clamp(35 + (averageDefence(room.teams[defendId]) - receiver.rating) * 2.5, 18, 72);
  const intercepted = markedCorrectly;
  room.match.choices = {};
  if (intercepted) {
    const interceptor = closestDefender(room, defendId, receiver);
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
    room.stats[defendId].interceptions += 1;
    addStory(room, `🧤 READ PERFECTLY — ${room.players.find((p) => p.id === defendId).name} closes down ${receiver.name} and wins it.`);
    startPossession(room, defendId);
    return;
  }
  room.match.carrier = receiver;
  room.match.passCount += 1;
  room.stats[attackId].passes += 1;
  const flair = markedCorrectly ? "beats the marker" : "finds space";
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
  // If the keeper covers the selected side, the shot is saved.
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

io.on("connection", (socket) => {
  socket.on("createRoom", ({ playerName, goalLimit, matchMode, timeLimit, resumeToken }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { roomCode, goalLimit:[1,3,5].includes(Number(goalLimit)) ? Number(goalLimit) : 3, matchMode:matchMode === "time" ? "time" : "goals", timeLimit:[90,120,150,180].includes(Number(timeLimit)) ? Number(timeLimit) : 90, players:[{ id:socket.id, name:playerName, resumeToken }], readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{}, draft:{ round:0, turnId:socket.id, picks:{}, takenIds:[] }, match:null, timer:null, finished:false, shootout:null, reconnectTimers:{} };
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
      socket.emit("roomReady", room); return;
    }
    if (room.players.length >= 2) return socket.emit("errorMessage", "Room full");
    room.players.push({ id:socket.id, name:playerName, resumeToken }); socket.join(roomCode);
    io.to(roomCode).emit("roomReady", room); sendDraftState(room);
  });
  socket.on("getDraftState", ({ roomCode }) => { const room = rooms[roomCode]; if (!room) return; socket.emit("draftState", draftPayload(room)); if (room.match) socket.emit("enterMatch", matchPayload(room)); });
  socket.on("requestDraftPack", ({ roomCode, players }) => {
    const room = rooms[roomCode]; if (!room || room.draft.turnId !== socket.id) return;
    const category = DRAFT_ROUNDS[room.draft.round];
    const pack = (players || []).filter((player) => player.position === category && !room.draft.takenIds.includes(player.id)).sort(() => Math.random() - .5).slice(0, 4);
    socket.emit("draftPack", { pack, category });
  });
  socket.on("draftPick", ({ roomCode, player, allPlayers }) => {
    const room = rooms[roomCode], category = room && DRAFT_ROUNDS[room.draft.round];
    if (!room || room.draft.turnId !== socket.id || !player) return;
    const valid = (allPlayers || []).find((candidate) => candidate.id === player.id && candidate.position === category);
    if (!valid || room.draft.takenIds.includes(valid.id)) return;
    room.draft.takenIds.push(valid.id); room.draft.picks[socket.id] = [...(room.draft.picks[socket.id] || []), valid]; room.draft.round += 1;
    room.draft.turnId = room.players.find((participant) => participant.id !== socket.id)?.id || socket.id; sendDraftState(room);
  });
  socket.on("playerReady", ({ roomCode, positions, overall }) => {
    const room = rooms[roomCode]; if (!room || room.teams[socket.id]) return;
    if (!validLineup(room, socket.id, positions)) return socket.emit("errorMessage", "Your lineup must keep each player in their own category.");
    const verifiedOverall = Number((Object.keys(FORMATION_CATEGORY).reduce((sum, slot) => sum + positions[slot].rating, 0) / Object.keys(FORMATION_CATEGORY).length).toFixed(1));
    room.teams[socket.id] = { positions, overall:verifiedOverall }; room.readyPlayers += 1; io.to(roomCode).emit("readyCount", room.readyPlayers);
    if (room.readyPlayers === 2) {
      const [first, second] = room.players.map((player) => player.id);
      room.stats = { [first]:{ passes:0, interceptions:0, goals:[] }, [second]:{ passes:0, interceptions:0, goals:[] } };
      const kickoffId = room.teams[first].overall >= room.teams[second].overall ? first : second;
      room.nextKickoffCarrier = highestRatedPlayer(room.teams[kickoffId]);
      startPossession(room, room.teams[first].overall >= room.teams[second].overall ? first : second, "🏟️ Kick-off! The higher-rated side starts from the back.");
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
  socket.on("disconnect", () => { Object.keys(rooms).forEach((code) => { const room = rooms[code]; const player = room.players.find((participant) => participant.id === socket.id); if (!player) return; room.reconnectTimers ||= {}; room.reconnectTimers[socket.id] = setTimeout(() => { const currentRoom = rooms[code]; if (!currentRoom) return; currentRoom.players = currentRoom.players.filter((participant) => participant.id !== socket.id); delete currentRoom.reconnectTimers[socket.id]; if (!currentRoom.players.length) { if (currentRoom.timer) clearInterval(currentRoom.timer); delete rooms[code]; } }, 60000); }); });
});
const port = Number(process.env.PORT) || 5000;
server.listen(port, () => console.log(`Server running on ${port}`));
