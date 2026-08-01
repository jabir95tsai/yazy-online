import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { users } from "@/db/schema";
import {
  accountCookie,
  cleanUsername,
  createAccountSession,
  verifyPassword,
} from "@/lib/auth";
import { apiError } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const body = (await request.json()) as { username?: unknown; password?: unknown };
    const username = cleanUsername(body.username);
    const password = typeof body.password === "string" ? body.password : "";
    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
    if (!user || !(await verifyPassword(password, user.passwordSalt, user.passwordHash))) {
      return Response.json({ error: "帳號或密碼不正確。" }, { status: 401 });
    }
    const token = await createAccountSession(user.id);
    return Response.json(
      { user: { id: user.id, username: user.username, displayName: user.displayName, createdAt: user.createdAt } },
      { headers: { "set-cookie": accountCookie(token) } },
    );
  } catch (error) {
    return apiError(error);
  }
}
