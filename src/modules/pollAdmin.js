const { db } = require("../db/database");
const { sendMatchPoll } = require("./poll");
const { formatError, waitForConnected } = require("./whatsapp");

async function deletePollMessage(client, matchId) {
  const match = db.prepare("SELECT id, poll_message_id FROM matches WHERE id = ?").get(matchId);
  if (!match?.poll_message_id) {
    throw new Error("Aucun sondage WhatsApp a supprimer pour ce match.");
  }

  await waitForConnected(client);

  try {
    const message = await client.getMessageById(match.poll_message_id);
    if (message) {
      await message.delete(true);
    }
  } catch (error) {
    console.warn(`Suppression WA echouee (match #${matchId}):`, formatError(error));
  }

  db.prepare(
    `
    UPDATE matches
    SET poll_message_id = NULL,
        poll_sent_at = NULL,
        poll_delete_requested_at = NULL
    WHERE id = ?
  `
  ).run(matchId);

  return { matchId, deleted: true };
}

async function republishPoll(client, matchId) {
  const match = db.prepare("SELECT poll_message_id FROM matches WHERE id = ?").get(matchId);
  if (match?.poll_message_id) {
    await deletePollMessage(client, matchId);
  }

  const result = await sendMatchPoll(client, matchId);
  db.prepare(
    `
    UPDATE matches
    SET poll_republish_requested_at = NULL
    WHERE id = ?
  `
  ).run(matchId);

  return result;
}

function processPendingPollAdminRequests() {
  return db
    .prepare(
      `
      SELECT id,
             poll_delete_requested_at,
             poll_republish_requested_at
      FROM matches
      WHERE poll_delete_requested_at IS NOT NULL
         OR poll_republish_requested_at IS NOT NULL
      ORDER BY COALESCE(poll_delete_requested_at, poll_republish_requested_at) ASC
      LIMIT 1
    `
    )
    .all();
}

module.exports = {
  deletePollMessage,
  republishPoll,
  processPendingPollAdminRequests
};
