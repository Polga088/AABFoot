const cron = require("node-cron");
const { db } = require("../db/database");
const { processWeeklyCotisation } = require("../modules/cotisation");
const { getCurrentMatch, getAvailabilitySummary, formatMatchMessage } = require("../modules/match");
const { generateLineup, formatLineupMessage } = require("../modules/lineup");
const { notifyLineupPlayers } = require("../modules/notifications");
const { sendMatchPoll } = require("../modules/poll");
const { resolveGroupChatId } = require("../modules/groups");
const { checkLowBalances } = require("../modules/wallet");
const { getDefaultCotisationAmount } = require("../modules/appSettings");
const { normalizePhone, isWhatsAppInternalId } = require("../utils/phone");
const { sleep } = require("../modules/whatsapp");

async function sendPlayerMessage(client, rawPhone, text) {
  if (!rawPhone || isWhatsAppInternalId(rawPhone)) {
    return false;
  }
  const phone = normalizePhone(rawPhone);
  if (!phone) {
    return false;
  }

  try {
    await client.sendMessage(phone, text);
    await sleep(1200);
    return true;
  } catch (error) {
    console.warn(`MP impossible (${phone}):`, error.message);
    return false;
  }
}

function getPendingPlayers(matchId) {
  return db
    .prepare(
      `
      SELECT p.name, p.phone
      FROM players p
      LEFT JOIN availabilities a
        ON a.player_id = p.id
       AND a.match_id = ?
      WHERE p.active = 1
        AND COALESCE(a.status, 'pending') = 'pending'
      ORDER BY p.name ASC
    `
    )
    .all(matchId);
}

function findPlayersByNames(names) {
  if (!Array.isArray(names) || names.length === 0) return [];
  const placeholders = names.map(() => "?").join(", ");
  return db
    .prepare(`SELECT name, phone FROM players WHERE name IN (${placeholders})`)
    .all(...names);
}

async function getGroupId(client) {
  try {
    return await resolveGroupChatId(client);
  } catch {
    return (process.env.GROUP_ID || "").trim();
  }
}

function startScheduler(client) {
  const cotisationAmount = getDefaultCotisationAmount();

  // 1) Lundi 08h00: cotisation hebdo (desactivee si COTISATION_ON_VOTE=1, defaut)
  const cotisationOnVote = process.env.COTISATION_ON_VOTE !== "0";
  cron.schedule("0 8 * * 1", async () => {
    if (cotisationOnVote) return;
    try {
      const result = processWeeklyCotisation();
      const failedPlayers = findPlayersByNames(result.failed);

      for (const player of failedPlayers) {
        await sendPlayerMessage(
          client,
          player.phone,
          `⚠️ ${player.name}, debit cotisation impossible (solde insuffisant). Merci de recharger ton wallet.`
        );
      }
    } catch (error) {
      console.error("Erreur cron cotisation hebdo:", error);
    }
  });

  // 2) Vendredi 20h00: demande de disponibilite dans le groupe.
  cron.schedule("0 20 * * 5", async () => {
    try {
      const groupId = await getGroupId(client);
      if (!groupId) return;
      const match = getCurrentMatch();
      if (!match) return;

      const summary = getAvailabilitySummary(match.id);
      if (!match.poll_message_id) {
        await sendMatchPoll(client, match.id);
      } else {
        const message = [
          formatMatchMessage(match, summary),
          "",
          "Votez sur le sondage du groupe (Oui / Non / Peut-etre)."
        ].join("\n");
        await client.sendMessage(groupId, message);
      }
    } catch (error) {
      console.error("Erreur cron demande dispo:", error);
    }
  });

  // 3) Samedi 10h00: rappel prive aux joueurs en attente.
  cron.schedule("0 10 * * 6", async () => {
    try {
      const match = getCurrentMatch();
      if (!match) return;

      const pendingPlayers = getPendingPlayers(match.id);
      for (const player of pendingPlayers) {
        await sendPlayerMessage(
          client,
          player.phone,
          `⏰ Rappel dispo: vote sur le sondage du groupe pour le match #${match.id} (${match.date} ${match.time}).`
        );
      }
    } catch (error) {
      console.error("Erreur cron rappel pending:", error);
    }
  });

  // 4) Samedi 16h00: generation et envoi lineup dans le groupe.
  cron.schedule("0 16 * * 6", async () => {
    try {
      const groupId = await getGroupId(client);
      if (!groupId) return;
      const match = getCurrentMatch();
      if (!match) return;

      const lineup = generateLineup(match.id);
      const message = formatLineupMessage(lineup, match);
      await client.sendMessage(groupId, message);

      const alreadyNotified = Boolean(match.lineup_notified_at);
      if (!alreadyNotified) {
        await notifyLineupPlayers(client, match.id, { force: false });
      }
    } catch (error) {
      console.error("Erreur cron generation lineup:", error);
    }
  });

  // 5) Dimanche 09h00: alerte solde faible en prive.
  cron.schedule("0 9 * * 0", async () => {
    try {
      const lowBalances = checkLowBalances();
      for (const player of lowBalances) {
        await sendPlayerMessage(
          client,
          player.phone,
          `⚠️ Ton wallet FootBot est à ${Number(player.balance).toFixed(2)} dh. Pense à recharger avant lundi (cotisation ${cotisationAmount} dh) 🙏`
        );
      }
    } catch (error) {
      console.error("Erreur cron low balances:", error);
    }
  });
}

module.exports = {
  startScheduler
};
