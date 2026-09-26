CREATE TABLE IF NOT EXISTS room_games (
  room_id TEXT NOT NULL REFERENCES rooms(id),
  finished_at TEXT NOT NULL,
  game_json TEXT NOT NULL,
  PRIMARY KEY (room_id, finished_at)
);
