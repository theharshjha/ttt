import express from "express";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Server } from "socket.io";

import { Game, lobby, liveGames } from "./game.js";
import {
  updateLeaderboard,
  loadLeaderboard,
  ensureEntry,
} from "./leaderboard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: { origin: "*", credentials: true }
});

app.use(express.json());
app.use(express.static(join(__dirname, "public")));

app.get("/", (_req, res) => {
  res.sendFile(join(__dirname, "public", "index.html"));
});

const socketUsers = new Map();
const MAX_NICKNAME_LENGTH = 20;

function sanitizeNickname(nickname, fallback) {
  if (!nickname || typeof nickname !== "string") return fallback;
  return nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || fallback;
}

app.post("/nickname", async (req, res) => {
  const { userId, nickname } = req.body || {};
  if (!userId || !nickname) {
    return res
      .status(400)
      .json({ ok: false, error: "userId and nickname required" });
  }

  const sanitizedNickname = sanitizeNickname(
    nickname,
    `Player-${String(userId).slice(-4)}`
  );

  try {
    await updateLeaderboard((lb) => {
      ensureEntry(lb, userId, sanitizedNickname);
    });
    return res.json({ ok: true });
  } catch (error) {
    console.error("Failed to update nickname:", error);
    return res
      .status(500)
      .json({ ok: false, error: "Failed to update nickname" });
  }
});

app.get("/leaderboard", async (_req, res) => {
  try {
    const lb = await loadLeaderboard();
    res.json(lb);
  } catch (error) {
    console.error("Failed to load leaderboard:", error);
    res.status(500).json({ error: "Failed to load leaderboard" });
  }
});

io.on("connection", (socket) => {
  socket.on("register", ({ userId, nickname }) => {
    const stableId = userId || socket.id;
    const fallbackNickname = `Player-${String(stableId).slice(-4)}`;
    const sanitizedNickname = sanitizeNickname(nickname, fallbackNickname);

    socketUsers.set(socket.id, {
      userId: String(stableId),
      nickname: sanitizedNickname,
    });
  });

  socket.on("join_lobby", () => {
    lobby.add(socket.id);

    if (lobby.size >= 2) {
      const [p1, p2] = [...lobby].slice(0, 2);

      const s1 = io.sockets.sockets.get(p1);
      const s2 = io.sockets.sockets.get(p2);
      if (!s1 || !s2) {
        lobby.delete(p1);
        lobby.delete(p2);
        if (s1) lobby.add(p1);
        if (s2) lobby.add(p2);
        return;
      }

      lobby.delete(p1);
      lobby.delete(p2);

      const u1 = socketUsers.get(p1) || {
        userId: p1,
        nickname: `Player-${p1.slice(-4)}`,
      };
      const u2 = socketUsers.get(p2) || {
        userId: p2,
        nickname: `Player-${p2.slice(-4)}`,
      };

      const roomId = `match:${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 8)}`;
      s1.join(roomId);
      s2.join(roomId);

      const game = new Game({
        roomId,
        playerXSocket: p1,
        playerOSocket: p2,
        playerXUser: u1,
        playerOUser: u2,
        onUpdate: (snapshot) => io.to(roomId).emit("game_update", snapshot),
        onEnd: async (snapshot) => {
          try {
            const { players, result } = snapshot;

            await updateLeaderboard((lb) => {
              ensureEntry(lb, players.X.userId, players.X.nickname);
              ensureEntry(lb, players.O.userId, players.O.nickname);

              if (result === "X WON") {
                lb[players.X.userId].wins += 1;
                lb[players.O.userId].losses += 1;
              } else if (result === "O WON") {
                lb[players.O.userId].wins += 1;
                lb[players.X.userId].losses += 1;
              } else if (result === "DRAW") {
                lb[players.X.userId].ties += 1;
                lb[players.O.userId].ties += 1;
              }
            });
          } catch (e) {
            console.error("Failed to update leaderboard:", e);
          }

          game.cleanup();
          s1.leave(roomId);
          s2.leave(roomId);
        },
      });

      liveGames.set(p1, game);
      liveGames.set(p2, game);
      io.to(roomId).emit("game_start", game.toSnapshot());
    }
  });

  socket.on("make_move", ({ position }) => {
    const game = liveGames.get(socket.id);
    if (!game) return;
    game.makeMove(socket.id, position);
  });

  socket.on("leave_game", () => {
    const game = liveGames.get(socket.id);
    if (!game) return;
    game.resign(socket.id);
  });

  socket.on("disconnect", () => {
    if (lobby.has(socket.id)) {
      lobby.delete(socket.id);
    }

    const game = liveGames.get(socket.id);
    if (game) {
      game.resign(socket.id);
    }

    socketUsers.delete(socket.id);
  });
});

const PORT = 443;
server.listen(PORT, () => {
  console.log(`server running at http://localhost:${PORT}`);
});
