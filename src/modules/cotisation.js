const { db } = require("../db/database");
const wallet = require("./wallet");

function getWeekNumber(date = new Date()) {
  const value = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = value.getUTCDay() || 7;
  value.setUTCDate(value.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1));
  return Math.ceil(((value - yearStart) / 86400000 + 1) / 7);
}

function processWeeklyCotisation() {
  const amount = Number(process.env.COTISATION_AMOUNT || 10);
  const week = getWeekNumber();
  const players = db
    .prepare(
      `
      SELECT p.id, p.name
      FROM players p
      WHERE p.active = 1
      ORDER BY p.name ASC
    `
    )
    .all();

  const result = {
    success: [],
    failed: []
  };

  for (const player of players) {
    try {
      wallet.debit(player.id, amount, `Cotisation semaine ${week}`);
      result.success.push(player.name);
    } catch (error) {
      if (error?.code !== "INSUFFICIENT_BALANCE") {
        console.error(`Erreur cotisation pour ${player.name}:`, error);
      }
      result.failed.push(player.name);
    }
  }

  return result;
}

module.exports = {
  processWeeklyCotisation,
  getWeekNumber
};
