const { db } = require("../db/database");

function ensureAppSettingsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function getSetting(key, fallback = null) {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key);
  if (row?.value !== undefined && row.value !== null && row.value !== "") {
    return row.value;
  }
  return fallback;
}

function setSetting(key, value) {
  db.prepare(
    `
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(key, String(value));
}

function getDefaultCotisationAmount() {
  const stored = getSetting("default_cotisation");
  if (stored !== null) {
    const parsed = Number(stored);
    if (parsed > 0) return parsed;
  }
  return Number(process.env.COTISATION_AMOUNT || 10);
}

module.exports = {
  ensureAppSettingsTable,
  getSetting,
  setSetting,
  getDefaultCotisationAmount
};
