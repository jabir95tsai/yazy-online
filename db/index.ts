import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

const runtimeEnv = env as { DB?: D1Database; APP_ENV?: string };

export function getD1() {
  if (!runtimeEnv.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Configure the DB binding in wrangler.jsonc before using the database."
    );
  }
  return runtimeEnv.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

let schemaReady: Promise<void> | null = null;

export function ensureSchema() {
  if (runtimeEnv.APP_ENV === "production") {
    return Promise.resolve();
  }
  if (!schemaReady) {
    const d1 = getD1();
    schemaReady = d1
      .batch([
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY NOT NULL,
            username TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            password_salt TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
          )
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS account_sessions (
            id TEXT PRIMARY KEY NOT NULL,
            user_id TEXT NOT NULL REFERENCES users(id),
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
          )
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS rooms (
            id TEXT PRIMARY KEY NOT NULL,
            code TEXT NOT NULL UNIQUE,
            status TEXT NOT NULL DEFAULT 'waiting',
            max_players INTEGER NOT NULL DEFAULT 6,
            host_player_id TEXT NOT NULL,
            current_seat INTEGER NOT NULL DEFAULT 0,
            round INTEGER NOT NULL DEFAULT 1,
            dice_json TEXT NOT NULL DEFAULT '[]',
            held_json TEXT NOT NULL DEFAULT '[false,false,false,false,false]',
            rolls_used INTEGER NOT NULL DEFAULT 0,
            turn_deadline TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            finished_at TEXT
          )
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS players (
            id TEXT PRIMARY KEY NOT NULL,
            room_id TEXT NOT NULL REFERENCES rooms(id),
            user_id TEXT REFERENCES users(id),
            name TEXT NOT NULL,
            seat INTEGER NOT NULL,
            token_hash TEXT NOT NULL,
            joined_at TEXT NOT NULL
          )
        `),
        d1.prepare(`
          CREATE TABLE IF NOT EXISTS scores (
            room_id TEXT NOT NULL REFERENCES rooms(id),
            player_id TEXT NOT NULL REFERENCES players(id),
            category TEXT NOT NULL,
            score INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            PRIMARY KEY (room_id, player_id, category)
          )
        `),
        d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS rooms_code_unique ON rooms(code)"),
        d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS players_room_seat_unique ON players(room_id, seat)"),
        d1.prepare("CREATE INDEX IF NOT EXISTS players_room_idx ON players(room_id)"),
        d1.prepare("CREATE INDEX IF NOT EXISTS players_user_idx ON players(user_id)"),
        d1.prepare("CREATE INDEX IF NOT EXISTS account_sessions_user_idx ON account_sessions(user_id)"),
        d1.prepare("CREATE INDEX IF NOT EXISTS scores_room_idx ON scores(room_id)"),
      ])
      .then(() => undefined)
      .catch((error) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
}
