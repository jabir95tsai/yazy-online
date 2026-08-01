import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
    rollsUsed: integer("rolls_used").notNull().default(0),
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
    name: text("name").notNull(),
    seat: integer("seat").notNull(),
    tokenHash: text("token_hash").notNull(),
    joinedAt: text("joined_at").notNull(),
  },
  (table) => [uniqueIndex("players_room_seat_unique").on(table.roomId, table.seat)],
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
