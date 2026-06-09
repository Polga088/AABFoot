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
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Numero WhatsApp invalide.");
  }

  const existing = findPlayerByPhone(normalized);
  if (existing) {
    return existing;
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

async function resolveVoterPhone(client, voterId) {
  if (!voterId) return null;

  const direct = normalizePhone(voterId);
  if (direct) return direct;

  if (client?.getContactLidAndPhone) {
    try {
      const mapped = await client.getContactLidAndPhone([voterId]);
      const entry = mapped?.[0];
      if (entry?.pn) {
        const fromPn = normalizePhone(entry.pn);
        if (fromPn) return fromPn;
      }
    } catch (error) {
      console.warn("Mapping LID→telephone echoue:", error.message);
    }
  }

  try {
    const contact = await client.getContactById(voterId);
    const candidates = [
      contact?.number,
      contact?.id?.server === "c.us" ? contact?.id?.user : null,
      contact?.id?._serialized
    ];
    for (const candidate of candidates) {
      const normalized = normalizePhone(candidate);
      if (normalized) return normalized;
    }
  } catch (error) {
    console.warn("Contact vote introuvable:", error.message);
  }

  return null;
}

async function findRegisteredPlayerForVote(client, voterId) {
  const phone = await resolveVoterPhone(client, voterId);
  if (!phone) return null;
  return findPlayerByPhone(phone);
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
  resolveVoterPhone,
  findRegisteredPlayerForVote,
  resolveVoterName
};
