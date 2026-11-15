const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const DATA_DIR = path.join(__dirname, "data");
const USERS_PATH = path.join(DATA_DIR, "users.json");
const INVITES_PATH = path.join(DATA_DIR, "invites.json");

const STATE = {
  users: {},
  queues: [],
  games: {},
  invites: [],
  userSockets: new Map(),
};

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!fs.existsSync(USERS_PATH)) {
    fs.writeFileSync(USERS_PATH, JSON.stringify({}, null, 2));
  }

  if (!fs.existsSync(INVITES_PATH)) {
    fs.writeFileSync(INVITES_PATH, JSON.stringify([], null, 2));
  }
}

function readJson(filePath, fallback) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return "";
  }
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : "";
}

function normalizeUsername(value) {
  if (typeof value !== "string") {
    return "";
  }
  const username = value.trim().replace(/\s+/g, "_").toLowerCase();
  return username.length ? username : "";
}

function defaultAvatar(seed) {
  const safeValue = encodeURIComponent(seed || "player");
  return `https://api.dicebear.com/7.x/adventurer/svg?seed=${safeValue}`;
}

function loadState() {
  STATE.users = readJson(USERS_PATH, {});
  STATE.invites = readJson(INVITES_PATH, []);
}

function saveUsers() {
  writeJson(USERS_PATH, STATE.users);
}

function saveInvites() {
  writeJson(INVITES_PATH, STATE.invites);
}

function getUser(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) {
    return null;
  }
  return STATE.users[normalized] || null;
}

function findUserByIdentifier(identifier) {
  const value = typeof identifier === "string" ? identifier.trim() : "";
  if (!value) {
    return null;
  }

  const byEmail = getUser(value);
  if (byEmail) {
    return byEmail;
  }

  const normalizedUsername = normalizeUsername(value);
  for (const user of Object.values(STATE.users)) {
    if (normalizeUsername(user.username || user.name) === normalizedUsername) {
      return user;
    }
  }

  return null;
}

function getLeaderboard() {
  return Object.values(STATE.users)
    .map((user) => ({
      email: user.email,
      username: user.username || user.name,
      name: user.name,
      avatar: user.avatar || defaultAvatar(user.email),
      wins: Number(user.wins || 0),
      losses: Number(user.losses || 0),
      draws: Number(user.draws || 0),
      score: (Number(user.wins || 0) * 3) + Number(user.draws || 0),
    }))
    .sort((a, b) => b.score - a.score || b.wins - a.wins || b.draws - a.draws)
    .slice(0, 12);
}

function serializeUser(user, includeHistory = false) {
  if (!user) {
    return null;
  }

  const payload = {
    email: user.email,
    username: user.username || user.name,
    name: user.name,
    avatar: user.avatar || defaultAvatar(user.email),
    wins: Number(user.wins || 0),
    losses: Number(user.losses || 0),
    draws: Number(user.draws || 0),
  };

  if (includeHistory) {
    payload.matchHistory = Array.isArray(user.matchHistory) ? user.matchHistory.slice(0, 12) : [];
  }

  return payload;
}

function buildProfilePayload(email) {
  const user = getUser(email);
  if (!user) {
    return null;
  }

  return {
    ...serializeUser(user, true),
    history: Array.isArray(user.matchHistory) ? user.matchHistory.slice(0, 12) : [],
  };
}

function loginUser(profile = {}) {
  const email = normalizeEmail(profile.email);
  const password = typeof profile.password === "string" ? profile.password : "";
  const usernameInput = normalizeUsername(profile.username || profile.name || (email ? email.split("@")[0] : ""));

  if (!email || !usernameInput || !password) {
    return { ok: false, reason: "Email, username, and password are required." };
  }

  const existingUsername = Object.values(STATE.users).find(
    (user) => user.email !== email && normalizeUsername(user.username || user.name) === usernameInput
  );

  if (existingUsername) {
    return { ok: false, reason: "That username is already taken." };
  }

  if (STATE.users[email]) {
    const user = STATE.users[email];
    if (user.password !== password) {
      return { ok: false, reason: "Incorrect password." };
    }

    user.username = usernameInput;
    user.name = profile.name || user.name || usernameInput;
    user.avatar = profile.avatar || user.avatar || defaultAvatar(email);
    saveUsers();
    return { ok: true, user };
  }

  STATE.users[email] = {
    email,
    username: usernameInput,
    name: profile.name || usernameInput,
    avatar: profile.avatar || defaultAvatar(email),
    password,
    wins: 0,
    losses: 0,
    draws: 0,
    friends: [],
    matchHistory: [],
  };

  saveUsers();
  return { ok: true, user: STATE.users[email] };
}

