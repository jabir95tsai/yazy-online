import { asc, eq } from "drizzle-orm";
import { ensureSchema, getD1, getDb } from "@/db";
import { players, rooms } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  apiError,
  cleanCode,
  cleanName,
  hashToken,
  makePlayerToken,
  notifyRoom,
} from "@/lib/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  try {
    await ensureSchema();
    const code = cleanCode((await params).code);
    const body = (await request.json()) as { name?: string };
    const account = await getCurrentUser(request);
    const name = cleanName(body.name ?? account?.displayName);
    if (!name) {
      return Response.json({ error: "先取一個玩家名稱吧。" }, { status: 400 });
    }

    const db = getDb();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });

    const roomPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id))
      .orderBy(asc(players.seat));
    if (account && roomPlayers.some((player) => player.userId === account.id)) {
      return Response.json({ error: "你的帳號已經加入這個房間。" }, { status: 409 });
    }
    if (roomPlayers.some((player) => player.name.toLowerCase() === name.toLowerCase())) {
      return Response.json({ error: "房間裡已經有人使用這個名稱。" }, { status: 409 });
    }

    const playerId = crypto.randomUUID();
    const token = makePlayerToken();
    const tokenHash = await hashToken(token);
    const now = new Date().toISOString();
    const d1 = getD1();
    // A table that is already playing (or showing its results) takes newcomers
    // as spectators: the same sitting-out seat as a declined rematch, so the
    // match logic and history already leave them out, and the host's next
    // 再開一局 asks them to join like everyone else.
    const insert = d1
      .prepare(`
        INSERT OR IGNORE INTO players
          (id, room_id, user_id, name, seat, token_hash, joined_at, rematch_ready, surrender_reason)
        SELECT ?, id, ?, ?,
          (SELECT COALESCE(MAX(seat) + 1, 0) FROM players WHERE room_id = rooms.id),
          ?, ?,
          CASE WHEN status = 'waiting' THEN 1 ELSE -1 END,
          CASE WHEN status = 'waiting' THEN NULL ELSE 'manual' END
        FROM rooms
        WHERE id = ?
          AND (? IS NULL OR NOT EXISTS (
            SELECT 1 FROM players WHERE room_id = rooms.id AND user_id = ?
          ))
          AND NOT EXISTS (
            SELECT 1 FROM players WHERE room_id = rooms.id AND lower(name) = lower(?)
          )
      `)
      .bind(
        playerId,
        account?.id ?? null,
        name,
        tokenHash,
        now,
        room.id,
        account?.id ?? null,
        account?.id ?? null,
        name,
      );
    // Bumping updated_at mid-game would make the roller's next action fail its
    // compare-and-swap, so a spectator shows up on the next move instead.
    const touchRoom = d1
      .prepare(`
        UPDATE rooms SET updated_at = CASE WHEN updated_at >= ?
          THEN strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0.001 seconds')
          ELSE ? END
        WHERE id = ? AND status != 'playing'
          AND EXISTS (SELECT 1 FROM players WHERE id = ? AND room_id = rooms.id)
      `)
      .bind(now, now, room.id, playerId);
    const [insertResult] = await d1.batch([insert, touchRoom]);
    if (insertResult.meta.changes !== 1) {
      return Response.json(
        { error: "房間狀態已變更，或玩家名稱重複。" },
        { status: 409 },
      );
    }

    if (account) {
      // The invitation has served its purpose; leaving it would keep offering
      // this table on the landing page of someone already sitting at it.
      await d1
        .prepare("DELETE FROM room_invites WHERE room_id = ? AND to_user_id = ?")
        .bind(room.id, account.id)
        .run();
    }

    notifyRoom(code);
    return Response.json(
      { code, playerId, token, spectator: room.status !== "waiting" },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
