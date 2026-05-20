const { db } = require("../db/database");
const { normalizePhone, getPhoneLookupVariants } = require("../utils/phone");

function findPlayerByPhone(rawPhone) {
  const variants = getPhoneLookupVariants(rawPhone);
  if (!variants.length) return null;

  const placeholders = variants.map(() => "?").join(", ");
  return db
    .prepare(`SELECT * FROM players WHERE phone IN (${placeholders}) LIMIT 1`)
    .get(...variants);
}

function ensurePlayerFromWhatsApp(phone, displayName) {
  const existing = findPlayerByPhone(phone);
  if (existing) {
    return existing;
  }

  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Numero WhatsApp invalide.");
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
  getPhoneLookupVariants,
  findPlayerByPhone,
  ensurePlayerFromWhatsApp,
  resolveVoterName
};
