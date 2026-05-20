const { db } = require("../db/database");
const { EMOJI_COLORS } = require("./lineup");
const { waitForConnected, prepareChat, formatError, sleep } = require("./whatsapp");

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
      SET lineup_notified_at = CURRENT_TIMESTAMP
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

  const connected = await waitForConnected(client);
  if (!connected) {
    throw new Error("WhatsApp pas encore connecte");
  }

  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId);
  if (!match) {
    throw new Error(`Match #${matchId} introuvable.`);
  }

  if (match.lineup_notified_at && !force) {
    db.prepare(
      "UPDATE matches SET lineup_notify_requested_at = NULL WHERE id = ?"
    ).run(matchId);
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "already_notified" };
  }

  if (!claimLineupNotifyJob(matchId) && !force) {
    return { sent: 0, failed: 0, matchId, skipped: true, reason: "not_queued" };
  }

  const lineup = getLineupForMatch(matchId);
  if (!lineup) {
    throw new Error("Aucune composition pour ce match. Generez-la d'abord.");
  }

  const players = db
    .prepare("SELECT id, name, phone FROM players WHERE active = 1")
    .all();

  const byId = new Map(players.map((p) => [p.id, p]));
  let sent = 0;
  let failed = 0;

  const seen = new Set();
  const assignments = [
    ...lineup.teamAIds.map((id) => ({ id, color: lineup.colorA })),
    ...lineup.teamBIds.map((id) => ({ id, color: lineup.colorB }))
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  for (const item of assignments) {
    const player = byId.get(item.id);
    if (!player?.phone) {
      failed += 1;
      continue;
    }

    try {
      const body = formatPrivateMatchInfo(player.name, match, item.color);
      await client.sendMessage(player.phone, body);
      sent += 1;
      await sleep(900);
    } catch (error) {
      console.error(`Echec MP lineup pour ${player.name}:`, formatError(error));
      failed += 1;
    }
  }

  markLineupNotified(matchId);
  return { sent, failed, matchId };
}

function processPendingLineupNotifications() {
  return db
    .prepare(
      `
      SELECT id
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
  notifyLineupPlayers,
  processPendingLineupNotifications
};
