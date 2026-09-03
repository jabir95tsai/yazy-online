import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { players, roomInvites, rooms } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { findAcceptedFriendship } from "@/lib/friends";
import { apiError, cleanCode } from "@/lib/server";

/** Ask a friend to a table you are sitting at. */
export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const body = (await request.json()) as { code?: unknown; userId?: unknown };
    const code = cleanCode(body.code);
    const targetId = typeof body.userId === "string" ? body.userId : "";
    if (code.length !== 6 || !targetId) {
      return Response.json({ error: "缺少房間或對象。" }, { status: 400 });
    }
    if (!(await findAcceptedFriendship(user.id, targetId))) {
      return Response.json({ error: "只能邀請好友。" }, { status: 403 });
    }

    const db = getDb();
    const [room] = await db.select().from(rooms).where(eq(rooms.code, code)).limit(1);
    if (!room) return Response.json({ error: "找不到這個房間。" }, { status: 404 });
    if (room.status !== "waiting") {
      return Response.json({ error: "這局已經開始了。" }, { status: 409 });
    }

    const seated = await db
      .select({ userId: players.userId })
      .from(players)
      .where(eq(players.roomId, room.id));
    // Only someone at the table may hand out its code this way — otherwise
    // knowing a room code would be enough to spam anyone's landing page.
    if (!seated.some((player) => player.userId === user.id)) {
      return Response.json({ error: "你不在這桌。" }, { status: 403 });
    }
    if (seated.some((player) => player.userId === targetId)) {
      return Response.json({ error: "他已經在這桌了。" }, { status: 409 });
    }

    await db
      .insert(roomInvites)
      .values({
        id: crypto.randomUUID(),
        roomId: room.id,
        fromUserId: user.id,
        toUserId: targetId,
        createdAt: new Date().toISOString(),
      })
      // A second tap on 邀請 means the same thing as the first one.
      .onConflictDoNothing();
    return Response.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}

/** Put an invitation away, from either end. */
export async function DELETE(request: Request) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const body = (await request.json()) as { id?: unknown };
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return Response.json({ error: "缺少邀請。" }, { status: 400 });

    const db = getDb();
    const [invite] = await db
      .select()
      .from(roomInvites)
      .where(eq(roomInvites.id, id))
      .limit(1);
    if (!invite || (invite.toUserId !== user.id && invite.fromUserId !== user.id)) {
      return Response.json({ error: "這個邀請已經不在了。" }, { status: 404 });
    }
    await db.delete(roomInvites).where(eq(roomInvites.id, id));
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
