const socket = io();

const state = {
  user: null,
  leaderboard: [],
  friends: [],
  invites: [],
  onlineUsers: [],
  game: null,
  audioContext: null,
  friendPanelOpen: false,
  session: null,
};

const SESSION_STORAGE_KEY = "ttt_league_session";

const loginScreen = document.getElementById("loginScreen");
const gameApp = document.getElementById("gameApp");
const authForm = document.getElementById("authForm");
const accessArenaBtn = document.getElementById("accessArenaBtn");
const emailInput = document.getElementById("emailInput");
const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const avatarInput = document.getElementById("avatarInput");
const profileCard = document.getElementById("profileCard");
const profileAvatar = document.getElementById("profileAvatar");
const profileName = document.getElementById("profileName");
const profileEmail = document.getElementById("profileEmail");
const profileWins = document.getElementById("profileWins");
const profileDraws = document.getElementById("profileDraws");
const profileLosses = document.getElementById("profileLosses");
const leaderboardList = document.getElementById("leaderboardList");
const friendList = document.getElementById("friendList");
const inviteList = document.getElementById("inviteList");
const statusBanner = document.getElementById("statusBanner");
const turnInfo = document.getElementById("turnInfo");
const clockDisplay = document.getElementById("clockDisplay");
const toggleFriendPanelBtn = document.getElementById("toggleFriendPanelBtn");
const friendPanel = document.getElementById("friendPanel");
const changeAvatarBtn = document.getElementById("changeAvatarBtn");
const profileModal = document.getElementById("profileModal");
const profileModalClose = document.getElementById("profileModalClose");
const profileModalAvatar = document.getElementById("profileModalAvatar");
const profileModalName = document.getElementById("profileModalName");
const profileModalEmail = document.getElementById("profileModalEmail");
const profileModalWins = document.getElementById("profileModalWins");
const profileModalDraws = document.getElementById("profileModalDraws");
const profileModalLosses = document.getElementById("profileModalLosses");
const profileModalHistory = document.getElementById("profileModalHistory");
const cells = [...document.querySelectorAll(".cell")];

function showGameApp() {
  loginScreen.classList.add("hidden");
  gameApp.classList.remove("hidden");
}

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  gameApp.classList.add("hidden");
}

function saveSession(profile) {
  if (!profile || !profile.email || !profile.password) {
    return;
  }

  const session = {
    email: profile.email,
    username: profile.username || profile.name || profile.email.split("@")[0],
    password: profile.password,
    avatar: profile.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(profile.email)}`,
  };

  state.session = session;
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  state.session = null;
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

function restoreSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || "null");
    if (!saved || !saved.email || !saved.password || !saved.username) {
      return;
    }

    emailInput.value = saved.email;
    usernameInput.value = saved.username;
    passwordInput.value = saved.password;
    avatarInput.value = saved.avatar || "";

    socket.emit("login", {
      email: saved.email,
      username: saved.username,
      password: saved.password,
      name: saved.username,
      avatar: saved.avatar || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(saved.email)}`,
    });
  } catch (error) {
    clearSession();
  }
}

function setBanner(message, type = "info") {
  if (!statusBanner) {
    return;
  }

  statusBanner.textContent = message;
  statusBanner.style.borderColor = type === "error" ? "rgba(239,68,68,0.4)" : type === "success" ? "rgba(34,197,94,0.4)" : "rgba(148,163,184,0.2)";
  statusBanner.style.background = type === "error" ? "rgba(127,29,29,0.25)" : type === "success" ? "rgba(20,83,45,0.2)" : "rgba(15,23,42,0.7)";
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function playMoveSound() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) {
    return;
  }

  const audioContext = state.audioContext || new AudioCtor();
  state.audioContext = audioContext;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();

  oscillator.type = "triangle";
  oscillator.frequency.value = 520;
  gain.gain.value = 0.04;

  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.08);
}

function updateProfileCard() {
  if (!state.user) {
    profileCard.classList.add("hidden");
    return;
  }

  profileCard.classList.remove("hidden");
  profileAvatar.src = state.user.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=player";
  profileName.textContent = state.user.name;
  profileEmail.textContent = state.user.email;
  profileWins.textContent = state.user.wins ?? 0;
  profileDraws.textContent = state.user.draws ?? 0;
  profileLosses.textContent = state.user.losses ?? 0;
}

