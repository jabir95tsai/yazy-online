import type { D1Database } from "@cloudflare/workers-types";

/**
 * How long a room may sit without activity before it is considered abandoned.
 *
 * Only ever applied to rooms that never reached `finished`. Completed games are
 * retained indefinitely because account history is derived from them.
 */
export const ABANDONED_ROOM_DAYS = 7;

/** Cutoff timestamp for abandoned rooms, as an ISO-8601 UTC string. */
export function abandonedRoomCutoff(now: number, days = ABANDONED_ROOM_DAYS) {
  return new Date(now - days * 86_400_000).toISOString();
}

export async function cleanupExpiredSessions(d1: D1Database) {
  const sessions = await d1
    .prepare("DELETE FROM account_sessions WHERE expires_at <= ?")
    .bind(new Date().toISOString())
    .run();

  return {
    expiredSessions: sessions.meta.changes,
  };
}

/**
 * Drop rooms that were never completed and have gone quiet.
 *
 * A room only leaves `waiting`/`playing` when someone finishes it, so a table
 * that everyone walked away from would otherwise persist forever along with
 * its players and scores. Children are removed first to respect the foreign
 * keys, and the whole thing runs as one batch so a partial failure cannot
 * strand orphaned rows.
 */
export async function cleanupAbandonedRooms(d1: D1Database, now = Date.now()) {
  const cutoff = abandonedRoomCutoff(now);
  const doomed = "SELECT id FROM rooms WHERE status != 'finished' AND updated_at <= ?";

  const [scores, players, rooms] = await d1.batch([
    d1.prepare(`DELETE FROM scores WHERE room_id IN (${doomed})`).bind(cutoff),
    d1.prepare(`DELETE FROM players WHERE room_id IN (${doomed})`).bind(cutoff),
    d1
      .prepare("DELETE FROM rooms WHERE status != 'finished' AND updated_at <= ?")
      .bind(cutoff),
  ]);

  return {
    abandonedRooms: rooms.meta.changes,
    abandonedPlayers: players.meta.changes,
    abandonedScores: scores.meta.changes,
  };
}

export async function runScheduledCleanup(d1: D1Database) {
  return {
    ...(await cleanupExpiredSessions(d1)),
    ...(await cleanupAbandonedRooms(d1)),
  };
}
