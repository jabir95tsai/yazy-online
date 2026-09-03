import { and, eq, or } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { friendships, roomInvites } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { apiError } from "@/lib/server";

/** Accept a request that is waiting on this account. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const { id } = await params;

    const db = getDb();
    const [link] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, id))
      .limit(1);
    // Only the person who was asked can say yes, so the requester cannot
    // accept on their behalf.
    if (!link || link.addresseeId !== user.id || link.status !== "pending") {
      return Response.json({ error: "這個好友邀請已經不在了。" }, { status: 404 });
    }
    await db
      .update(friendships)
      .set({ status: "accepted", respondedAt: new Date().toISOString() })
      .where(and(eq(friendships.id, id), eq(friendships.status, "pending")));
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

/**
 * Drop a friendship row: declining, taking back a request you sent, and
 * removing an existing friend are the same delete from either side.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const { id } = await params;

    const db = getDb();
    const [link] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.id, id))
      .limit(1);
    if (!link || (link.requesterId !== user.id && link.addresseeId !== user.id)) {
      return Response.json({ error: "這個好友邀請已經不在了。" }, { status: 404 });
    }
    const other = link.requesterId === user.id ? link.addresseeId : link.requesterId;
    await db.batch([
      db.delete(friendships).where(eq(friendships.id, id)),
      // Invitations only exist because of the friendship, so they leave with
      // it rather than sitting on the other person's landing page.
      db
        .delete(roomInvites)
        .where(
          or(
            and(eq(roomInvites.fromUserId, user.id), eq(roomInvites.toUserId, other)),
            and(eq(roomInvites.fromUserId, other), eq(roomInvites.toUserId, user.id)),
          ),
        ),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
