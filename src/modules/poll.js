const { Poll } = require("whatsapp-web.js");
const { db } = require("../db/database");
const { findRegisteredPlayerForVote } = require("./players");
const { setAvailability } = require("./match");
const { applyVoteCotisation } = require("./matchCotisation");
const { canAcceptYesVote, formatMaxPlayers } = require("./matchLimits");
const { resolveGroupChatId } = require("./groups");
const { sleep, formatError, waitForConnected, prepareChat } = require("./whatsapp");

const POLL_OPTIONS = ["Oui", "Non", "Peut-etre"];

function getMatchByPollMessageId(messageId) {
  if (!messageId) return null;
  return db.prepare("SELECT * FROM matches WHERE poll_message_id = ?").get(messageId);
}

function buildPollTitle(match) {
  const kind = match.event_kind === "match" ? "Match" : "Entrainement";
  const vs =
    match.event_kind === "match" && match.opponent ? ` vs ${match.opponent}` : "";
  const format = match.format || "5v5";
  const max = formatMaxPlayers(format);
  const cap = max ? ` max ${max}` : "";
  return `${kind}${vs} - ${match.date} ${match.time} (${format}${cap})`.slice(0, 120);
}

function mapVoteToStatus(selectedOptions) {
  if (!Array.isArray(selectedOptions) || !selectedOptions.length) {
    return "pending";
  }

  const label = String(selectedOptions[0].name || "").toLowerCase();
  if (label.includes("oui") || label.includes("yes")) {
    return "yes";
  }
  if (label.includes("non") || label.includes("no")) {
    return "no";
  }
  if (label.includes("peut") || label.includes("maybe")) {
    return "maybe";
  }
  return "pending";
}

async function sendPollToChat(chat, poll) {
  try {
    return await chat.sendMessage(poll);
  } catch (firstError) {
    await sleep(2500);
    return await chat.sendMessage(poll);
  }
}

async function sendMatchPoll(client, matchId) {
  const connected = await waitForConnected(client);
  if (!connected) {
    throw new Error("WhatsApp pas encore connecte, reessayez dans 30 secondes");
  }

  await sleep(2000);

  const groupId = await resolveGroupChatId(client);
  const chat = await client.getChatById(groupId);
  if (!chat?.isGroup) {
    throw new Error(`Le chat ${groupId} n'est pas un groupe WhatsApp.`);
  }

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) {
    throw new Error(`Match #${matchId} introuvable.`);
  }

  await prepareChat(client, groupId);

  const poll = new Poll(buildPollTitle(match), POLL_OPTIONS);
  let sent;
  try {
    sent = await sendPollToChat(chat, poll);
  } catch (error) {
    const details = formatError(error);
    throw new Error(`Envoi sondage echoue: ${details}`);
  }

  const messageId = sent.id?._serialized;
  if (!messageId) {
    throw new Error("Impossible de recuperer l'identifiant du sondage WhatsApp.");
  }

  db.prepare(
    `
      UPDATE matches
      SET poll_message_id = ?,
          poll_sent_at = CURRENT_TIMESTAMP,
          poll_requested_at = NULL
      WHERE id = ?
    `
  ).run(messageId, matchId);

  console.log(`Sondage publie dans "${chat.name}" (${groupId})`);
  return { matchId, messageId, groupId };
}

function processPendingPollRequests() {
  return db
    .prepare(
      `
      SELECT id
      FROM matches
      WHERE poll_requested_at IS NOT NULL
        AND poll_sent_at IS NULL
        AND COALESCE(poll_send_stopped, 0) = 0
        AND status IN ('scheduled', 'training')
      ORDER BY poll_requested_at ASC
      LIMIT 1
    `
    )
    .all();
}

async function handlePollVote(client, vote) {
  const messageId =
    vote.parentMsgKey?._serialized || vote.parentMessage?.id?._serialized || null;
  const match = getMatchByPollMessageId(messageId);
  if (!match) return false;

  const status = mapVoteToStatus(vote.selectedOptions);
  if (status === "pending") return true;

  const voterId = vote.voter;
  const player = await findRegisteredPlayerForVote(client, voterId);
  if (!player) {
    console.warn(`Vote ignore — joueur non enregistre (voter=${voterId})`);
    try {
      await client.sendMessage(
        voterId,
        [
          "⚠️ *Vote non pris en compte*",
          "Vous n'etes pas encore dans la liste de l'equipe.",
          "Demandez a l'admin de vous ajouter (page *Joueurs* sur la webapp),",
          "puis revotez sur le sondage."
        ].join("\n")
      );
    } catch (error) {
      console.warn("Impossible d'avertir le votant non enregistre:", error.message);
    }
    return true;
  }

  if (status === "yes") {
    const capacity = canAcceptYesVote(match, player.id);
    if (!capacity.allowed) {
      try {
        await client.sendMessage(
          voterId,
          `⚠️ *Complet* — ${capacity.current}/${capacity.max} pour le ${match.format || "match"}.\n` +
            `Votre vote « Oui » n'est pas accepté. Contactez l'admin pour la composition.`
        );
      } catch (error) {
        console.warn(`Impossible d'avertir ${player.name} (complet):`, error.message);
      }
      return true;
    }
  }

  setAvailability(player.id, match.id, status);
  const billing = applyVoteCotisation(player.id, match.id, status);

  if (billing.action === "debited") {
    console.log(`Cotisation -${billing.amount} dh: ${player.name} (match #${match.id})`);
  } else if (billing.action === "refunded") {
    console.log(`Remboursement +${billing.amount} dh: ${player.name} (match #${match.id})`);
  } else if (billing.action === "debit_failed") {
    console.warn(`Vote Oui sans debit (${player.name}): ${billing.error}`);
  }

  return true;
}

module.exports = {
  POLL_OPTIONS,
  buildPollTitle,
  sendMatchPoll,
  processPendingPollRequests,
  handlePollVote,
  getMatchByPollMessageId,
  formatError
};
