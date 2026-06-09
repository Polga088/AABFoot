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
    { name: "last_name", sql: "ALTER TABLE players ADD COLUMN last_name TEXT" },
    { name: "display_name", sql: "ALTER TABLE players ADD COLUMN display_name TEXT" },
    { name: "cotisation_amount", sql: "ALTER TABLE players ADD COLUMN cotisation_amount REAL" }
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

function deactivateInvalidPhonePlayers() {
  const { normalizePhone, isWhatsAppInternalId } = require("../utils/phone");
  const rows = db.prepare("SELECT id, phone FROM players WHERE active = 1").all();
  const deactivate = db.prepare("UPDATE players SET active = 0 WHERE id = ?");

  for (const row of rows) {
    if (!row.phone || isWhatsAppInternalId(row.phone) || !normalizePhone(row.phone)) {
      deactivate.run(row.id);
      console.warn(`Joueur #${row.id} desactive — ID/LID invalide: ${row.phone}`);
    }
  }
}

function normalizePlayerPhones() {
  const { normalizePhone } = require("../utils/phone");
  const rows = db.prepare("SELECT id, phone FROM players ORDER BY id ASC").all();

  const updatePhone = db.prepare("UPDATE players SET phone = ? WHERE id = ?");
  const findConflict = db.prepare(
    "SELECT id FROM players WHERE phone = ? AND id != ? LIMIT 1"
  );

  for (const row of rows) {
    const canonical = normalizePhone(row.phone);
    if (!canonical || row.phone === canonical) continue;
    if (findConflict.get(canonical, row.id)) continue;
    updatePhone.run(canonical, row.id);
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

function ensureBotTasksTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS bot_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_type TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      result_json TEXT
    )
  `);
}

function initDatabase() {
  db.pragma("foreign_keys = ON");
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  db.exec(schema);
  ensureMatchColumns();
  ensurePlayerColumns();
  normalizePlayerPhones();
  deactivateInvalidPhonePlayers();
  ensureAvailabilityColumns();
  ensureBotTasksTable();
  const { ensureAppSettingsTable } = require("../modules/appSettings");
  ensureAppSettingsTable();
  ensureBotTasksPayloadColumn();
  seedPlayersIfEmpty();
}

function ensureBotTasksPayloadColumn() {
  const rows = db.prepare("SELECT name FROM pragma_table_info('bot_tasks')").all();
  const columns = new Set(rows.map((row) => row.name));
  if (!columns.has("payload_json")) {
    db.exec("ALTER TABLE bot_tasks ADD COLUMN payload_json TEXT");
  }
}

module.exports = {
  db,
  initDatabase
};
