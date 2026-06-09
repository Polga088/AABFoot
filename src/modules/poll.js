const { Poll } = require("whatsapp-web.js");
const { db } = require("../db/database");
const { findRegisteredPlayerForVote } = require("./players");
const { applyMatchVote } = require("./matchCotisation");
const { canAcceptYesVote, formatMaxPlayers } = require("./matchLimits");
const { resolveGroupChatId } = require("./groups");
const { sleep, formatError, waitForConnected, prepareChat } = require("./whatsapp");

const POLL_OPTIONS = ["Oui", "Non", "Peut-etre"];

/** Evite les doubles traitements WhatsApp (vote_update en rafale) */
const recentVoteKeys = new Map();
const VOTE_DEDUP_MS = 4000;

function getMatchByPollMessageId(messageId) {
  if (!messageId) return null;

  const direct = db.prepare("SELECT * FROM matches WHERE poll_message_id = ?").get(messageId);
  if (direct) return direct;

  const suffix = String(messageId).split("_").pop();
  if (!suffix) return null;

  return db
    .prepare(
      `
      SELECT *
      FROM matches
      WHERE poll_message_id LIKE ?
        AND status IN ('scheduled', 'training')
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(`%${suffix}`);
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

function isDuplicateVote(playerId, matchId, status) {
  const key = `${playerId}:${matchId}:${status}`;
  const now = Date.now();
  const last = recentVoteKeys.get(key);
  recentVoteKeys.set(key, now);

  if (recentVoteKeys.size > 500) {
    for (const [k, ts] of recentVoteKeys) {
      if (now - ts > VOTE_DEDUP_MS) recentVoteKeys.delete(k);
    }
  }

  return last && now - last < VOTE_DEDUP_MS;
}

async function notifyVoter(client, voterId, lines) {
  try {
    await client.sendMessage(voterId, lines.join("\n"));
  } catch (error) {
    console.warn("MP votant impossible:", error.message);
  }
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
  if (!match) {
    console.warn(`Vote ignore — sondage inconnu (messageId=${messageId || "?"})`);
    return false;
  }

  const status = mapVoteToStatus(vote.selectedOptions);
  const voterId = vote.voter;

  const player = await findRegisteredPlayerForVote(client, voterId);
  if (!player) {
    console.warn(`Vote ignore — joueur non enregistre (voter=${voterId}, match=#${match.id})`);
    await notifyVoter(client, voterId, [
      "⚠️ *Vote non pris en compte*",
      "Votre numero n'est pas reconnu dans la liste de l'equipe.",
      "Demandez a l'admin de vous ajouter sur */joueurs* avec votre numero *06…* ou *212…*,",
      "puis revotez sur le sondage."
    ]);
    return true;
  }

  if (isDuplicateVote(player.id, match.id, status)) {
    console.log(`Vote dedup ignore: #${player.id} match #${match.id} → ${status}`);
    return true;
  }

  if (status === "yes") {
    const capacity = canAcceptYesVote(match, player.id);
    if (!capacity.allowed) {
      await notifyVoter(
        client,
        voterId,
        `⚠️ *Complet* — ${capacity.current}/${capacity.max} pour le ${match.format || "match"}.\n` +
          `Votre vote « Oui » n'est pas accepté. Contactez l'admin pour la composition.`
      );
      return true;
    }
  }

  const billing = applyMatchVote(player.id, match.id, status);

  if (billing.action === "unchanged") {
    return true;
  }

  if (billing.action === "debited") {
    console.log(
      `Cotisation -${billing.amount} dh: joueur #${player.id} (match #${match.id}) solde=${billing.balance}`
    );
    await notifyVoter(client, voterId, [
      `✅ *Dispo enregistree* — Oui pour le ${match.date} ${match.time}`,
      `💰 Cotisation: -${billing.amount} dh`,
      `💼 Nouveau solde: *${Number(billing.balance).toFixed(2)} dh*`
    ]);
  } else if (billing.action === "refunded") {
    console.log(
      `Remboursement +${billing.amount} dh: joueur #${player.id} (match #${match.id})`
    );
    await notifyVoter(client, voterId, [
      `✅ *Vote mis a jour*`,
      `↩️ Remboursement cotisation: +${billing.amount} dh`,
      `💼 Solde: *${Number(billing.balance).toFixed(2)} dh*`
    ]);
  } else if (billing.action === "debit_failed") {
    console.warn(
      `Vote Oui sans debit joueur #${player.id}: ${billing.error} (match #${match.id})`
    );
    await notifyVoter(client, voterId, [
      `⚠️ *Vote Oui enregistre* mais cotisation impossible`,
      `Solde insuffisant (${billing.amount} dh requis).`,
      `💼 Solde actuel: *${Number(billing.balance).toFixed(2)} dh*`,
      "Rechargez votre wallet puis contactez l'admin si besoin."
    ]);
  } else if (billing.action === "availability_only" || billing.action === "none") {
    console.log(`Dispo joueur #${player.id} match #${match.id} → ${status}`);
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
