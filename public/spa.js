import { io } from "https://cdn.socket.io/4.6.1/socket.io.esm.min.js";

const state = {
  userId: null,
  nickname: null,
  socket: null,
  currentGame: null,
  inLobby: false,
  timerInterval: null,
};

const elements = {
  loginView: document.getElementById("login-view"),
  gameView: document.getElementById("game-view"),

  loginForm: document.getElementById("login-form"),
  nicknameInput: document.getElementById("nickname"),
  loginButton: document.getElementById("login-button"),

  welcomeUser: document.getElementById("welcome-user"),
  logoutButton: document.getElementById("logout-button"),
  gameStatus: document.getElementById("game-status"),
  turnTimer: document.getElementById("turn-timer"),
  gameBoard: document.getElementById("game-board"),
  startMatchButton: document.getElementById("start-match-button"),
  leaveMatchButton: document.getElementById("leave-match-button"),
  leaderboardList: document.getElementById("leaderboard-list"),
  errorPopup: document.getElementById("errorPopup"),
};

function getUserId() {
  let userId = localStorage.getItem("tictactoe_userId");
  if (!userId) {
    userId = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("tictactoe_userId", userId);
  }
  return userId;
}

function showError(message) {
  elements.errorPopup.textContent = message;
  elements.errorPopup.classList.add("show");
  setTimeout(() => {
    elements.errorPopup.classList.remove("show");
  }, 3000);
}

function formatTimeRemaining(ms) {
  const seconds = Math.ceil(ms / 1000);
  return seconds > 0 ? `${seconds}s` : "0s";
}

function clearTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  elements.turnTimer.textContent = "";
}

function startTimer(deadline) {
  clearTimer();

  const updateTimer = () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      elements.turnTimer.textContent = "Time's up!";
      clearTimer();
    } else {
      elements.turnTimer.textContent = `Time: ${formatTimeRemaining(
        remaining
      )}`;
    }
  };

  updateTimer();
  state.timerInterval = setInterval(updateTimer, 100);
}

function showView(viewName) {
  elements.loginView.classList.toggle("hidden", viewName !== "login");
  elements.gameView.classList.toggle("hidden", viewName !== "game");
}

function renderBoard(board) {
  elements.gameBoard.innerHTML = "";

  for (let i = 0; i < 9; i++) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.position = i;

    const value = board[i];
    if (value) {
      cell.textContent = value;
      cell.classList.add("occupied", value.toLowerCase());
    } else {
      cell.classList.add("empty");
    }

    elements.gameBoard.appendChild(cell);
  }
}

function updateGameStatus(snapshot) {
  const { isGameOver, result, reason, currentTurn, players, error } = snapshot;

  if (error) {
    showError(error);
  }

  if (isGameOver) {
    clearTimer();
    let statusText = "";

    if (result === "X WON") {
      statusText = `🎉 ${players.X.nickname} (X) wins! - ${reason}`;
    } else if (result === "O WON") {
      statusText = `🎉 ${players.O.nickname} (O) wins! - ${reason}`;
    } else if (result === "DRAW") {
      statusText = `🤝 Draw! - ${reason}`;
    }

    elements.gameStatus.textContent = statusText;
    elements.startMatchButton.disabled = false;
    elements.leaveMatchButton.disabled = true;
  } else {
    const currentPlayer =
      currentTurn === "X" ? players.X.nickname : players.O.nickname;
    elements.gameStatus.textContent = `${currentPlayer}'s turn (${currentTurn})`;

    const isOurTurn =
      (currentTurn === "X" && players.X.userId === state.userId) ||
      (currentTurn === "O" && players.O.userId === state.userId);

    if (isOurTurn) {
      elements.gameStatus.textContent += " - YOUR TURN";
    }
  }
}

async function renderLeaderboard() {
  try {
    const response = await fetch("/leaderboard");
    const data = await response.json();

    const entries = Object.entries(data).map(([userId, stats]) => ({
      userId,
      ...stats,
      winRate:
        stats.wins + stats.losses > 0
          ? ((stats.wins / (stats.wins + stats.losses)) * 100).toFixed(1)
          : 0,
    }));

    entries.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return a.losses - b.losses;
    });

    elements.leaderboardList.innerHTML = entries
      .map((entry, index) => {
        const isCurrentUser = entry.userId === state.userId;
        const className = isCurrentUser ? "current-user" : "";
        return `
          <li class="${className}">
            <span class="rank">#${index + 1}</span>
            <span class="nickname">${entry.nickname}</span>
            <span></span>
            <span class="stats">
              ${entry.wins}W / ${entry.losses}L / ${entry.ties}T
              (${entry.winRate}%)
            </span>
          </li>
        `;
      })
      .join("");
  } catch (error) {
    console.error("Failed to load leaderboard:", error);
    elements.leaderboardList.innerHTML =
      '<li class="error">Failed to load leaderboard</li>';
  }
}

