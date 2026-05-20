const { sendMatchPoll, processPendingPollRequests } = require("../modules/poll");
const {
  deletePollMessage,
  republishPoll,
  processPendingPollAdminRequests
} = require("../modules/pollAdmin");
const {
  notifyLineupPlayers,
  processPendingLineupNotifications
} = require("../modules/notifications");
const { waitForConnected } = require("../modules/whatsapp");
const { formatError } = require("../modules/whatsapp");

const POLL_RETRY_MS = 60000;
const pollRetryAfter = new Map();
const lineupNotifyInFlight = new Set();
let pollInFlight = false;
let jobsStarted = false;

async function processPollQueue(client) {
  if (pollInFlight) return;

  const jobs = processPendingPollRequests();
  if (!jobs.length) return;

  const job = jobs[0];
  const retryAt = pollRetryAfter.get(job.id) || 0;
  if (Date.now() < retryAt) return;

  pollInFlight = true;
  try {
    const connected = await waitForConnected(client, 15000);
    if (!connected) {
      pollRetryAfter.set(job.id, Date.now() + POLL_RETRY_MS);
      return;
    }

    await sendMatchPoll(client, job.id);
    pollRetryAfter.delete(job.id);
    console.log(`Sondage WhatsApp envoye pour le match #${job.id}`);
  } catch (error) {
    pollRetryAfter.set(job.id, Date.now() + POLL_RETRY_MS);
    console.error(`Echec envoi sondage match #${job.id}:`, formatError(error));
  } finally {
    pollInFlight = false;
  }
}

async function processPollAdminQueue(client) {
  const jobs = processPendingPollAdminRequests();
  if (!jobs.length) return;

  const job = jobs[0];
  try {
    const connected = await waitForConnected(client, 15000);
    if (!connected) return;

    if (job.poll_delete_requested_at) {
      await deletePollMessage(client, job.id);
      console.log(`Sondage supprime pour le match #${job.id}`);
    } else if (job.poll_republish_requested_at) {
      await republishPoll(client, job.id);
      console.log(`Sondage republie pour le match #${job.id}`);
    }
  } catch (error) {
    console.error(`Echec action sondage match #${job.id}:`, formatError(error));
  }
}

async function processLineupQueue(client) {
  const jobs = processPendingLineupNotifications();
  for (const job of jobs) {
    if (lineupNotifyInFlight.has(job.id)) continue;

    lineupNotifyInFlight.add(job.id);
    try {
      const result = await notifyLineupPlayers(client, job.id);
      if (result.skipped) {
        console.log(`Notification lineup #${job.id} ignoree (${result.reason})`);
        continue;
      }
      console.log(
        `Infos lineup envoyees (match #${job.id}): ${result.sent} MP, ${result.failed} echecs`
      );
    } catch (error) {
      console.error(`Echec notification lineup match #${job.id}:`, formatError(error));
    } finally {
      lineupNotifyInFlight.delete(job.id);
    }
  }
}

function startBackgroundJobs(client) {
  if (jobsStarted) return;
  jobsStarted = true;

  const tick = async () => {
    if (!client.info) return;
    await processPollQueue(client);
    await processPollAdminQueue(client);
    await processLineupQueue(client);
  };

  setInterval(tick, 20000);
  setTimeout(tick, 12000);
}

module.exports = {
  startBackgroundJobs
};
