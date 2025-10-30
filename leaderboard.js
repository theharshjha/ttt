import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, "leaderboard.json");

let lockPromise = Promise.resolve();

export async function loadLeaderboard() {
  try {
    const raw = await readFile(FILE, "utf-8");
    const data = raw ? JSON.parse(raw) : {};

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      console.warn("Invalid leaderboard structure, resetting");
      return {};
    }

    for (const [userId, entry] of Object.entries(data)) {
      if (
        !entry ||
        typeof entry.nickname !== "string" ||
        typeof entry.wins !== "number" ||
        typeof entry.losses !== "number" ||
        typeof entry.ties !== "number"
      ) {
        console.warn(`Invalid entry for user ${userId}, skipping`);
        delete data[userId];
      }
    }

    return data;
  } catch (error) {
    if (error.code === "ENOENT") {
      return {};
    }
    console.error("Error loading leaderboard:", error);
    return {};
  }
}

export async function saveLeaderboard(leaderboard) {
  const json = JSON.stringify(leaderboard, null, 2);
  await writeFile(FILE, json, "utf-8");
}

export async function updateLeaderboard(updateFn) {
  lockPromise = lockPromise
    .then(async () => {
      const lb = await loadLeaderboard();
      updateFn(lb);
      await saveLeaderboard(lb);
    })
    .catch((err) => {
      console.error("Leaderboard update failed:", err);
      throw err;
    });

  return lockPromise;
}

export function ensureEntry(leaderboard, userId, nickname) {
  if (!userId) {
    console.warn("ensureEntry called with invalid userId");
    return;
  }

  if (!leaderboard[userId]) {
    leaderboard[userId] = {
      nickname: nickname || String(userId),
      wins: 0,
      losses: 0,
      ties: 0,
    };
  } else if (nickname && leaderboard[userId].nickname !== nickname) {
    leaderboard[userId].nickname = nickname;
  }
}

export async function verifyLeaderboardAccess() {
  try {
    const lb = await loadLeaderboard();
    await saveLeaderboard(lb);

    console.log("Leaderboard file verified and accessible");
    return true;
  } catch (error) {
    console.error("Failed to verify leaderboard access:", error);
    return false;
  }
}