function renderProfileModal(profile) {
  if (!profile) {
    profileModal.classList.add("hidden");
    return;
  }

  profileModalAvatar.src = profile.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=profile";
  profileModalName.textContent = profile.name || profile.username || "Player";
  profileModalEmail.textContent = profile.email || "Unknown";
  profileModalWins.textContent = profile.wins ?? 0;
  profileModalDraws.textContent = profile.draws ?? 0;
  profileModalLosses.textContent = profile.losses ?? 0;

  profileModalHistory.innerHTML = "";
  const history = Array.isArray(profile.history) ? profile.history : profile.matchHistory || [];

  if (!history.length) {
    profileModalHistory.innerHTML = "<div class='history-item'><span>No matches logged yet.</span></div>";
    profileModal.classList.remove("hidden");
    return;
  }

  history.forEach((match) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div class="history-player">
        <img src="${match.opponentAvatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=opponent"}" alt="${match.opponentName || "Opponent"}" />
        <div>
          <strong>${match.opponentName || "Opponent"}</strong><br />
          <small>${new Date(match.date || Date.now()).toLocaleDateString()}</small>
        </div>
      </div>
      <span class="history-result ${match.result || "draw"}">${match.label || "Draw"}</span>
    `;
    profileModalHistory.appendChild(item);
  });

  profileModal.classList.remove("hidden");
}

function openProfileModal(email) {
  if (!email) {
    return;
  }

  socket.emit("getProfile", { email });
}

function renderLeaderboard() {
  leaderboardList.innerHTML = "";

  if (!state.leaderboard.length) {
    leaderboardList.innerHTML = "<div class='leader-row'><span>No ranked players yet.</span></div>";
    return;
  }

  state.leaderboard.forEach((player, index) => {
    const row = document.createElement("div");
    row.className = "leader-row";
    row.dataset.profileEmail = player.email;
    row.innerHTML = `
      <div class="name-wrap">
        <span class="leader-rank">#${index + 1}</span>
        <img src="${player.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=rank"}" alt="${player.name}" />
        <span>${player.name}</span>
      </div>
      <div class="player-record">${player.wins}W / ${player.draws}D / ${player.losses}L</div>
    `;
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      openProfileModal(player.email);
    });
    leaderboardList.appendChild(row);
  });
}

function renderFriends() {
  friendList.innerHTML = "";

  if (!state.friends.length) {
    friendList.innerHTML = "<div class='friend-row'><span>No friends yet.</span></div>";
    return;
  }

  state.friends.forEach((friend) => {
    const row = document.createElement("div");
    row.className = "friend-row";
    row.dataset.profileEmail = friend.email;
    row.innerHTML = `
      <div class="name-wrap">
        <img src="${friend.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=friend"}" alt="${friend.name}" />
        <span>${friend.name}</span>
      </div>
      <button data-email="${friend.email}">Challenge</button>
    `;
    row.addEventListener("click", (event) => {
      if (event.target.closest("button")) {
        return;
      }
      openProfileModal(friend.email);
    });
    const button = row.querySelector("button");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      socket.emit("sendFriendInvite", { email: friend.email });
    });
    friendList.appendChild(row);
  });
}

function renderInvites() {
  inviteList.innerHTML = "";

  if (!state.invites.length) {
    inviteList.innerHTML = "<div class='invite-row'><span>No pending invites.</span></div>";
    return;
  }

  state.invites.forEach((invite) => {
    const row = document.createElement("div");
    row.className = "invite-row";
    row.innerHTML = `
      <div class="name-wrap">
        <img src="${invite.fromAvatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=invite"}" alt="${invite.fromName}" />
        <span>${invite.fromName}</span>
      </div>
      <button data-from="${invite.from}">Accept</button>
    `;
    const button = row.querySelector("button");
    button.addEventListener("click", () => {
      socket.emit("acceptFriendInvite", { fromEmail: invite.from });
    });
    inviteList.appendChild(row);
  });
}

function getCurrentSymbol() {
  if (!state.game || !state.user) {
    return null;
  }

  if (state.game.mode === "bot") {
    return "X";
  }

  const player = state.game.players.find((entry) => entry.email === state.user.email);
  return player ? player.symbol : null;
}

function getCurrentPlayerName() {
  if (!state.game) {
    return "";
  }

  const player = state.game.players.find((entry) => entry.symbol === state.game.currentTurn);
  return player ? player.name : "";
}

function renderBoard() {
  if (!state.game) {
    cells.forEach((button) => {
      button.textContent = "";
      button.disabled = true;
      button.classList.remove("filled-x", "filled-o");
    });
    turnInfo.textContent = "Waiting for account sign-in.";
    clockDisplay.textContent = "01:00";
    return;
  }

  const board = state.game.board || Array(9).fill("");
  const isBotGame = state.game.mode === "bot";
  const currentPlayer = state.game.players.find((player) => player.symbol === state.game.currentTurn);
  const isMyTurn = isBotGame ? state.game.currentTurn === "X" : currentPlayer && currentPlayer.email === state.user?.email;

  cells.forEach((button) => {
    const value = board[Number(button.dataset.index)];
    button.textContent = value || "";
    button.classList.toggle("filled-x", value === "X");
    button.classList.toggle("filled-o", value === "O");

    const isDisabled = Boolean(value) || !state.game.inProgress || (!isBotGame && !isMyTurn) || (isBotGame && !isMyTurn);
    button.disabled = isDisabled;
  });

  if (state.game.reason === "win" || state.game.reason === "timeout" || state.game.reason === "resigned" || state.game.draw) {
    if (state.game.draw) {
      setBanner("Draw game. The board is full.", "success");
      turnInfo.textContent = "Draw — nobody takes the round.";
    } else if (state.game.winner) {
      const winnerUser = state.game.players.find((player) => player.email === state.game.winner);
      const winnerName = winnerUser ? winnerUser.name : "Winner";
      const reasonText = state.game.reason === "timeout" ? "time ran out" : state.game.reason === "resigned" ? "the opponent resigned" : "won the round";
      setBanner(`${winnerName} ${reasonText}.`, "success");
      turnInfo.textContent = `${winnerName} wins!`;
    }
  } else if (state.game.mode === "bot") {
    setBanner(state.game.currentTurn === "X" ? "Your move." : "Bot is thinking...", state.game.currentTurn === "X" ? "info" : "warning");
    turnInfo.textContent = state.game.currentTurn === "X" ? "Your turn." : "Bot to move.";
  } else {
    const currentTurnName = getCurrentPlayerName();
    turnInfo.textContent = currentTurnName ? `${currentTurnName}'s turn` : "Waiting for game state...";
    if (currentPlayer) {
      setBanner(`${currentTurnName} to move.`, "info");
    }
  }

  const deadlineMs = state.game.turnDeadline ? state.game.turnDeadline - Date.now() : 60000;
  clockDisplay.textContent = formatClock(deadlineMs);
}

