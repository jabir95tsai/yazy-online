import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { historyStats, loadUserHistory } from "@/lib/history";
import { apiError, cleanName } from "@/lib/server";

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const games = await loadUserHistory(user.id);
    return Response.json({ user, stats: historyStats(games), games });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureSchema();
    const user = await getCurrentUser(request);
    if (!user) return Response.json({ error: "尚未登入。" }, { status: 401 });
    const body = (await request.json()) as { displayName?: unknown };
    const displayName = cleanName(body.displayName);
    if (!displayName) return Response.json({ error: "請輸入顯示名稱。" }, { status: 400 });
    await getDb()
      .update(users)
      .set({ displayName, updatedAt: new Date().toISOString() })
      .where(eq(users.id, user.id));
    return Response.json({ user: { ...user, displayName } });
  } catch (error) {
    return apiError(error);
  }
}
