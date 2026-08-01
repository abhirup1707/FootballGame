const express = require("express");
const http = require("http");
const cors = require("cors");
const { Server } = require("socket.io");

const app = express();
app.use(cors());
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const rooms = {};
const DRAFT_ROUNDS = [...Array(6).fill("ATT"), ...Array(6).fill("MID"), ...Array(8).fill("DEF"), ...Array(2).fill("GK")];
const PASS_TARGETS = {
  GK:["LB","CB1","CB2","RB"], LB:["GK","CB1","CM1","LW"], CB1:["GK","LB","CB2","CM1","CAM"], CB2:["GK","CB1","RB","CM2","CAM"], RB:["GK","CB2","CM2","RW"],
  CM1:["LB","CB1","CM2","CAM","LW","ST"], CM2:["CB2","RB","CM1","CAM","ST","RW"], CAM:["CM1","CM2","LW","ST","RW"], LW:["LB","CM1","CAM","ST"], ST:["LW","CAM","RW"], RW:["RB","CM2","CAM","ST"],
};
const PITCH_COORDINATES = { GK:[50,88], LB:[17,70], CB1:[38,74], CB2:[62,74], RB:[83,70], CM1:[32,53], CM2:[68,53], CAM:[50,43], LW:[19,25], ST:[50,18], RW:[81,25] };
const randomItem = (items) => items[Math.floor(Math.random() * items.length)];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function draftPayload(room) { return { turnId:room.draft.turnId, round:room.draft.round, category:DRAFT_ROUNDS[room.draft.round] || null, picks:room.draft.picks, complete:room.draft.round >= DRAFT_ROUNDS.length }; }
function sendDraftState(room) { io.to(room.roomCode).emit("draftState", draftPayload(room)); }
function playerPosition(team, playerId) { return Object.keys(team.positions).find((key) => team.positions[key]?.id === playerId); }
function passOptions(room) {
  if (room.match.phase !== "PASS") return [];
  const team = room.teams[room.possession];
  const carrierPosition = playerPosition(team, room.match.carrier.id);
  return (PASS_TARGETS[carrierPosition] || []).map((key) => team.positions[key]).filter(Boolean);
}
function matchPayload(room) {
  const options = passOptions(room);
  return { teams:room.teams, scoreA:room.scoreA, scoreB:room.scoreB, possession:room.possession, commentary:room.commentary, stats:room.stats,
    config:{ mode:room.matchMode, goalLimit:room.goalLimit, timeLimit:room.timeLimit }, elapsedMs:Math.max(0, Date.now() - (room.matchStartedAt || Date.now())),
    shootout:room.shootout || null,
    match: { phase:room.match.phase, passCount:room.match.passCount, carrier:room.match.carrier, options, choicesLocked:Object.keys(room.match.choices).length } };
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
  addStory(room, `✨ ${carrier.name} ${flair} — a clean pass reaches ${receiver.name}.`);
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
  // A shot to the same side is not automatically saved: rating gives the scorer an edge.
  const goalChance = clamp(60 + (shooter.rating - keeper.rating) * 3, 35, 82);
  const goal = !matched || Math.random() * 100 < goalChance;
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
  socket.on("createRoom", ({ playerName, goalLimit, matchMode, timeLimit }) => {
    const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    rooms[roomCode] = { roomCode, goalLimit:[1,3,5].includes(Number(goalLimit)) ? Number(goalLimit) : 3, matchMode:matchMode === "time" ? "time" : "goals", timeLimit:[90,120,150,180].includes(Number(timeLimit)) ? Number(timeLimit) : 90, players:[{ id:socket.id, name:playerName }], readyPlayers:0, teams:{}, scoreA:0, scoreB:0, possession:null, commentary:[], stats:{}, draft:{ round:0, turnId:socket.id, picks:{}, takenIds:[] }, match:null, timer:null, finished:false, shootout:null };
    socket.join(roomCode); socket.emit("roomCreated", roomCode);
  });
  socket.on("joinRoom", ({ roomCode, playerName }) => {
    const room = rooms[roomCode];
    if (!room) return socket.emit("errorMessage", "Room not found");
    if (room.players.length >= 2) return socket.emit("errorMessage", "Room full");
    room.players.push({ id:socket.id, name:playerName }); socket.join(roomCode);
    io.to(roomCode).emit("roomReady", room); sendDraftState(room);
  });
  socket.on("getDraftState", ({ roomCode }) => { const room = rooms[roomCode]; if (room) socket.emit("draftState", draftPayload(room)); });
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
    room.teams[socket.id] = { positions, overall }; room.readyPlayers += 1; io.to(roomCode).emit("readyCount", room.readyPlayers);
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
  socket.on("disconnect", () => { Object.keys(rooms).forEach((code) => { const room = rooms[code]; room.players = room.players.filter((player) => player.id !== socket.id); if (!room.players.length) { if (room.timer) clearInterval(room.timer); delete rooms[code]; } }); });
});
server.listen(5000, () => console.log("Server running on 5000"));
