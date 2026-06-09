const { db } = require("../db/database");
const wallet = require("./wallet");
const { getDefaultCotisationAmount } = require("./appSettings");

function isCotisationOnVoteEnabled() {
  return process.env.COTISATION_ON_VOTE !== "0";
}

function getCotisationAmount(playerId) {
  const defaultAmount = getDefaultCotisationAmount();
  if (!playerId) return defaultAmount;
  const row = db
    .prepare("SELECT cotisation_amount FROM players WHERE id = ?")
    .get(playerId);
  const custom = row?.cotisation_amount;
  if (custom === null || custom === undefined) return defaultAmount;
  const parsed = Number(custom);
  return parsed > 0 ? parsed : defaultAmount;
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

function hasCotisationTransaction(playerId, matchId) {
  const desc = `Cotisation match #${matchId} (dispo)`;
  return Boolean(
    db
      .prepare(
        `
        SELECT id FROM transactions
        WHERE player_id = ? AND type = 'cotisation' AND description = ?
        LIMIT 1
      `
      )
      .get(playerId, desc)
  );
}

function insertCotisationDebit(playerId, matchId, amount) {
  const description = `Cotisation match #${matchId} (dispo)`;
  const value = Math.abs(Number(amount));

  const currentBalance = wallet.getBalance(playerId);
  if (currentBalance < value) {
    const err = new Error("Solde insuffisant.");
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  db.prepare(
    `
    INSERT INTO transactions (player_id, amount, type, description)
    VALUES (?, ?, 'cotisation', ?)
  `
  ).run(playerId, -value, description);

  db.prepare(
    `
    UPDATE wallets
    SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP
    WHERE player_id = ?
  `
  ).run(value, playerId);
}

function insertCotisationRefund(playerId, matchId, amount) {
  const description = `Remboursement match #${matchId} (changement vote)`;
  wallet.credit(playerId, amount, description);
}

/**
 * Vote dispo + cotisation en une seule transaction SQLite (idempotent).
 * - Oui → debit une fois par match
 * - Non / Peut-etre / pending → rembourse si deja debite
 */
function applyMatchVote(playerId, matchId, newStatus) {
  if (!["yes", "no", "maybe", "pending"].includes(newStatus)) {
    throw new Error("Statut de disponibilite invalide.");
  }

  const cotisationEnabled = isCotisationOnVoteEnabled();

  const result = db.transaction(() => {
    const previous = getAvailabilityRow(playerId, matchId);
    const wasCharged = Boolean(previous?.cotisation_charged);
    const prevStatus = previous?.status || "pending";

    const needsChargeRetry =
      cotisationEnabled &&
      newStatus === "yes" &&
      !wasCharged &&
      !hasCotisationTransaction(playerId, matchId);

    if (prevStatus === newStatus && !needsChargeRetry) {
      return {
        action: "unchanged",
        prevStatus,
        newStatus,
        amount: 0,
        balance: wallet.getBalance(playerId)
      };
    }

    db.prepare(
      `
      INSERT INTO availabilities (player_id, match_id, status, responded_at, cotisation_charged)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
      ON CONFLICT(player_id, match_id) DO UPDATE SET
        status = excluded.status,
        responded_at = CURRENT_TIMESTAMP
    `
    ).run(playerId, matchId, newStatus, wasCharged ? 1 : 0);

    let action = "none";
    let amount = 0;

    if (!cotisationEnabled) {
      return {
        action: "availability_only",
        prevStatus,
        newStatus,
        amount: 0,
        balance: wallet.getBalance(playerId)
      };
    }

    const shouldCharge = newStatus === "yes";

    if (shouldCharge && !wasCharged) {
      amount = getCotisationAmount(playerId);

      const claim = db
        .prepare(
          `
          UPDATE availabilities
          SET cotisation_charged = 1
          WHERE player_id = ? AND match_id = ? AND cotisation_charged = 0
        `
        )
        .run(playerId, matchId);

      if (claim.changes === 0 || hasCotisationTransaction(playerId, matchId)) {
        db.prepare(
          `UPDATE availabilities SET cotisation_charged = 1 WHERE player_id = ? AND match_id = ?`
        ).run(playerId, matchId);
        return {
          action: "already_charged",
          prevStatus,
          newStatus,
          amount,
          balance: wallet.getBalance(playerId)
        };
      }

      try {
        insertCotisationDebit(playerId, matchId, amount);
        action = "debited";
      } catch (error) {
        db.prepare(
          `
          UPDATE availabilities
          SET cotisation_charged = 0
          WHERE player_id = ? AND match_id = ?
        `
        ).run(playerId, matchId);

        if (error.code === "INSUFFICIENT_BALANCE") {
          return {
            action: "debit_failed",
            prevStatus,
            newStatus,
            amount,
            error: error.message,
            balance: wallet.getBalance(playerId)
          };
        }
        throw error;
      }
    } else if (!shouldCharge && wasCharged) {
      amount = getCotisationAmount(playerId);

      const release = db
        .prepare(
          `
          UPDATE availabilities
          SET cotisation_charged = 0
          WHERE player_id = ? AND match_id = ? AND cotisation_charged = 1
        `
        )
        .run(playerId, matchId);

      if (release.changes > 0) {
        insertCotisationRefund(playerId, matchId, amount);
        action = "refunded";
      }
    }

    return {
      action,
      prevStatus,
      newStatus,
      amount,
      balance: wallet.getBalance(playerId)
    };
  })();

  return result;
}

/** @deprecated Utiliser applyMatchVote */
function applyVoteCotisation(playerId, matchId, newStatus) {
  const result = applyMatchVote(playerId, matchId, newStatus);
  return {
    action: result.action,
    amount: result.amount,
    error: result.error
  };
}

module.exports = {
  isCotisationOnVoteEnabled,
  getCotisationAmount,
  getDefaultCotisationAmount,
  applyMatchVote,
  applyVoteCotisation
};
