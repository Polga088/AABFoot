const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath = process.env.DB_PATH || "./football.db";
const db = new Database(dbPath);

function ensureMatchColumns() {
  const rows = db.prepare("SELECT name FROM pragma_table_info('matches')").all();
  const columns = new Set(rows.map((row) => row.name));

  const alterations = [
    { name: "score_a", sql: "ALTER TABLE matches ADD COLUMN score_a INTEGER DEFAULT NULL" },
    { name: "score_b", sql: "ALTER TABLE matches ADD COLUMN score_b INTEGER DEFAULT NULL" },
    { name: "notes", sql: "ALTER TABLE matches ADD COLUMN notes TEXT" },
    { name: "homme_du_match", sql: "ALTER TABLE matches ADD COLUMN homme_du_match TEXT" },
    { name: "event_kind", sql: "ALTER TABLE matches ADD COLUMN event_kind TEXT DEFAULT 'training'" },
    { name: "opponent", sql: "ALTER TABLE matches ADD COLUMN opponent TEXT" },
    { name: "format", sql: "ALTER TABLE matches ADD COLUMN format TEXT DEFAULT '5v5'" },
    { name: "maps_url", sql: "ALTER TABLE matches ADD COLUMN maps_url TEXT" },
    { name: "poll_message_id", sql: "ALTER TABLE matches ADD COLUMN poll_message_id TEXT" },
    { name: "poll_requested_at", sql: "ALTER TABLE matches ADD COLUMN poll_requested_at DATETIME" },
    { name: "poll_sent_at", sql: "ALTER TABLE matches ADD COLUMN poll_sent_at DATETIME" },
    {
      name: "lineup_notify_requested_at",
      sql: "ALTER TABLE matches ADD COLUMN lineup_notify_requested_at DATETIME"
    },
    { name: "lineup_notified_at", sql: "ALTER TABLE matches ADD COLUMN lineup_notified_at DATETIME" },
    { name: "poll_delete_requested_at", sql: "ALTER TABLE matches ADD COLUMN poll_delete_requested_at DATETIME" },
    {
      name: "poll_republish_requested_at",
      sql: "ALTER TABLE matches ADD COLUMN poll_republish_requested_at DATETIME"
    },
    {
      name: "poll_send_stopped",
      sql: "ALTER TABLE matches ADD COLUMN poll_send_stopped INTEGER DEFAULT 0"
    },
    {
      name: "lineup_notify_force",
      sql: "ALTER TABLE matches ADD COLUMN lineup_notify_force INTEGER DEFAULT 0"
    }
  ];

  for (const item of alterations) {
    if (!columns.has(item.name)) {
      db.exec(item.sql);
    }
  }
}

function ensurePlayerColumns() {
  const rows = db.prepare("SELECT name FROM pragma_table_info('players')").all();
  const columns = new Set(rows.map((row) => row.name));

  const alterations = [
    { name: "first_name", sql: "ALTER TABLE players ADD COLUMN first_name TEXT" },
    { name: "last_name", sql: "ALTER TABLE players ADD COLUMN last_name TEXT" }
  ];

  for (const item of alterations) {
    if (!columns.has(item.name)) {
      db.exec(item.sql);
    }
  }

  db.prepare(
    `
    UPDATE players
    SET first_name = COALESCE(first_name, name),
        last_name = COALESCE(last_name, '')
    WHERE first_name IS NULL OR first_name = ''
  `
  ).run();
}

function ensureAvailabilityColumns() {
  const rows = db.prepare("SELECT name FROM pragma_table_info('availabilities')").all();
  const columns = new Set(rows.map((row) => row.name));
  if (!columns.has("cotisation_charged")) {
    db.exec("ALTER TABLE availabilities ADD COLUMN cotisation_charged INTEGER DEFAULT 0");
  }
}

function seedPlayersIfEmpty() {
  const row = db.prepare("SELECT COUNT(*) AS count FROM players").get();
  if ((row?.count || 0) > 0) return;

  const players = [
    { name: "Admin Foot", phone: "212600000001@c.us", role: "admin" },
    { name: "Youssef", phone: "212600000002@c.us", role: "player" },
    { name: "Hamza", phone: "212600000003@c.us", role: "player" }
  ];

  const insertPlayer = db.prepare(
    "INSERT INTO players (name, phone, role, active) VALUES (?, ?, ?, 1)"
  );
  const insertWallet = db.prepare(
    "INSERT INTO wallets (player_id, balance, updated_at) VALUES (?, 0, CURRENT_TIMESTAMP)"
  );

  const seed = db.transaction(() => {
    for (const player of players) {
      const result = insertPlayer.run(player.name, player.phone, player.role);
      insertWallet.run(result.lastInsertRowid);
    }
  });

  seed();
}

function initDatabase() {
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  ensureMatchColumns();
  ensurePlayerColumns();
  ensureAvailabilityColumns();
  seedPlayersIfEmpty();
}

module.exports = {
  db,
  initDatabase
};
