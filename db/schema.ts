import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    username: text("username").notNull(),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [uniqueIndex("users_username_unique").on(table.username)],
);

export const accountSessions = sqliteTable(
  "account_sessions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("account_sessions_token_unique").on(table.tokenHash),
    index("account_sessions_user_idx").on(table.userId),
  ],
);

export const rooms = sqliteTable(
  "rooms",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    status: text("status", { enum: ["waiting", "playing", "finished"] })
      .notNull()
      .default("waiting"),
    maxPlayers: integer("max_players").notNull().default(6),
    hostPlayerId: text("host_player_id").notNull(),
    currentSeat: integer("current_seat").notNull().default(0),
    round: integer("round").notNull().default(1),
    diceJson: text("dice_json").notNull().default("[]"),
    heldJson: text("held_json")
      .notNull()
      .default("[false,false,false,false,false]"),
    rollsUsed: integer("rolls_used").notNull().default(0),
    turnDeadline: text("turn_deadline"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    finishedAt: text("finished_at"),
  },
  (table) => [uniqueIndex("rooms_code_unique").on(table.code)],
);

export const players = sqliteTable(
  "players",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id").notNull().references(() => rooms.id),
    userId: text("user_id").references(() => users.id),
    name: text("name").notNull(),
    seat: integer("seat").notNull(),
    tokenHash: text("token_hash").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [
    uniqueIndex("players_room_seat_unique").on(table.roomId, table.seat),
    index("players_user_idx").on(table.userId),
  ],
);

export const scores = sqliteTable(
  "scores",
  {
    roomId: text("room_id").notNull().references(() => rooms.id),
    playerId: text("player_id").notNull().references(() => players.id),
    category: text("category").notNull(),
    score: integer("score").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roomId, table.playerId, table.category] }),
  ],
);
