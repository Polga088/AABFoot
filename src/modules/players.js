const { db } = require("../db/database");

function normalizePhone(phone) {
  if (!phone) return "";
  const value = String(phone).trim();
  if (value.includes("@")) return value;
  const digits = value.replace(/\D/g, "");
  if (!digits) return value;
  return `${digits}@c.us`;
}

function ensurePlayerFromWhatsApp(phone, displayName) {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Numero WhatsApp invalide.");
  }

  let player = db.prepare("SELECT * FROM players WHERE phone = ?").get(normalized);
  if (player) {
    return player;
  }

  const safeName = (displayName || "Joueur").trim().slice(0, 80) || "Joueur";
  const tx = db.transaction(() => {
    const result = db
      .prepare("INSERT INTO players (name, phone, role, active) VALUES (?, ?, 'player', 1)")
      .run(safeName, normalized);
    db.prepare("INSERT INTO wallets (player_id, balance) VALUES (?, 0)").run(result.lastInsertRowid);
    return db.prepare("SELECT * FROM players WHERE id = ?").get(result.lastInsertRowid);
  });

  return tx();
}

async function resolveVoterName(client, voterId) {
  try {
    const contact = await client.getContactById(voterId);
    return contact.pushname || contact.name || contact.shortName || "Joueur";
  } catch {
    return "Joueur";
  }
}

module.exports = {
  normalizePhone,
  ensurePlayerFromWhatsApp,
  resolveVoterName
};
