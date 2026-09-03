import { and, eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { friendships, users } from "@/db/schema";
import { cleanUsername, getCurrentUser } from "@/lib/auth";
import { loadFriendsPayload, MAX_PENDING_REQUESTS, pairKey } from "@/lib/friends";
import { apiError } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    return Response.json(await loadFriendsPayload(user.id));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const body = (await request.json()) as { username?: unknown };
    const username = cleanUsername(body.username);
    if (!username) return Response.json({ error: "請輸入對方的帳號。" }, { status: 400 });
    if (username === user.username) {
      return Response.json({ error: "這是你自己的帳號。" }, { status: 400 });
    }

    const db = getDb();
    const [target] = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);
    if (!target) return Response.json({ error: "找不到這個帳號。" }, { status: 404 });

    const key = pairKey(user.id, target.id);
    const [existing] = await db
      .select()
      .from(friendships)
      .where(eq(friendships.pairKey, key))
      .limit(1);
    const now = new Date().toISOString();

    if (existing?.status === "accepted") {
      return Response.json({ error: "你們已經是好友了。" }, { status: 409 });
    }
    if (existing) {
      if (existing.requesterId === user.id) {
        return Response.json({ error: "已經送出邀請，等對方回覆。" }, { status: 409 });
      }
      // They asked first. Asking back is the same thing as saying yes, so this
      // accepts their request instead of stacking a second one on top.
      await db
        .update(friendships)
        .set({ status: "accepted", respondedAt: now })
        .where(and(eq(friendships.id, existing.id), eq(friendships.status, "pending")));
      return Response.json({ status: "accepted", displayName: target.displayName });
    }

    const pending = await db
      .select({ id: friendships.id })
      .from(friendships)
      .where(
        and(eq(friendships.requesterId, user.id), eq(friendships.status, "pending")),
      )
      .limit(MAX_PENDING_REQUESTS);
    if (pending.length >= MAX_PENDING_REQUESTS) {
      return Response.json(
        { error: "還沒被回覆的邀請太多了，先等等吧。" },
        { status: 409 },
      );
    }

    await db
      .insert(friendships)
      .values({
        id: crypto.randomUUID(),
        pairKey: key,
        requesterId: user.id,
        addresseeId: target.id,
        status: "pending",
        createdAt: now,
      })
      // Two taps that race each other both mean "ask this person", and the
      // pair index already holds the one row that says so.
      .onConflictDoNothing();
    return Response.json(
      { status: "pending", displayName: target.displayName },
      { status: 201 },
    );
  } catch (error) {
    return apiError(error);
  }
}