function runLocalBotMove() {
  if (!state.game || state.game.mode !== "bot" || state.game.currentTurn !== "O") {
    return;
  }

  const moveIndex = getBestBotMove(state.game.board);
  if (moveIndex === null) {
    state.game.currentTurn = "X";
    state.game.turnDeadline = Date.now() + 60000;
    renderBoard();
    return;
  }

  state.game.board[moveIndex] = "O";
  const winnerSymbol = getWinnerSymbol(state.game.board);

  if (winnerSymbol) {
    state.game.inProgress = false;
    state.game.winner = "BOT";
    state.game.reason = "win";
    state.game.draw = false;
    turnInfo.textContent = "Bot wins this round.";
    setBanner("Bot wins. Try another match!", "success");
    renderBoard();
    return;
  }

  if (state.game.board.every(Boolean)) {
    state.game.inProgress = false;
    state.game.draw = true;
    state.game.reason = "draw";
    turnInfo.textContent = "Draw game.";
    setBanner("Board full — draw!", "success");
    renderBoard();
    return;
  }

  state.game.currentTurn = "X";
  state.game.turnDeadline = Date.now() + 60000;
  renderBoard();
}

function getWinnerSymbol(board) {
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

function getBestBotMove(board) {
  let bestScore = -Infinity;
  let bestMove = null;

  for (let index = 0; index < board.length; index += 1) {
    if (board[index]) {
      continue;
    }

    board[index] = "O";
    const score = minimax(board, 0, false);
    board[index] = "";

    if (score > bestScore) {
      bestScore = score;
      bestMove = index;
    }
  }

  return bestMove;
}

function minimax(board, depth, isMaximizing) {
  const winner = getWinnerSymbol(board);

  if (winner === "O") {
    return 10 - depth;
  }
  if (winner === "X") {
    return depth - 10;
  }
  if (board.every(Boolean)) {
    return 0;
  }

  if (isMaximizing) {
    let bestScore = -Infinity;
    for (let index = 0; index < board.length; index += 1) {
      if (!board[index]) {
        board[index] = "O";
        bestScore = Math.max(bestScore, minimax(board, depth + 1, false));
        board[index] = "";
      }
    }
    return bestScore;
  }

  let bestScore = Infinity;
  for (let index = 0; index < board.length; index += 1) {
    if (!board[index]) {
      board[index] = "X";
      bestScore = Math.min(bestScore, minimax(board, depth + 1, true));
      board[index] = "";
    }
  }
  return bestScore;
}

function handleLocalMove(index) {
  if (!state.game || state.game.mode !== "bot") {
    return;
  }

  if (state.game.currentTurn !== "X" || state.game.board[index] || !state.game.inProgress) {
    return;
  }

  state.game.board[index] = "X";
  playMoveSound();
  const winnerSymbol = getWinnerSymbol(state.game.board);

  if (winnerSymbol) {
    state.game.inProgress = false;
    state.game.winner = state.user.email;
    state.game.reason = "win";
    state.game.draw = false;
    setBanner("You win! Great job.", "success");
    turnInfo.textContent = "You win this round!";
    renderBoard();
    return;
  }

  if (state.game.board.every(Boolean)) {
    state.game.inProgress = false;
    state.game.draw = true;
    state.game.reason = "draw";
    turnInfo.textContent = "Draw game.";
    setBanner("Nobody wins — draw.", "success");
    renderBoard();
    return;
  }

  state.game.currentTurn = "O";
  state.game.turnDeadline = Date.now() + 60000;
  renderBoard();
  setTimeout(() => runLocalBotMove(), 550);
}

function startBotGame() {
  state.game = {
    mode: "bot",
    id: `bot-${Date.now()}`,
    board: Array(9).fill(""),
    currentTurn: "X",
    inProgress: true,
    winner: null,
    draw: false,
    reason: null,
    turnDeadline: Date.now() + 60000,
    players: [
      { email: state.user.email, name: state.user.name, symbol: "X", avatar: state.user.avatar },
      { email: "BOT", name: "Bot", symbol: "O", avatar: "https://api.dicebear.com/7.x/bottts/svg?seed=tttbot" },
    ],
  };
  setBanner("Bot match started. You move first.", "info");
  turnInfo.textContent = "Your turn.";
  renderBoard();
}

function handleCellClick(event) {
  const button = event.currentTarget;
  const index = Number(button.dataset.index);

  if (!state.user) {
    setBanner("Sign in with your email before playing.", "error");
    return;
  }

  if (!state.game) {
    return;
  }

  if (state.game.mode === "bot") {
    handleLocalMove(index);
    return;
  }

  if (!state.game.inProgress || !state.user) {
    return;
  }

  const currentPlayer = state.game.players.find((player) => player.symbol === state.game.currentTurn);
  if (!currentPlayer || currentPlayer.email !== state.user.email) {
    return;
  }

  playMoveSound();
  socket.emit("makeMove", { gameId: state.game.id, index });
}

cells.forEach((cell) => cell.addEventListener("click", handleCellClick));

toggleFriendPanelBtn.addEventListener("click", () => {
  state.friendPanelOpen = !state.friendPanelOpen;
  friendPanel.classList.toggle("collapsed", !state.friendPanelOpen);
  toggleFriendPanelBtn.textContent = state.friendPanelOpen ? "Hide friends" : "Add friends";
});

document.getElementById("randomMatchBtn").addEventListener("click", () => {
  if (!state.user) {
    setBanner("Sign in with an email before joining a match.", "error");
    return;
  }

  socket.emit("queueForMatch");
});

document.getElementById("botBtn").addEventListener("click", () => {
  if (!state.user) {
    setBanner("Sign in with an email before playing against a bot.", "error");
    return;
  }

  startBotGame();
});

document.getElementById("resignBtn").addEventListener("click", () => {
  if (!state.user) {
    setBanner("Sign in with your email before playing.", "error");
    return;
  }

  if (state.game && state.game.mode === "bot") {
    state.game.inProgress = false;
    state.game.winner = "BOT";
    state.game.reason = "resigned";
    setBanner("You resigned. Bot wins this round.", "success");
    renderBoard();
    return;
  }

  if (state.game && state.game.mode === "online") {
    socket.emit("resignGame", { gameId: state.game.id });
  }
});

document.getElementById("addFriendBtn").addEventListener("click", () => {
  const lookup = document.getElementById("friendUsernameInput").value.trim();
  if (!lookup) {
    setBanner("Add a friend username or email first.", "error");
    return;
  }
  socket.emit("addFriend", { username: lookup });
  document.getElementById("friendUsernameInput").value = "";
});

document.getElementById("inviteFriendBtn").addEventListener("click", () => {
  const lookup = document.getElementById("inviteEmailInput").value.trim();
  if (!lookup) {
    setBanner("Enter a friend username or email to challenge them.", "error");
    return;
  }
  socket.emit("sendFriendInvite", { username: lookup });
  document.getElementById("inviteEmailInput").value = "";
});

changeAvatarBtn.addEventListener("click", () => {
  if (!state.user) {
    setBanner("Sign in before changing your profile image.", "error");
    return;
  }

  const nextAvatar = prompt("Paste a new profile image URL:", state.user.avatar || "");
  if (nextAvatar === null) {
    return;
  }

  const trimmed = nextAvatar.trim();
  if (!trimmed) {
    return;
  }

  socket.emit("updateProfilePicture", { avatar: trimmed });
});

profileModalClose.addEventListener("click", () => {
  profileModal.classList.add("hidden");
});

profileModal.addEventListener("click", (event) => {
  if (event.target === profileModal) {
    profileModal.classList.add("hidden");
  }
});

function submitLogin(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  const email = emailInput.value.trim();
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (!email || !email.includes("@") || !username || !password) {
    setBanner("Use a valid email, username, and password to sign in.", "error");
    return;
  }

  const profile = {
    email,
    username,
    password,
    name: username,
    avatar: avatarInput.value.trim() || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(email)}`,
  };

  saveSession(profile);
  socket.emit("login", profile);
}

authForm.addEventListener("submit", submitLogin);
accessArenaBtn.addEventListener("click", submitLogin);

socket.on("session", ({ user, leaderboard, onlineUsers, friends, pendingInvites }) => {
  state.user = user;
  state.leaderboard = leaderboard;
  state.friends = friends;
  state.invites = pendingInvites;
  state.onlineUsers = onlineUsers;
  if (state.session && state.session.email === user.email) {
    saveSession({
      email: user.email,
      username: user.username || user.name,
      password: state.session.password,
      avatar: user.avatar || state.session.avatar,
    });
  }
  showGameApp();
  updateProfileCard();
  renderLeaderboard();
  renderFriends();
  renderInvites();
  setBanner(`Welcome, ${user.name}! Choose a mode to play.`, "success");
  turnInfo.textContent = "Ready to play.";
});

socket.on("profileData", (profile) => {
  renderProfileModal(profile);
});

socket.on("leaderboard", (leaderboard) => {
  state.leaderboard = leaderboard;
  renderLeaderboard();
});

socket.on("friends", (friends) => {
  state.friends = friends;
  renderFriends();
});

socket.on("pendingInvites", (invites) => {
  state.invites = invites;
  renderInvites();
});

socket.on("onlineUsers", (users) => {
  state.onlineUsers = users;
});

socket.on("successMessage", (message) => {
  setBanner(message, "success");
});

socket.on("errorMessage", (message) => {
  setBanner(message, "error");
});

socket.on("matchmakingStatus", ({ queued, message }) => {
  if (queued) {
    setBanner(message, "info");
  } else {
    setBanner(message, "success");
  }
});

socket.on("matchFound", ({ game }) => {
  state.game = {
    ...game,
    mode: "online",
    inProgress: game.inProgress,
    turnDeadline: game.turnDeadline,
  };
  const myPlayer = state.game.players.find((player) => player.email === state.user.email);
  const opponent = state.game.players.find((player) => player.email !== state.user.email);
  setBanner(`Match found against ${opponent?.name || "random player"}!`, "success");
  turnInfo.textContent = myPlayer && myPlayer.symbol === "X" ? "You move first." : "Opponent to move first.";
  renderBoard();
});

socket.on("gameUpdate", (game) => {
  state.game = {
    ...game,
    mode: "online",
  };
  renderBoard();
});

showLoginScreen();
setBanner("Use your email, username, and password to access the arena.", "info");
renderLeaderboard();
renderFriends();
renderInvites();
updateProfileCard();
renderBoard();

socket.on("connect", () => {
  restoreSession();
});

if (socket.connected) {
  restoreSession();
}