function getOnlineUsers() {
  return Array.from(STATE.userSockets.entries())
    .map(([email, socketId]) => {
      const user = getUser(email);
      if (!user) {
        return null;
      }
      return {
        email,
        name: user.name,
        username: user.username || user.name,
        avatar: user.avatar || defaultAvatar(email),
        socketId,
      };
    })
    .filter(Boolean);
}

function getFriends(email) {
  const user = getUser(email);
  if (!user) {
    return [];
  }

  return (user.friends || [])
    .map((friendEmail) => {
      const friend = getUser(friendEmail);
      if (!friend) {
        return null;
      }
      return {
        email: friend.email,
        username: friend.username || friend.name,
        name: friend.name,
        avatar: friend.avatar || defaultAvatar(friend.email),
        online: STATE.userSockets.has(friend.email),
      };
    })
    .filter(Boolean);
}

function addFriend(aEmail, bIdentifier) {
  const emailA = normalizeEmail(aEmail);
  const targetUser = findUserByIdentifier(bIdentifier);
  const emailB = targetUser ? normalizeEmail(targetUser.email) : "";

  if (!emailA || !emailB || emailA === emailB) {
    return false;
  }

  const aUser = STATE.users[emailA];
  const bUser = STATE.users[emailB];
  if (!aUser || !bUser) {
    return false;
  }

  const friendsA = new Set(aUser.friends || []);
  const friendsB = new Set(bUser.friends || []);

  friendsA.add(emailB);
  friendsB.add(emailA);

  aUser.friends = Array.from(friendsA);
  bUser.friends = Array.from(friendsB);

  saveUsers();
  return true;
}

function getPendingInvitesFor(email) {
  const normalized = normalizeEmail(email);
  return STATE.invites
    .filter((invite) => invite.to === normalized)
    .map((invite) => ({
      from: invite.from,
      to: invite.to,
      createdAt: invite.createdAt,
      fromName: getUser(invite.from)?.name || invite.from,
      fromUsername: getUser(invite.from)?.username || getUser(invite.from)?.name || invite.from,
      fromAvatar: getUser(invite.from)?.avatar || defaultAvatar(invite.from),
    }));
}

function removeInvite(from, to) {
  STATE.invites = STATE.invites.filter((invite) => !(invite.from === from && invite.to === to));
  saveInvites();
}

function sendFriendInvite(fromEmail, toIdentifier) {
  const from = normalizeEmail(fromEmail);
  const recipient = findUserByIdentifier(toIdentifier);
  const to = recipient ? normalizeEmail(recipient.email) : "";

  if (!from || !to || from === to) {
    return false;
  }

  const existing = STATE.invites.some((invite) => invite.from === from && invite.to === to);
  if (existing) {
    return false;
  }

  STATE.invites.push({ from, to, createdAt: Date.now() });
  saveInvites();
  return true;
}

function getSocketForUser(email) {
  const socketId = STATE.userSockets.get(normalizeEmail(email));
  if (!socketId) {
    return null;
  }
  return io.sockets.sockets.get(socketId) || null;
}

function buildPlayerSummary(playerEmail) {
  const user = getUser(playerEmail);
  return {
    email: playerEmail,
    name: user?.name || playerEmail,
    username: user?.username || user?.name || playerEmail,
    avatar: user?.avatar || defaultAvatar(playerEmail),
  };
}

function buildGamePayload(game, viewerEmail = null) {
  const players = (game.players || []).map((player) => {
    const fullUser = buildPlayerSummary(player.email);
    return {
      email: player.email,
      symbol: player.symbol,
      name: fullUser.name,
      username: fullUser.username,
      avatar: fullUser.avatar,
    };
  });

  return {
    id: game.id,
    board: [...game.board],
    players,
    currentTurn: game.currentTurn,
    turnDeadline: game.turnDeadline,
    inProgress: game.inProgress,
    winner: game.winner || null,
    draw: Boolean(game.draw),
    reason: game.reason || null,
    viewerEmail,
  };
}

