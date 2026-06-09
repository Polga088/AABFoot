const { db } = require("../db/database");
const { resolveGroupChatId } = require("./groups");
const { getDefaultCotisationAmount } = require("./appSettings");
const { waitForConnected } = require("./whatsapp");
const { normalizePhone } = require("../utils/phone");

function getPendingFinanceTasks() {
  return db
    .prepare(
      `
      SELECT id, task_type, payload_json
      FROM bot_tasks
      WHERE task_type IN ('wallet_reminder', 'cotisation_report')
        AND status = 'pending'
      ORDER BY requested_at ASC, id ASC
    `
    )
    .all();
}

function markTaskDone(taskId, result) {
  db.prepare(
    `
    UPDATE bot_tasks
    SET status = 'done', completed_at = CURRENT_TIMESTAMP, result_json = ?
    WHERE id = ?
  `
  ).run(JSON.stringify(result), taskId);
}

function markTaskError(taskId, message) {
  db.prepare(
    `
    UPDATE bot_tasks
    SET status = 'error', completed_at = CURRENT_TIMESTAMP, result_json = ?
    WHERE id = ?
  `
  ).run(JSON.stringify({ error: message }), taskId);
}

function playerCotisationAmount(row, defaultAmount) {
  const custom = row.cotisation_amount;
  if (custom === null || custom === undefined) return defaultAmount;
  const parsed = Number(custom);
  return parsed > 0 ? parsed : defaultAmount;
}

function buildCotisationReportMessage() {
  const defaultAmount = getDefaultCotisationAmount();
  const rows = db
    .prepare(
      `
      SELECT p.id, p.name, p.display_name, p.cotisation_amount,
             COALESCE(w.balance, 0) AS balance, p.active
      FROM players p
      LEFT JOIN wallets w ON w.player_id = p.id
      WHERE p.active = 1 AND p.role != 'admin'
      ORDER BY p.id ASC
    `
    )
    .all();

  const lines = [
    "📊 *Tableau cotisations & soldes*",
    `Cotisation par défaut : *${defaultAmount} dh*`,
    ""
  ];

  for (const row of rows) {
    const label = (row.display_name || row.name || `#${row.id}`).trim();
    const cot = playerCotisationAmount(row, defaultAmount);
    const balance = Number(row.balance || 0).toFixed(2);
    const customTag = row.cotisation_amount ? "" : " (defaut)";
    lines.push(`#${row.id} ${label} | Cot: ${cot} dh${customTag} | Solde: ${balance} dh`);
  }

  lines.push("");
  lines.push(`_${rows.length} joueur(s) actif(s)_`);
  return lines.join("\n");
}

function walletReminderMessage(player, balance) {
  const webappUrl = (process.env.WEBAPP_URL || "http://localhost:5000").replace(/\/$/, "");
  const name = player.display_name || player.name || `Joueur #${player.id}`;
  return [
    `Salut *${name}* !`,
    "",
    `⚠️ Ton wallet est à *${Number(balance).toFixed(2)} dh*.`,
    "Merci d'alimenter ton portefeuille pour les prochains matchs.",
    "",
    `🌐 Connexion : ${webappUrl}`,
    "Section *Wallet* pour voir ton solde."
  ].join("\n");
}

async function sendWalletReminders(client, playerIds) {
  const ids = [...new Set((playerIds || []).map((id) => Number(id)).filter(Boolean))];
  if (!ids.length) {
    return { sent: 0, failed: 0, errors: ["no_players"] };
  }

  const placeholders = ids.map(() => "?").join(",");
  const players = db
    .prepare(
      `
      SELECT p.id, p.name, p.display_name, p.phone, COALESCE(w.balance, 0) AS balance
      FROM players p
      LEFT JOIN wallets w ON w.player_id = p.id
      WHERE p.id IN (${placeholders}) AND p.active = 1
    `
    )
    .all(...ids);

  let sent = 0;
  let failed = 0;
  const errors = [];

  for (const player of players) {
    const chatId = normalizePhone(player.phone);
    if (!chatId) {
      failed += 1;
      errors.push(`#${player.id}: telephone invalide`);
      continue;
    }
    try {
      const text = walletReminderMessage(player, player.balance);
      await client.sendMessage(chatId, text);
      sent += 1;
      await new Promise((r) => setTimeout(r, 1200));
    } catch (error) {
      failed += 1;
      errors.push(`#${player.id}: ${error.message || "echec"}`);
    }
  }

  return { sent, failed, errors: errors.slice(0, 10) };
}

async function sendCotisationReport(client) {
  const groupId = await resolveGroupChatId(client);
  const message = buildCotisationReportMessage();
  await client.sendMessage(groupId, message);
  return { group_id: groupId, players_count: message.split("\n").length };
}

async function processFinanceTaskQueue(client) {
  const tasks = getPendingFinanceTasks();
  if (!tasks.length) return;

  const connected = await waitForConnected(client, 15000);
  if (!connected) return;

  const task = tasks[0];
  try {
    if (task.task_type === "wallet_reminder") {
      const payload = task.payload_json ? JSON.parse(task.payload_json) : {};
      const result = await sendWalletReminders(client, payload.player_ids || []);
      markTaskDone(task.id, result);
      console.log(`Rappels wallet (tache #${task.id}): ${result.sent} envoyes, ${result.failed} echecs`);
      return;
    }

    if (task.task_type === "cotisation_report") {
      const result = await sendCotisationReport(client);
      markTaskDone(task.id, { success: true, ...result });
      console.log(`Tableau cotisations publie (tache #${task.id})`);
    }
  } catch (error) {
    markTaskError(task.id, error.message || "finance_task_failed");
    console.error(`Echec tache finance #${task.id}:`, error.message);
  }
}

module.exports = {
  processFinanceTaskQueue,
  buildCotisationReportMessage
};
