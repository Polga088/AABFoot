const { getSetting, setSetting } = require("./appSettings");

const VALID_GROUP_ID = /^\d+@g\.us$/;

function isValidGroupId(groupId) {
  return typeof groupId === "string" && VALID_GROUP_ID.test(groupId.trim());
}

function isInviteLinkId(groupId) {
  const base = (groupId || "").replace("@g.us", "").trim();
  return Boolean(base) && !/^\d{12,}$/.test(base);
}

function warnIfInvalidGroupId() {
  const groupId = (process.env.GROUP_ID || "").trim();
  if (!groupId) {
    console.warn("⚠️  GROUP_ID vide — voir la liste des groupes ci-dessous.");
    return;
  }
  if (!groupId.endsWith("@g.us")) {
    console.warn(
      `⚠️  GROUP_ID invalide: "${groupId}"\n` +
        "    Un groupe WhatsApp finit par @g.us (pas @c.us)."
    );
    return;
  }
  if (isInviteLinkId(groupId)) {
    console.warn(
      `⚠️  GROUP_ID="${groupId}" est un code d'invitation, PAS l'ID du groupe.\n` +
        "    Le lien https://chat.whatsapp.com/XXXX n'est pas utilisable ici.\n" +
        "    Utilisez l'ID numerique affiche ci-dessous (ex: 120363...@g.us)."
    );
  }
}

async function listGroups(client) {
  const chats = await client.getChats();
  return chats
    .filter((chat) => chat.isGroup)
    .map((group) => ({
      name: group.name || "Sans nom",
      id: group.id?._serialized || group.id
    }));
}

async function logGroupDirectory(client) {
  try {
    const groups = await listGroups(client);
    if (!groups.length) {
      console.log("Aucun groupe WhatsApp trouve sur ce compte.");
      return groups;
    }

    console.log("\n📋 Groupes WhatsApp disponibles :");
    for (const group of groups) {
      console.log(`  • ${group.name} → ${group.id}`);
    }
    console.log("→ Copiez l'ID numerique dans .env : GROUP_ID=120363...@g.us\n");
    return groups;
  } catch (error) {
    console.error("Impossible de lister les groupes:", error.message);
    return [];
  }
}

function rememberGroupId(groupId) {
  if (!isValidGroupId(groupId)) return;
  process.env.GROUP_ID = groupId;
  setSetting("resolved_group_id", groupId);
}

async function resolveGroupChatId(client) {
  let configured = (process.env.GROUP_ID || "").trim();
  const nameHint = (process.env.GROUP_NAME || "Foot AAB").trim().toLowerCase();
  const cached = (getSetting("resolved_group_id") || "").trim();

  if (!isValidGroupId(configured) && isValidGroupId(cached)) {
    configured = cached;
    process.env.GROUP_ID = cached;
    console.log(`→ GROUP_ID corrige depuis la base: ${cached}`);
  }

  const groups = await listGroups(client);

  if (isValidGroupId(configured)) {
    try {
      const chat = await client.getChatById(configured);
      if (chat?.isGroup) {
        const id = chat.id._serialized || configured;
        rememberGroupId(id);
        return id;
      }
    } catch {
      console.warn(`GROUP_ID configure introuvable sur WhatsApp: ${configured}`);
    }
  } else if (configured && isInviteLinkId(configured)) {
    console.warn(
      `GROUP_ID="${configured}" invalide (code invitation). Recherche auto du groupe "${nameHint}"...`
    );
  }

  const matched = groups.find((group) => group.name.toLowerCase().includes(nameHint));
  if (matched) {
    console.log(`→ Groupe auto-selectionne: ${matched.name} (${matched.id})`);
    console.log(`→ Ajoutez dans /opt/football-bot/.env : GROUP_ID=${matched.id}`);
    rememberGroupId(matched.id);
    return matched.id;
  }

  if (groups.length === 1) {
    console.log(`→ Seul groupe disponible: ${groups[0].name} (${groups[0].id})`);
    rememberGroupId(groups[0].id);
    return groups[0].id;
  }

  const listing = groups.map((g) => `  • ${g.name} → ${g.id}`).join("\n") || "  (aucun)";
  throw new Error(
    `Impossible de trouver le groupe equipe.\n` +
      `Corrigez .env avec l'ID numerique, par exemple:\n` +
      `GROUP_ID=120363424533260613@g.us\n\n` +
      `Groupes disponibles:\n${listing}`
  );
}

module.exports = {
  isValidGroupId,
  isInviteLinkId,
  warnIfInvalidGroupId,
  logGroupDirectory,
  resolveGroupChatId,
  listGroups
};
