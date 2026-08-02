import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { users } from "@/db/schema";
import {
  accountCookie,
  cleanUsername,
  createAccountSession,
  fakeVerifyPassword,
  linkGuestPlayers,
  verifyPassword,
} from "@/lib/auth";
import { apiError, withinAuthLimit } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      sessions?: unknown;
    };
    const username = cleanUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    if (!(await withinAuthLimit(request, username))) {
      return Response.json(
        { error: "嘗試次數過多，請稍後再試。" },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user) {
      // Spend the same effort as a real check so an unknown username is not
      // distinguishable by response time.
      await fakeVerifyPassword(password);
      return Response.json({ error: "帳號或密碼不正確。" }, { status: 401 });
    }
    if (!(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      return Response.json({ error: "帳號或密碼不正確。" }, { status: 401 });
    }
    await linkGuestPlayers(user.id, body.sessions);
    const token = await createAccountSession(user.id);
    return Response.json(
      { user: { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt } },
      { headers: { "set-cookie": accountCookie(token) } },
    );
  } catch (error) {
    return apiError(error);
  }
}
