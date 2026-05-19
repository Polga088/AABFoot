CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,
  role TEXT DEFAULT 'player',
  active INTEGER DEFAULT 1,
  password_hash TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER UNIQUE NOT NULL,
  balance REAL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  amount REAL NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  time TEXT NOT NULL,
  location TEXT DEFAULT 'Terrain habituel',
  status TEXT DEFAULT 'scheduled',
  score_a INTEGER DEFAULT NULL,
  score_b INTEGER DEFAULT NULL,
  notes TEXT,
  homme_du_match TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS availabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',
  responded_at DATETIME,
  UNIQUE(player_id, match_id),
  FOREIGN KEY (player_id) REFERENCES players(id),
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

CREATE TABLE IF NOT EXISTS lineups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  team_a TEXT NOT NULL,
  team_b TEXT NOT NULL,
  color_a TEXT DEFAULT 'Rouge',
  color_b TEXT DEFAULT 'Vert',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS match_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  caption TEXT,
  uploaded_by TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (match_id) REFERENCES matches(id)
);

-- Legacy DB migration hint:
-- SELECT name FROM pragma_table_info('matches');
-- ALTER TABLE matches ADD COLUMN score_a INTEGER DEFAULT NULL;
-- ALTER TABLE matches ADD COLUMN score_b INTEGER DEFAULT NULL;
-- ALTER TABLE matches ADD COLUMN notes TEXT;
