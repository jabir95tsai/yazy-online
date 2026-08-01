import { eq } from "drizzle-orm";
import { ensureSchema, getDb } from "@/db";
import { users } from "@/db/schema";
import {
  accountCookie,
  createAccountSession,
  hashPassword,
  makePasswordSalt,
  validateAccountInput,
} from "@/lib/auth";
import { apiError } from "@/lib/server";

export async function POST(request: Request) {
  try {
    await ensureSchema();
    const validated = validateAccountInput(await request.json());
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
    const token = await createAccountSession(id);
    return Response.json(
      { user: { id, username: validated.username, displayName: validated.displayName, createdAt: now } },
      { status: 201, headers: { "set-cookie": accountCookie(token) } },
    );
  } catch (error) {
    return apiError(error);
  }
}
