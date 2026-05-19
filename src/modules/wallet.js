const { db } = require("../db/database");

function getBalance(playerId) {
  const row = db.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(playerId);
  return Number(row?.balance || 0);
}

function credit(playerId, amount, description = "Credit manuel") {
  const value = Number(amount);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error("Montant de credit invalide.");
  }

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO transactions (player_id, amount, type, description) VALUES (?, ?, 'credit', ?)"
    ).run(playerId, value, description);

    db.prepare(
      "UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?"
    ).run(value, playerId);
  });

  tx();
  return getBalance(playerId);
}

function debit(playerId, amount, description = "Debit manuel") {
  const value = Number(amount);
  if (Number.isNaN(value) || value <= 0) {
    throw new Error("Montant de debit invalide.");
  }

  const currentBalance = getBalance(playerId);
  if (currentBalance < value) {
    const err = new Error("Solde insuffisant.");
    err.code = "INSUFFICIENT_BALANCE";
    throw err;
  }

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO transactions (player_id, amount, type, description) VALUES (?, ?, 'debit', ?)"
    ).run(playerId, -Math.abs(value), description);

    db.prepare(
      "UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?"
    ).run(Math.abs(value), playerId);
  });

  tx();
  return getBalance(playerId);
}

function getHistory(playerId, limit = 5) {
  const safeLimit = Math.max(1, Number(limit) || 5);
  return db
    .prepare(
      `
      SELECT amount, type, description, created_at
      FROM transactions
      WHERE player_id = ?
      ORDER BY datetime(created_at) DESC
      LIMIT ?
    `
    )
    .all(playerId, safeLimit);
}

function checkLowBalances() {
  return db
    .prepare(
      `
      SELECT p.id AS player_id, p.name, p.phone, w.balance
      FROM players p
      JOIN wallets w ON w.player_id = p.id
      WHERE p.active = 1 AND w.balance < 20
      ORDER BY w.balance ASC, p.name ASC
    `
    )
    .all();
}

function formatBalanceMessage(playerName, balance, history) {
  const rows = (history || [])
    .map((entry) => {
      const emoji = entry.amount >= 0 ? "🟢" : "🔴";
      const amount = Number(entry.amount || 0).toFixed(2);
      const label = entry.description || entry.type;
      return `${emoji} ${amount} MAD - ${label}`;
    })
    .join("\n");

  return [
    `💼 *Portefeuille de ${playerName}*`,
    `💰 Solde: *${Number(balance || 0).toFixed(2)} MAD*`,
    "",
    "🧾 *Dernieres operations*",
    rows || "Aucune transaction pour le moment."
  ].join("\n");
}

module.exports = {
  getBalance,
  credit,
  debit,
  getHistory,
  checkLowBalances,
  formatBalanceMessage
};
