import { and, asc, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function cleanName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 18) : "";
}

export function cleanCode(value: unknown) {
  return typeof value === "string"
    ? value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6)
    : "";
}

export function makeRoomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => CODE_CHARS[byte % CODE_CHARS.length]).join("");
}

export function makePlayerToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function authenticate(roomId: string, playerId: string, token: string) {
  await ensureSchema();
  const db = getDb();
  const [player] = await db
    .select()
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.roomId, roomId)))
    .limit(1);
  if (!player || player.tokenHash !== (await hashToken(token))) return null;
  return player;
}

export async function getRoomState(code: string) {
  await ensureSchema();
  const db = getDb();
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  if (!room) return null;
  const roomPlayers = await db
    .select({ id: players.id, name: players.name, seat: players.seat })
    .from(players)
    .where(eq(players.roomId, room.id))
    .orderBy(asc(players.seat));
  const roomScores = await db
    .select({
      playerId: scores.playerId,
      category: scores.category,
      score: scores.score,
    })
    .from(scores)
    .where(eq(scores.roomId, room.id));

  return {
    room: {
      id: room.id,
      code: room.code,
      status: room.status,
      maxPlayers: room.maxPlayers,
      hostPlayerId: room.hostPlayerId,
      currentSeat: room.currentSeat,
      round: room.round,
      dice: JSON.parse(room.diceJson) as number[],
      rollsUsed: room.rollsUsed,
      createdAt: room.createdAt,
      finishedAt: room.finishedAt,
    },
    players: roomPlayers,
    scores: roomScores,
  };
}

export function apiError(error: unknown) {
  console.error(error);
  return Response.json({ error: "伺服器剛剛打了個噴嚏，請再試一次。" }, { status: 500 });
}
