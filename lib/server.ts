import { asc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { ensureSchema, getDb } from "@/db";
import { players, rooms, scores } from "@/db/schema";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Shape of a Workers Rate Limiting binding, declared locally so the project
 *  does not need the full `@cloudflare/workers-types` global surface. */
type RateLimiter = {
  limit(input: { key: string }): Promise<{ success: boolean }>;
};

const limiterEnv = env as {
  ROOM_CREATE_LIMITER?: RateLimiter;
  AUTH_LIMITER?: RateLimiter;
};

export function clientIp(request: Request) {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/**
 * Consume one unit from a Workers Rate Limiting binding.
 *
 * Fails open when the binding is absent — Miniflare does not always provide
 * these in local dev. Rate limiting protects against abuse rather than
 * enforcing correctness, so a missing binding must not block development.
 */
async function withinLimit(limiter: RateLimiter | undefined, key: string) {
  if (!limiter) return true;
  const { success } = await limiter.limit({ key });
  return success;
}

/** Per-IP budget for room creation (10 per 60s). */
export async function withinRoomCreateLimit(request: Request) {
  return withinLimit(limiterEnv.ROOM_CREATE_LIMITER, clientIp(request));
}

/**
 * Budget for credential endpoints (10 per 60s), checked on two independent
 * keys:
 *
 * - by IP, so one host cannot grind through many accounts;
 * - by target username, so a distributed attempt against a single account is
 *   still throttled even though each source IP looks quiet.
 *
 * `username` is omitted for registration, where there is no account under
 * attack yet.
 */
export async function withinAuthLimit(request: Request, username?: string) {
  const limiter = limiterEnv.AUTH_LIMITER;
  if (!(await withinLimit(limiter, `ip:${clientIp(request)}`))) return false;
  if (username && !(await withinLimit(limiter, `user:${username}`))) return false;
  return true;
}

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

export async function getRoomState(code: string, ifNoneMatch?: string | null) {
  await ensureSchema();
  const db = getDb();
  const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
  if (!room) return { state: null, etag: null, notModified: false };
  const etag = `W/"${room.updatedAt}:${room.currentSeat}:${room.rollsUsed}"`;
  if (ifNoneMatch === etag) {
    return { state: null, etag, notModified: true };
  }
  const [roomPlayers, roomScores] = await Promise.all([
    db
      .select({ id: players.id, name: players.name, seat: players.seat })
      .from(players)
      .where(eq(players.roomId, room.id))
      .orderBy(asc(players.seat)),
    db
      .select({
        playerId: scores.playerId,
        category: scores.category,
        score: scores.score,
      })
      .from(scores)
      .where(eq(scores.roomId, room.id)),
  ]);

  return {
    state: {
      room: {
        id: room.id,
        code: room.code,
        status: room.status,
        maxPlayers: room.maxPlayers,
        hostPlayerId: room.hostPlayerId,
        currentSeat: room.currentSeat,
        round: room.round,
        dice: JSON.parse(room.diceJson) as number[],
        held: JSON.parse(room.heldJson) as boolean[],
        rollsUsed: room.rollsUsed,
        turnDeadline: room.turnDeadline,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        finishedAt: room.finishedAt,
      },
      players: roomPlayers,
      scores: roomScores,
    },
    etag,
    notModified: false,
  };
}

export function apiError(error: unknown) {
  console.error(error);
  return Response.json({ error: "伺服器剛剛打了個噴嚏，請再試一次。" }, { status: 500 });
}
