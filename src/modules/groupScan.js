const { findPlayerByPhone } = require("./players");
const { formatLocalPhone } = require("../utils/phone");

function participantId(participant) {
  const raw = participant?.id;
  if (!raw) return null;
  if (typeof raw === "string") return raw;
  return raw._serialized || raw.user || null;
}

async function resolveContactName(client, waId) {
  try {
    const contact = await client.getContactById(waId);
    return (contact.pushname || contact.name || contact.shortName || "").trim();
  } catch {
    return "";
  }
}

async function scanGroupForUnknownPlayers(client, groupChatId) {
  const chat = await client.getChatById(groupChatId);
  if (!chat?.isGroup) {
    const error = new Error("not_a_group");
    error.code = "not_a_group";
    throw error;
  }

  const participants = chat.participants || [];
  const botId = client.info?.wid?._serialized;
  const unknown = [];
  let registeredCount = 0;
  let skipped = 0;

  for (const participant of participants) {
    const waId = participantId(participant);
    if (!waId || !waId.endsWith("@c.us")) {
      skipped += 1;
      continue;
    }
    if (botId && waId === botId) {
      skipped += 1;
      continue;
    }

    const existing = findPlayerByPhone(waId);
    if (existing) {
      registeredCount += 1;
      continue;
    }

    const displayName = await resolveContactName(client, waId);
    unknown.push({
      waId,
      phone: formatLocalPhone(waId),
      name: displayName
    });
  }

  unknown.sort((a, b) => a.phone.localeCompare(b.phone));

  return {
    groupName: chat.name || "Groupe",
    totalParticipants: participants.length,
    registeredCount,
    skipped,
    unknown
  };
}

function formatScanReport(result) {
  const { groupName, totalParticipants, registeredCount, unknown } = result;
  const lines = [
    `📋 *Scan — ${groupName}*`,
    `Participants: ${totalParticipants} · En base: ${registeredCount}`,
    ""
  ];

  if (!unknown.length) {
    lines.push("✅ Tous les membres du groupe sont deja dans la liste joueurs.");
    return lines.join("\n");
  }

  lines.push(`🆕 *A ajouter (${unknown.length})* :`);
  unknown.forEach((entry, index) => {
    const label = entry.name ? ` — ${entry.name}` : "";
    lines.push(`${index + 1}. \`${entry.phone}\`${label}`);
  });

  lines.push("");
  lines.push("*Copier-coller :*");
  lines.push(unknown.map((entry) => entry.phone).join(", "));
  lines.push("");
  lines.push("Ajoutez-les sur la webapp : /joueurs");

  return lines.join("\n");
}

function splitMessage(text, maxLen = 3800) {
  if (text.length <= maxLen) return [text];

  const chunks = [];
  let buffer = "";

  for (const line of text.split("\n")) {
    const candidate = buffer ? `${buffer}\n${line}` : line;
    if (candidate.length > maxLen && buffer) {
      chunks.push(buffer);
      buffer = line;
    } else {
      buffer = candidate;
    }
  }

  if (buffer) chunks.push(buffer);
  return chunks;
}

async function replyLongMessage(msg, text) {
  const chunks = splitMessage(text);
  for (const chunk of chunks) {
    await msg.reply(chunk);
  }
}

module.exports = {
  scanGroupForUnknownPlayers,
  formatScanReport,
  replyLongMessage
};
