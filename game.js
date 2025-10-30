export const RESULTS = {
  X_WINS: "X WON",
  O_WINS: "O WON",
  DRAW: "DRAW",
};

export const REASONS = {
  TIMEOUT: "TIMEOUT",
  PLAYER_LEFT: "PLAYER LEFT",
  WIN: "WIN",
  DRAW: "BOARD FULL",
};

const TURN_MS = 21_000;
const TIMER_BUFFER_MS = 10;

const WINS = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export const lobby = new Set();
export const liveGames = new Map();

export class Game {
  constructor({
    roomId,
    playerXSocket,
    playerOSocket,
    playerXUser, // { userId, nickname }
    playerOUser, // { userId, nickname }
    onUpdate, // (snapshot) => void
    onEnd, // (snapshot) => void
  }) {
    this.roomId = roomId;
    this.playerXSocket = playerXSocket;
    this.playerOSocket = playerOSocket;
    this.playerXUser = playerXUser;
    this.playerOUser = playerOUser;
    this.board = Array(9).fill(null);
    this.currentTurn = "X";
    this.isGameOver = false;
    this.result = null;
    this.reason = null;
    this.winner = null;
    this.move = 0;
    this.deadline = 0;
    this.error = "";
    this._timer = null;
    this.onUpdate = onUpdate;
    this.onEnd = onEnd;
    this._startTimer(this.move);
  }

  toSnapshot() {
    return {
      roomId: this.roomId,
      board: this.board,
      currentTurn: this.currentTurn,
      isGameOver: this.isGameOver,
      result: this.result,
      reason: this.reason,
      winner: this.winner,
      move: this.move,
      deadline: this.deadline,
      error: this.error,
      players: {
        X: {
          userId: this.playerXUser?.userId,
          nickname: this.playerXUser?.nickname,
        },
        O: {
          userId: this.playerOUser?.userId,
          nickname: this.playerOUser?.nickname,
        },
      },
    };
  }

  _emitUpdate() {
    if (typeof this.onUpdate === "function") {
      this.onUpdate(this.toSnapshot());
    }
  }

  _clearTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _startTimer(expectedMove) {
    this._clearTimer();
    this.deadline = Date.now() + TURN_MS;

    this._timer = setTimeout(() => {
      // Double-check game state hasn't changed
      if (this.isGameOver) return;
      if (this.move !== expectedMove) return;

      // Current player loses due to timeout
      const result = this.currentTurn === "X" ? RESULTS.O_WINS : RESULTS.X_WINS;
      this._endGame({ result, reason: REASONS.TIMEOUT });
    }, TURN_MS + TIMER_BUFFER_MS);

    this._emitUpdate();
  }

  _endGame({ result, reason }) {
    if (this.isGameOver) return;
    this.isGameOver = true;
    this.result = result;
    this.reason =
      reason || (result === RESULTS.DRAW ? REASONS.DRAW : REASONS.WIN);
    this.winner =
      result === RESULTS.X_WINS ? "X" : result === RESULTS.O_WINS ? "O" : null;

    this._clearTimer();
    this._emitUpdate();

    if (typeof this.onEnd === "function") {
      this.onEnd(this.toSnapshot());
    }
  }

  _checkWinOrDraw() {
    for (const [a, b, c] of WINS) {
      const v = this.board[a];
      if (v && v === this.board[b] && v === this.board[c]) {
        this._endGame({
          result: v === "X" ? RESULTS.X_WINS : RESULTS.O_WINS,
          reason: REASONS.WIN,
        });
        return true;
      }
    }

    if (!this.board.includes(null)) {
      this._endGame({ result: RESULTS.DRAW, reason: REASONS.DRAW });
      return true;
    }

    return false;
  }

  makeMove(callerSocket, position) {
    if (this.isGameOver) return;
    if (typeof position !== "number") {
      position = Number(position);
    }

    if (!Number.isInteger(position) || position < 0 || position > 8) {
      this.error = "Invalid move: position must be 0-8";
      this._emitUpdate();
      return;
    }

    const callerIsX = callerSocket === this.playerXSocket;
    const callerIsO = callerSocket === this.playerOSocket;
    if (!callerIsX && !callerIsO) {
      this.error = "Invalid player";
      this._emitUpdate();
      return;
    }

    const symbol = callerIsX ? "X" : "O";

    if (symbol !== this.currentTurn) {
      this.error = `Not your turn (current: ${this.currentTurn})`;
      this._emitUpdate();
      return;
    }

    if (this.board[position] !== null) {
      this.error = "Position already occupied";
      this._emitUpdate();
      return;
    }

    this.board[position] = symbol;
    this.move += 1;
    this.error = "";

    if (!this._checkWinOrDraw()) {
      this.currentTurn = this.currentTurn === "X" ? "O" : "X";
      this._startTimer(this.move);
    }
  }

  resign(callerSocket) {
    if (this.isGameOver) return;

    const callerIsX = callerSocket === this.playerXSocket;
    const callerIsO = callerSocket === this.playerOSocket;

    if (!callerIsX && !callerIsO) return;

    if (callerIsX) {
      this._endGame({ result: RESULTS.O_WINS, reason: REASONS.PLAYER_LEFT });
    } else {
      this._endGame({ result: RESULTS.X_WINS, reason: REASONS.PLAYER_LEFT });
    }
  }

  cleanup() {
    this._clearTimer();
    liveGames.delete(this.playerXSocket);
    liveGames.delete(this.playerOSocket);
  }
}
