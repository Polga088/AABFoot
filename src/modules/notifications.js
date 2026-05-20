const { db } = require("../db/database");
const { EMOJI_COLORS } = require("./lineup");
const { normalizePhone } = require("../utils/phone");
const { waitForConnected, formatError, sleep } = require("./whatsapp");

function getLineupForMatch(matchId) {
  const lineup = db
    .prepare(
      `
      SELECT team_a, team_b, color_a, color_b
      FROM lineups
      WHERE match_id = ?
      ORDER BY id DESC
      LIMIT 1
    `
    )
    .get(matchId);

  if (!lineup) return null;

  return {
    teamAIds: JSON.parse(lineup.team_a || "[]"),
    teamBIds: JSON.parse(lineup.team_b || "[]"),
    colorA: lineup.color_a,
    colorB: lineup.color_b
  };
}

function clearLineupNotifyQueue(matchId) {
  db.prepare(
    `
      UPDATE matches
      SET lineup_notify_requested_at = NULL,
          lineup_notify_force = 0
      WHERE id = ?
    `
  ).run(matchId);
}

function claimLineupNotifyJob(matchId) {
  const result = db
    .prepare(
      `
      UPDATE matches
      SET lineup_notify_requested_at = NULL
      WHERE id = ?
        AND lineup_notify_requested_at IS NOT NULL
    `
    )
    .run(matchId);

  return result.changes > 0;
}

function markLineupNotified(matchId) {
  db.prepare(
    `
      UPDATE matches
      SET lineup_notified_at = CURRENT_TIMESTAMP,
          lineup_notify_force = 0
      WHERE id = ?
    `
  ).run(matchId);
}

function formatPrivateMatchInfo(playerName, match, vestColor) {
  const emoji = EMOJI_COLORS[vestColor] || "🎽";
  const isMatch = match.event_kind === "match";
  const title = isMatch
    ? `⚽ Match vs ${match.opponent || "adversaire"}`
    : `🏃 Entraînement ${match.format || "5v5"}`;

  const lines = [
    `Salut *${playerName}* !`,
    "",
    title,
    `📅 ${match.date} à ${match.time}`,
    `📍 ${match.location}`,
    `${emoji} Gilet *${vestColor}*`
  ];

  if (match.maps_url) {
    lines.push(`🗺 Carte: ${match.maps_url}`);
  }
  if (match.notes) {
    lines.push(`📝 ${match.notes}`);
  }

  return lines.join("\n");
}

async function notifyLineupPlayers(client, matchId, options = {}) {
  const force = Boolean(options.force);

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) {
    clearLineupNotifyQueue(matchId);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "match_not_found" };
  }

  const lineup = getLineupForMatch(matchId);
  if (!lineup) {
    clearLineupNotifyQueue(matchId);
    console.error(`MP lineup #${matchId}: aucune composition`);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "no_lineup" };
  }

  const seen = new Set();
  const assignments = [
    ...lineup.teamAIds.map((id) => ({ id, color: lineup.colorA })),
    ...lineup.teamBIds.map((id) => ({ id, color: lineup.colorB }))
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  if (!assignments.length) {
    clearLineupNotifyQueue(matchId);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "empty_lineup" };
  }

  if (match.lineup_notified_at && !force) {
    clearLineupNotifyQueue(matchId);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "already_notified" };
  }

  const connected = await waitForConnected(client, 20000);
  if (!connected) {
    console.warn(`MP lineup #${matchId}: WhatsApp non connecte, nouvel essai dans ~20s`);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "not_connected", retry: true };
  }

  if (force) {
    db.prepare("UPDATE matches SET lineup_notified_at = NULL WHERE id = ?").run(matchId);
  }

  const claimed = claimLineupNotifyJob(matchId);
  if (!claimed && !force) {
    const pending = db
      .prepare("SELECT lineup_notify_requested_at FROM matches WHERE id = ?")
      .get(matchId);
    if (!pending?.lineup_notify_requested_at) {
      return { sent: 0, failed: 0, matchId, skipped: true, reason: "not_queued" };
    }
  }

  if (force && !claimed) {
    claimLineupNotifyJob(matchId);
  }

  const players = db
    .prepare("SELECT id, name, phone FROM players WHERE active = 1")
    .all();

  const byId = new Map(players.map((p) => [p.id, p]));
  let sent = 0;
  let failed = 0;

  for (const item of assignments) {
    const player = byId.get(item.id);
    if (!player?.phone) {
      failed += 1;
      continue;
    }

    const chatId = normalizePhone(player.phone);
    if (!chatId) {
      failed += 1;
      continue;
    }

    try {
      const body = formatPrivateMatchInfo(player.name, match, item.color);
      await client.sendMessage(chatId, body);
      sent += 1;
      await sleep(900);
    } catch (error) {
      console.error(`Echec MP lineup pour ${player.name} (${chatId}):`, formatError(error));
      failed += 1;
    }
  }

  if (sent > 0) {
    markLineupNotified(matchId);
    console.log(`MP lineup #${matchId}: ${sent} envoyes, ${failed} echecs`);
    return { sent, failed, matchId };
  }

  clearLineupNotifyQueue(matchId);
  console.error(
    `MP lineup #${matchId}: aucun message envoye (${failed} echecs). File annulee.`
  );
  return { sent: 0, failed, matchId, skipped: true, reason: "all_failed" };
}

function processPendingLineupNotifications() {
  return db
    .prepare(
      `
      SELECT id, lineup_notify_force
      FROM matches
      WHERE lineup_notify_requested_at IS NOT NULL
      ORDER BY lineup_notify_requested_at ASC
      LIMIT 3
    `
    )
    .all();
}

module.exports = {
  formatPrivateMatchInfo,
  claimLineupNotifyJob,
  clearLineupNotifyQueue,
  notifyLineupPlayers,
  processPendingLineupNotifications
};