function emitGameUpdate(game) {
  const payload = buildGamePayload(game);
  for (const player of game.players) {
    const socket = getSocketForUser(player.email);
    if (socket) {
      socket.emit("gameUpdate", {
        ...payload,
        viewerEmail: player.email,
      });
    }
  }
}

function recordMatchHistory(game, winnerEmail, reason) {
  if (!game || !Array.isArray(game.players)) {
    return;
  }

  const opponentByPlayer = game.players.reduce((accumulator, player) => {
    const opponent = game.players.find((entry) => entry.email !== player.email);
    accumulator[player.email] = opponent || null;
    return accumulator;
  }, {});

  game.players.forEach((player) => {
    const user = getUser(player.email);
    if (!user) {
      return;
    }

    const opponent = opponentByPlayer[player.email];
    const opponentUser = opponent ? getUser(opponent.email) : null;
    const result = winnerEmail
      ? player.email === winnerEmail ? "win" : "loss"
      : "draw";

    const entry = {
      id: game.id,
      date: new Date().toISOString(),
      opponent: opponent ? opponent.email : "None",
      opponentName: opponent ? (opponentUser?.name || opponent.email) : "None",
      opponentAvatar: opponent ? (opponentUser?.avatar || defaultAvatar(opponent.email)) : "",
      result,
      reason: reason || "completed",
      label: winnerEmail
        ? player.email === winnerEmail ? "Win" : "Loss"
        : "Draw",
    };

    user.matchHistory = Array.isArray(user.matchHistory) ? user.matchHistory : [];
    user.matchHistory.unshift(entry);
    user.matchHistory = user.matchHistory.slice(0, 20);
  });
}

function endGame(game, winnerEmail, reason) {
  if (!game || !game.inProgress) {
    return;
  }

  game.inProgress = false;
  game.winner = winnerEmail || null;
  game.reason = reason || "finished";
  game.draw = !winnerEmail;

  if (winnerEmail) {
    const winnerUser = getUser(winnerEmail);
    if (winnerUser) {
      winnerUser.wins = Number(winnerUser.wins || 0) + 1;
    }

    const loser = game.players.find((player) => player.email !== winnerEmail);
    if (loser) {
      const loserUser = getUser(loser.email);
      if (loserUser) {
        loserUser.losses = Number(loserUser.losses || 0) + 1;
      }
    }
  } else {
    game.players.forEach((player) => {
      const user = getUser(player.email);
      if (user) {
        user.draws = Number(user.draws || 0) + 1;
      }
    });
  }

  recordMatchHistory(game, winnerEmail, reason);
  saveUsers();
  emitGameUpdate(game);
  delete STATE.games[game.id];
}

