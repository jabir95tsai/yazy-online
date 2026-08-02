import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { users } from "@/db/schema";
import {
  accountCookie,
  createAccountSession,
  hashPassword,
  linkGuestPlayers,
  makePasswordSalt,
  validateAccountInput,
} from "@/lib/auth";
import { apiError, withinAuthLimit } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    if (!(await withinAuthLimit(request))) {
      return Response.json(
        { error: "嘗試次數過多，請稍後再試。" },
        { status: 429, headers: { "retry-after": "60" } },
      );
    }
    const body = (await request.json()) as {
      username?: unknown;
      password?: unknown;
      displayName?: unknown;
      sessions?: unknown;
    };
    const validated = validateAccountInput(body);
    if ("error" in validated) {
      return Response.json({ error: validated.error }, { status: 400 });
    }
    const db = getDb();
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, validated.username))
      .limit(1);
    if (existing) return Response.json({ error: "這個帳號已經有人使用。" }, { status: 409 });

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const salt = makePasswordSalt();
    await db.insert(users).values({
      id,
      username: validated.username,
      displayName: validated.displayName,
      passwordHash: await hashPassword(validated.password, salt),
      passwordSalt: salt,
      createdAt: now,
      updatedAt: now,
    });
    await linkGuestPlayers(id, body.sessions);
    const token = await createAccountSession(id);
    return Response.json(
      { user: { id, username: validated.username, displayName: validated.displayName, createdAt: now } },
      { status: 201, headers: { "set-cookie": accountCookie(token) } },
    );
  } catch (error) {
    return apiError(error);
  }
}