function handleCellClick(event) {
  const cell = event.target.closest(".cell");
  if (!cell) return;

  if (!state.currentGame || state.currentGame.isGameOver) {
    return;
  }

  if (cell.classList.contains("occupied")) {
    return;
  }

  const position = parseInt(cell.dataset.position);

  const { currentTurn, players } = state.currentGame;
  const isOurTurn =
    (currentTurn === "X" && players.X.userId === state.userId) ||
    (currentTurn === "O" && players.O.userId === state.userId);

  if (!isOurTurn) {
    showError("Not your turn!");
    return;
  }

  state.socket.emit("make_move", { position });
}

function initSocket() {
  state.socket = io({
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionAttempts: 5,
  });

  state.socket.on("connect", () => {
    console.log("Connected to server");
    state.socket.emit("register", {
      userId: state.userId,
      nickname: state.nickname,
    });
  });

  state.socket.on("disconnect", () => {
    console.log("Disconnected from server");
    showError("Disconnected from server");
  });

  state.socket.on("connect_error", (error) => {
    console.error("Connection error:", error);
    showError("Connection error. Retrying...");
  });

  state.socket.on("game_start", (snapshot) => {
    console.log("Game started:", snapshot);
    state.currentGame = snapshot;
    state.inLobby = false;

    elements.startMatchButton.disabled = true;
    elements.leaveMatchButton.disabled = false;

    renderBoard(snapshot.board);
    updateGameStatus(snapshot);
    startTimer(snapshot.deadline);
  });

  state.socket.on("game_update", (snapshot) => {
    console.log("Game update:", snapshot);
    state.currentGame = snapshot;

    renderBoard(snapshot.board);
    updateGameStatus(snapshot);

    if (!snapshot.isGameOver) {
      startTimer(snapshot.deadline);
    } else {
      clearTimer();
      state.currentGame = null;
      setTimeout(renderLeaderboard, 500);
    }
  });
}

elements.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nickname = elements.nicknameInput.value.trim();

  if (!nickname || nickname.length < 3) {
    showError("Nickname must be at least 3 characters");
    return;
  }

  elements.loginButton.disabled = true;
  elements.loginButton.textContent = "Logging in...";

  try {
    state.userId = getUserId();
    state.nickname = nickname;

    const response = await fetch("/nickname", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: state.userId, nickname }),
    });

    const result = await response.json();

    if (!result.ok) {
      throw new Error(result.error || "Failed to save nickname");
    }

    initSocket();

    showView("game");
    elements.welcomeUser.textContent = `Welcome, ${nickname}!`;

    renderLeaderboard();

    renderBoard(Array(9).fill(null));
  } catch (error) {
    console.error("Login failed:", error);
    showError("Login failed. Please try again.");
    elements.loginButton.disabled = false;
    elements.loginButton.textContent = "Enter";
  }
});

elements.logoutButton.addEventListener("click", () => {
  if (state.socket) {
    if (state.currentGame && !state.currentGame.isGameOver) {
      state.socket.emit("leave_game");
    }
    state.socket.disconnect();
    state.socket = null;
  }

  state.currentGame = null;
  state.inLobby = false;
  clearTimer();

  showView("login");
  elements.nicknameInput.value = "";
  elements.loginButton.disabled = false;
  elements.loginButton.textContent = "Enter";
});

elements.startMatchButton.addEventListener("click", () => {
  if (!state.socket || !state.socket.connected) {
    showError("Not connected to server");
    return;
  }

  if (state.currentGame && !state.currentGame.isGameOver) {
    showError("Already in a game");
    return;
  }

  if (state.inLobby) {
    showError("Already waiting for opponent");
    return;
  }

  state.inLobby = true;
  elements.startMatchButton.disabled = true;
  elements.gameStatus.textContent = "Searching for opponent...";

  state.socket.emit("join_lobby");

  setTimeout(() => {
    if (state.inLobby && !state.currentGame) {
      state.inLobby = false;
      elements.startMatchButton.disabled = false;
      elements.gameStatus.textContent = "No opponent found. Try again.";
    }
  }, 30000);
});

elements.leaveMatchButton.addEventListener("click", () => {
  if (!state.currentGame || state.currentGame.isGameOver) {
    return;
  }

  if (confirm("Are you sure you want to leave? You will lose the match.")) {
    state.socket.emit("leave_game");
    state.currentGame = null;
    clearTimer();
    elements.startMatchButton.disabled = false;
    elements.leaveMatchButton.disabled = true;
    elements.gameStatus.textContent = "You left the match.";
    renderBoard(Array(9).fill(null));
  }
});

elements.gameBoard.addEventListener("click", handleCellClick);

window.addEventListener("DOMContentLoaded", () => {
  const savedUserId = localStorage.getItem("tictactoe_userId");
  const savedNickname = localStorage.getItem("tictactoe_nickname");

  if (savedUserId && savedNickname) {
    elements.nicknameInput.value = savedNickname;
  }

  elements.loginForm.addEventListener("submit", () => {
    setTimeout(() => {
      if (state.nickname) {
        localStorage.setItem("tictactoe_nickname", state.nickname);
      }
    }, 100);
  });
});

window.addEventListener("beforeunload", () => {
  if (state.socket) {
    state.socket.disconnect();
  }
});
