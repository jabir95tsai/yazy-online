import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { accountSessions, users } from "@/db/schema";
import { ensureSchema, getDb } from "@/db";
import { cleanName, hashToken } from "@/lib/server";

const COOKIE_NAME = "yazy_account";
const SESSION_DAYS = 30;
const PBKDF2_ITERATIONS = 100_000;
const runtimeEnv = env as { AUTH_PEPPER?: string };

export type AccountUser = {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
};

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return new Uint8Array();
  return new Uint8Array(hex.match(/.{2}/g)?.map((value) => Number.parseInt(value, 16)) ?? []);
}

function randomHex(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function cleanUsername(value: unknown) {
  return typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20)
    : "";
}

export function validateAccountInput(input: {
  username?: unknown;
  password?: unknown;
  displayName?: unknown;
}) {
  const username = cleanUsername(input.username);
  const password = typeof input.password === "string" ? input.password : "";
  const displayName = cleanName(input.displayName);
  if (username.length < 3) return { error: "帳號至少需要 3 個英文字母、數字或底線。" };
  if (password.length < 8 || password.length > 72) return { error: "密碼需為 8–72 個字元。" };
  if (!displayName) return { error: "請輸入顯示名稱。" };
  return { username, password, displayName };
}

export async function hashPassword(password: string, saltHex: string) {
  const passwordBytes = new TextEncoder().encode(password);
  let passwordMaterial: BufferSource = passwordBytes;
  if (runtimeEnv.AUTH_PEPPER) {
    const pepperKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(runtimeEnv.AUTH_PEPPER),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    passwordMaterial = await crypto.subtle.sign("HMAC", pepperKey, passwordBytes);
  }
  const material = await crypto.subtle.importKey(
    "raw",
    passwordMaterial,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const result = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: hexToBytes(saltHex),
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    256,
  );
  return bytesToHex(new Uint8Array(result));
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = await hashPassword(password, salt);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) {
    difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

function readCookie(request: Request) {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === COOKIE_NAME) return decodeURIComponent(parts.join("="));
  }
  return "";
}

export async function getCurrentUser(request: Request): Promise<AccountUser | null> {
  await ensureSchema();
  const token = readCookie(request);
  if (!token) return null;
  const tokenHash = await hashToken(token);
  const db = getDb();
  const [session] = await db
    .select()
    .from(accountSessions)
    .where(eq(accountSessions.tokenHash, tokenHash))
    .limit(1);
  if (!session) return null;
  if (session.expiresAt <= new Date().toISOString()) {
    await db.delete(accountSessions).where(eq(accountSessions.id, session.id));
    return null;
  }
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return user
    ? {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt,
      }
    : null;
}

export async function createAccountSession(userId: string) {
  const db = getDb();
  const token = randomHex(32);
  const now = new Date();
  await db.insert(accountSessions).values({
    id: crypto.randomUUID(),
    userId,
    tokenHash: await hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
  });
  return token;
}

export async function revokeAccountSession(request: Request) {
  const token = readCookie(request);
  if (!token) return;
  await ensureSchema();
  await getDb()
    .delete(accountSessions)
    .where(eq(accountSessions.tokenHash, await hashToken(token)));
}

export function accountCookie(token: string) {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_DAYS * 86_400}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearAccountCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function makePasswordSalt() {
  return randomHex(16);
}
