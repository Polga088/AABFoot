const { db } = require("../db/database");
const wallet = require("./wallet");

function getCotisationAmount() {
  return Number(process.env.COTISATION_AMOUNT || 10);
}

function getAvailabilityRow(playerId, matchId) {
  return db
    .prepare(
      `
      SELECT status, cotisation_charged
      FROM availabilities
      WHERE player_id = ? AND match_id = ?
    `
    )
    .get(playerId, matchId);
}

function setCotisationCharged(playerId, matchId, charged) {
  db.prepare(
    `
    UPDATE availabilities
    SET cotisation_charged = ?
    WHERE player_id = ? AND match_id = ?
  `
  ).run(charged ? 1 : 0, playerId, matchId);
}

function debitForDispo(playerId, matchId) {
  const amount = getCotisationAmount();
  const description = `Cotisation match #${matchId} (dispo)`;

  const tx = db.transaction(() => {
    db.prepare(
      `
      INSERT INTO transactions (player_id, amount, type, description)
      VALUES (?, ?, 'cotisation', ?)
    `
    ).run(playerId, -Math.abs(amount), description);

    db.prepare(
      `
      UPDATE wallets
      SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
      WHERE player_id = ?
    `
    ).run(Math.abs(amount), playerId);
  });

  tx();
  setCotisationCharged(playerId, matchId, true);
  return wallet.getBalance(playerId);
}

function refundDispo(playerId, matchId) {
  const amount = getCotisationAmount();
  const description = `Remboursement match #${matchId} (changement vote)`;
  wallet.credit(playerId, amount, description);
  setCotisationCharged(playerId, matchId, false);
  return wallet.getBalance(playerId);
}

/**
 * Applique la regle metier:
 * - vote Oui -> debit 10 dh (une fois par match)
 * - vote Non / Peut-etre -> pas de debit; rembourse si on quitte Oui
 */
function applyVoteCotisation(playerId, matchId, newStatus) {
  const previous = getAvailabilityRow(playerId, matchId);
  const prevStatus = previous?.status || "pending";
  const wasCharged = Boolean(previous?.cotisation_charged);

  if (newStatus === "yes" && !wasCharged) {
    try {
      debitForDispo(playerId, matchId);
      return { action: "debited", amount: getCotisationAmount() };
    } catch (error) {
      console.error(`Debit cotisation impossible joueur #${playerId}:`, error.message);
      return { action: "debit_failed", error: error.message };
    }
  }

  if (newStatus !== "yes" && wasCharged) {
    refundDispo(playerId, matchId);
    return { action: "refunded", amount: getCotisationAmount() };
  }

  return { action: "none" };
}

module.exports = {
  getCotisationAmount,
  applyVoteCotisation
};
