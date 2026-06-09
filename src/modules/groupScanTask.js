const { db } = require("../db/database");
const { resolveGroupChatId } = require("./groups");
const { scanGroupForUnknownPlayers } = require("./groupScan");
const { waitForConnected } = require("./whatsapp");

function getPendingGroupScanTasks() {
  return db
    .prepare(
      `
      SELECT id
      FROM bot_tasks
      WHERE task_type = 'group_scan' AND status = 'pending'
      ORDER BY requested_at ASC, id ASC
    `
    )
    .all();
}

function markGroupScanDone(taskId, result) {
  db.prepare(
    `
    UPDATE bot_tasks
    SET status = 'done', completed_at = CURRENT_TIMESTAMP, result_json = ?
    WHERE id = ?
  `
  ).run(JSON.stringify(result), taskId);
}

function markGroupScanError(taskId, message) {
  db.prepare(
    `
    UPDATE bot_tasks
    SET status = 'error', completed_at = CURRENT_TIMESTAMP, result_json = ?
    WHERE id = ?
  `
  ).run(JSON.stringify({ error: message }), taskId);
}

async function processGroupScanQueue(client) {
  const tasks = getPendingGroupScanTasks();
  if (!tasks.length) return;

  const task = tasks[0];
  try {
    const connected = await waitForConnected(client, 15000);
    if (!connected) return;

    const groupId = await resolveGroupChatId(client);
    const result = await scanGroupForUnknownPlayers(client, groupId);
    markGroupScanDone(task.id, result);
    console.log(
      `Scan groupe termine (tache #${task.id}): ${result.unknown.length} nouveau(x) sur ${result.totalParticipants}`
    );
  } catch (error) {
    markGroupScanError(task.id, error.message || "scan_failed");
    console.error(`Echec scan groupe (tache #${task.id}):`, error.message);
  }
}

module.exports = {
  processGroupScanQueue
};
