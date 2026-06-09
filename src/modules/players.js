const { db } = require("../db/database");
const {
  normalizePhone,
  getPhoneLookupVariants,
  isWhatsAppInternalId
} = require("../utils/phone");

function findPlayerByPhone(rawPhone) {
  const variants = getPhoneLookupVariants(rawPhone);
  if (!variants.length) return null;

  const placeholders = variants.map(() => "?").join(", ");
  return db
    .prepare(`SELECT * FROM players WHERE phone IN (${placeholders}) LIMIT 1`)
    .get(...variants);
}

/**
 * Ne crée JAMAIS de joueur — réservé aux imports admin explicites ailleurs.
 * Retourne un joueur existant ou lève une erreur.
 */
function ensurePlayerFromWhatsApp(phone, displayName) {
  const normalized = normalizePhone(phone);
  if (!normalized || isWhatsAppInternalId(phone)) {
    throw new Error("Numero WhatsApp invalide (LID interne refuse).");
  }

  const existing = findPlayerByPhone(normalized);
  if (existing) {
    return existing;
  }

  throw new Error(
    "Joueur non enregistre. Ajoutez-le via la webapp /joueurs (pas de creation auto au vote)."
  );
}

async function resolvePhoneViaWhatsAppApi(client, userId) {
  if (!client?.pupPage || !userId) return null;

  try {
    const serialized = await client.pupPage.evaluate(async (id) => {
      const { lid, phone } = await window.WWebJS.enforceLidAndPnRetrieval(id);
      const candidates = [];

      const pushWid = (wid) => {
        if (!wid) return;
        const serializedId = wid._serialized || wid;
        if (serializedId) candidates.push(serializedId);
      };

      pushWid(phone);
      pushWid(lid);

      const factory = window.require("WAWebWidFactory");
      const apiContact = window.require("WAWebApiContact");

      for (const candidate of [...candidates, id]) {
        try {
          const wid = factory.createWid(candidate);
          if (wid.server === "lid") {
            pushWid(apiContact.getPhoneNumber(wid));
          } else if (String(wid.user || "").length > 12) {
            const mappedLid = apiContact.getCurrentLid(wid);
            pushWid(apiContact.getPhoneNumber(mappedLid || wid));
          }
        } catch {
          /* ignore single candidate */
        }
      }

      return candidates;
    }, userId);

    const list = Array.isArray(serialized) ? serialized : [serialized];
    for (const candidate of list) {
      const normalized = normalizePhone(candidate);
      if (normalized) return normalized;
    }
  } catch (error) {
    console.warn("Resolution WhatsApp API echouee:", error.message);
  }

  return null;
}

async function resolveVoterPhone(client, voterId) {
  if (!voterId) return null;

  const candidates = new Set([String(voterId).trim()]);

  if (client?.getContactLidAndPhone) {
    try {
      const mapped = await client.getContactLidAndPhone([voterId]);
      const entry = mapped?.[0];
      if (entry?.pn) candidates.add(entry.pn);
      if (entry?.lid) candidates.add(entry.lid);
    } catch (error) {
      console.warn("Mapping LID→telephone echoue:", error.message);
    }
  }

  const viaApi = await resolvePhoneViaWhatsAppApi(client, voterId);
  if (viaApi) return viaApi;

  try {
    const contact = await client.getContactById(voterId);
    const contactCandidates = [
      contact?.number,
      contact?.id?.server === "c.us" ? contact?.id?.user : null,
      contact?.id?._serialized
    ];
    for (const candidate of contactCandidates) {
      if (candidate) candidates.add(candidate);
    }
  } catch (error) {
    console.warn("Contact vote introuvable:", error.message);
  }

  for (const candidate of candidates) {
    if (isWhatsAppInternalId(candidate)) continue;
    const normalized = normalizePhone(candidate);
    if (normalized) return normalized;
  }

  return null;
}

async function findRegisteredPlayerForVote(client, voterId) {
  const phone = await resolveVoterPhone(client, voterId);
  if (!phone) {
    console.warn(`Vote: impossible de resoudre le telephone (voter=${voterId})`);
    return null;
  }
  const player = findPlayerByPhone(phone);
  if (!player) {
    console.warn(`Vote: joueur non en base pour ${phone} (voter=${voterId})`);
  }
  return player;
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
  resolvePhoneViaWhatsAppApi,
  findRegisteredPlayerForVote,
  resolveVoterName
};