function createGame(playerAEmail, playerBEmail) {
  const gameId = `game_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const game = {
    id: gameId,
    players: [
      { email: normalizeEmail(playerAEmail), symbol: "X" },
      { email: normalizeEmail(playerBEmail), symbol: "O" },
    ],
    board: Array(9).fill(""),
    currentTurn: "X",
    inProgress: true,
    winner: null,
    draw: false,
    reason: null,
    turnDeadline: Date.now() + 60000,
  };

  STATE.games[gameId] = game;
  emitGameUpdate(game);
  return game;
}

function checkWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return board[a];
    }
  }

  return null;
}

function handleMove(gameId, playerEmail, index) {
  const game = STATE.games[gameId];
  if (!game || !game.inProgress) {
    return;
  }

  if (typeof index !== "number" || index < 0 || index > 8) {
    return;
  }

  const currentPlayer = game.players.find((player) => player.symbol === game.currentTurn);
  if (!currentPlayer || currentPlayer.email !== normalizeEmail(playerEmail)) {
    return;
  }

  if (game.board[index]) {
    return;
  }

  game.board[index] = currentPlayer.symbol;
  const winner = checkWinner(game.board);

  if (winner) {
    endGame(game, game.players.find((player) => player.symbol === winner)?.email || null, "win");
    return;
  }

  if (game.board.every(Boolean)) {
    endGame(game, null, "draw");
    return;
  }

  const nextPlayer = game.players.find((player) => player.symbol !== currentPlayer.symbol);
  game.currentTurn = nextPlayer.symbol;
  game.turnDeadline = Date.now() + 60000;
  emitGameUpdate(game);
}

function handleResign(gameId, playerEmail) {
  const game = STATE.games[gameId];
  if (!game || !game.inProgress) {
    return;
  }

  const resigningPlayer = game.players.find((player) => player.email === normalizeEmail(playerEmail));
  if (!resigningPlayer) {
    return;
  }

  const winner = game.players.find((player) => player.email !== resigningPlayer.email);
  endGame(game, winner?.email || null, "resigned");
}

function matchPlayers() {
  if (STATE.queues.length < 2) {
    return;
  }

  const [firstEmail, secondEmail] = STATE.queues.splice(0, 2);
  const game = createGame(firstEmail, secondEmail);

  const firstSocket = getSocketForUser(firstEmail);
  const secondSocket = getSocketForUser(secondEmail);

  if (firstSocket) {
    firstSocket.emit("matchFound", { game: buildGamePayload(game, firstEmail) });
    firstSocket.emit("matchmakingStatus", { queued: false, message: "Match found!" });
  }

  if (secondSocket) {
    secondSocket.emit("matchFound", { game: buildGamePayload(game, secondEmail) });
    secondSocket.emit("matchmakingStatus", { queued: false, message: "Match found!" });
  }
}

io.on("connection", (socket) => {
  socket.on("login", (profile = {}) => {
    const result = loginUser(profile);
    if (!result.ok || !result.user) {
      socket.emit("errorMessage", result.reason || "Unable to sign in.");
      return;
    }

    const user = result.user;
    STATE.userSockets.set(user.email, socket.id);
    socket.data.userEmail = user.email;

    const summary = serializeUser(user);
    socket.emit("session", {
      user: summary,
      friends: getFriends(user.email),
      onlineUsers: getOnlineUsers(),
      leaderboard: getLeaderboard(),
      pendingInvites: getPendingInvitesFor(user.email),
    });

    io.emit("leaderboard", getLeaderboard());
    io.emit("onlineUsers", getOnlineUsers());
  });

  socket.on("register", (profile = {}) => {
    const result = loginUser(profile);
    if (!result.ok || !result.user) {
      socket.emit("errorMessage", result.reason || "Unable to create account.");
      return;
    }
    const user = result.user;
    STATE.userSockets.set(user.email, socket.id);
    socket.data.userEmail = user.email;
    socket.emit("session", {
      user: serializeUser(user),
      friends: getFriends(user.email),
      onlineUsers: getOnlineUsers(),
      leaderboard: getLeaderboard(),
      pendingInvites: getPendingInvitesFor(user.email),
    });
    io.emit("leaderboard", getLeaderboard());
    io.emit("onlineUsers", getOnlineUsers());
  });

  socket.on("getProfile", ({ email }) => {
    const targetEmail = normalizeEmail(email);
    if (!targetEmail) {
      socket.emit("errorMessage", "Profile not found.");
      return;
    }

    const profile = buildProfilePayload(targetEmail);
    if (!profile) {
      socket.emit("errorMessage", "Profile not found.");
      return;
    }

    socket.emit("profileData", profile);
  });

  socket.on("updateProfilePicture", ({ avatar }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    const nextAvatar = typeof avatar === "string" ? avatar.trim() : "";

    if (!currentEmail || !nextAvatar) {
      socket.emit("errorMessage", "Please provide a valid image URL.");
      return;
    }

    const user = getUser(currentEmail);
    if (!user) {
      socket.emit("errorMessage", "Unable to update profile picture.");
      return;
    }

    user.avatar = nextAvatar;
    saveUsers();

    const summary = serializeUser(user, true);
    socket.emit("session", {
      user: summary,
      friends: getFriends(currentEmail),
      onlineUsers: getOnlineUsers(),
      leaderboard: getLeaderboard(),
      pendingInvites: getPendingInvitesFor(currentEmail),
    });
    io.emit("leaderboard", getLeaderboard());
    socket.emit("successMessage", "Profile picture updated.");
  });

  socket.on("queueForMatch", () => {
    const email = normalizeEmail(socket.data.userEmail);
    if (!email) {
      socket.emit("errorMessage", "You must sign in before playing.");
      return;
    }

    if (!STATE.queues.includes(email)) {
      STATE.queues.push(email);
    }

    socket.emit("matchmakingStatus", {
      queued: true,
      message: "Looking for a random opponent...",
    });

    if (STATE.queues.length >= 2) {
      matchPlayers();
    }
  });

  socket.on("cancelQueue", () => {
    const email = normalizeEmail(socket.data.userEmail);
    STATE.queues = STATE.queues.filter((queuedEmail) => queuedEmail !== email);
    socket.emit("matchmakingStatus", { queued: false, message: "Queue cancelled." });
  });

  socket.on("addFriend", ({ username, email }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    const friendLookup = username || email;
    const resolvedUser = findUserByIdentifier(friendLookup);

    if (!currentEmail || !resolvedUser || currentEmail === resolvedUser.email) {
      socket.emit("errorMessage", "Choose a valid friend username or email.");
      return;
    }

    if (addFriend(currentEmail, resolvedUser.email)) {
      socket.emit("friends", getFriends(currentEmail));
      const recipientSocket = getSocketForUser(resolvedUser.email);
      if (recipientSocket) {
        recipientSocket.emit("friends", getFriends(resolvedUser.email));
      }
      socket.emit("successMessage", `${resolvedUser.name || resolvedUser.email} was added as a friend.`);
    } else {
      socket.emit("errorMessage", "Friend could not be added.");
    }
  });

  socket.on("sendFriendInvite", ({ username, email }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    const recipientLookup = username || email;
    const recipientUser = findUserByIdentifier(recipientLookup);

    if (!currentEmail || !recipientUser) {
      socket.emit("errorMessage", "Please provide a valid friend username or email.");
      return;
    }

    if (sendFriendInvite(currentEmail, recipientUser.email)) {
      const recipientSocket = getSocketForUser(recipientUser.email);
      if (recipientSocket) {
        recipientSocket.emit("pendingInvites", getPendingInvitesFor(recipientUser.email));
      }
      socket.emit("pendingInvites", getPendingInvitesFor(currentEmail));
      socket.emit("successMessage", `Friend request sent to ${recipientUser.name || recipientUser.email}.`);
    } else {
      socket.emit("errorMessage", "Invite already exists or is invalid.");
    }
  });

  socket.on("acceptFriendInvite", ({ fromEmail, fromUsername }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    const senderLookup = fromEmail || fromUsername;
    const senderUser = findUserByIdentifier(senderLookup);
    const senderEmail = senderUser ? normalizeEmail(senderUser.email) : normalizeEmail(fromEmail);

    if (!currentEmail || !senderEmail) {
      socket.emit("errorMessage", "Could not accept invite.");
      return;
    }

    addFriend(currentEmail, senderEmail);
    removeInvite(senderEmail, currentEmail);

    socket.emit("friends", getFriends(currentEmail));
    socket.emit("pendingInvites", getPendingInvitesFor(currentEmail));

    const senderSocket = getSocketForUser(senderEmail);
    if (senderSocket) {
      senderSocket.emit("friends", getFriends(senderEmail));
      senderSocket.emit("pendingInvites", getPendingInvitesFor(senderEmail));
    }
  });

  socket.on("makeMove", ({ gameId, index }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    if (!currentEmail) {
      socket.emit("errorMessage", "You must sign in before playing.");
      return;
    }
    handleMove(gameId, currentEmail, Number(index));
  });

  socket.on("resignGame", ({ gameId }) => {
    const currentEmail = normalizeEmail(socket.data.userEmail);
    if (!currentEmail) {
      return;
    }
    handleResign(gameId, currentEmail);
  });

  socket.on("disconnect", () => {
    if (socket.data.userEmail) {
      STATE.userSockets.delete(normalizeEmail(socket.data.userEmail));
      STATE.queues = STATE.queues.filter((email) => email !== normalizeEmail(socket.data.userEmail));
      io.emit("onlineUsers", getOnlineUsers());
      io.emit("leaderboard", getLeaderboard());
    }
  });
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    users: Object.keys(STATE.users).length,
    activeGames: Object.keys(STATE.games).length,
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

ensureDataFiles();
loadState();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`TTT server running at http://localhost:${PORT}`);
});

setInterval(() => {
  const now = Date.now();
  Object.values(STATE.games).forEach((game) => {
    if (!game.inProgress) {
      return;
    }

    if (now >= game.turnDeadline) {
      const opponent = game.players.find((player) => player.symbol !== game.currentTurn);
      endGame(game, opponent?.email || null, "timeout");
    }
  });
}, 1000);
