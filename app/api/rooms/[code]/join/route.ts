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
    const name = account?.displayName ?? cleanName(body.name);
    if (!name) {
      return Response.json({ error: "先取一個玩家名稱吧。" }, { status: 400 });
    }

    const db = getDb();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    if (room.status !== "waiting") {
      return Response.json({ error: "這局已經開始，現在不能加入。" }, { status: 409 });
    }

    const roomPlayers = await db
      .select()
      .from(players)
      .where(eq(players.roomId, room.id))
      .orderBy(asc(players.seat));
    if (roomPlayers.length >= room.maxPlayers) {
      return Response.json({ error: "房間已經滿員。" }, { status: 409 });
    }
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
    const insert = d1
      .prepare(`
        INSERT OR IGNORE INTO players
          (id, room_id, user_id, name, seat, token_hash, joined_at)
        SELECT ?, id, ?, ?,
          (SELECT COALESCE(MAX(seat) + 1, 0) FROM players WHERE room_id = rooms.id),
          ?, ?
        FROM rooms
        WHERE id = ? AND status = 'waiting'
          AND (SELECT COUNT(*) FROM players WHERE room_id = rooms.id) < max_players
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
    const touchRoom = d1
      .prepare(`
        UPDATE rooms SET updated_at = ?
        WHERE id = ? AND status = 'waiting'
          AND EXISTS (SELECT 1 FROM players WHERE id = ? AND room_id = rooms.id)
      `)
      .bind(now, room.id, playerId);
    const [insertResult, updateResult] = await d1.batch([insert, touchRoom]);
    if (insertResult.meta.changes !== 1 || updateResult.meta.changes !== 1) {
      if (insertResult.meta.changes === 1) {
        await d1.prepare("DELETE FROM players WHERE id = ?").bind(playerId).run();
      }
      return Response.json(
        { error: "房間狀態已變更、已滿員，或玩家名稱重複。" },
        { status: 409 },
      );
    }

    return Response.json({ code, playerId, token }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
