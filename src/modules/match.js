const { db } = require("../db/database");

function createMatch(date, time, location = "Terrain habituel") {
  const result = db
    .prepare("INSERT INTO matches (date, time, location, status) VALUES (?, ?, ?, 'scheduled')")
    .run(date, time, location || "Terrain habituel");

  return db.prepare("SELECT * FROM matches WHERE id = ?").get(result.lastInsertRowid);
}

function getCurrentMatch() {
  return db
    .prepare(
      `
      SELECT *
      FROM matches
      WHERE status IN ('scheduled', 'training')
      ORDER BY date ASC, time ASC
      LIMIT 1
    `
    )
    .get();
}

function setAvailability(playerId, matchId, status) {
  if (!["yes", "no", "maybe", "pending"].includes(status)) {
    throw new Error("Statut de disponibilite invalide.");
  }

  db.prepare(
    `
    INSERT INTO availabilities (player_id, match_id, status, responded_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(player_id, match_id)
    DO UPDATE SET status = excluded.status, responded_at = CURRENT_TIMESTAMP
  `
  ).run(playerId, matchId, status);
}

function getAvailabilitySummary(matchId) {
  const rows = db
    .prepare(
      `
      SELECT
        p.id,
        p.name,
        COALESCE(a.status, 'pending') AS status
      FROM players p
      LEFT JOIN availabilities a
        ON a.player_id = p.id
       AND a.match_id = ?
      WHERE p.active = 1
      ORDER BY p.name ASC
    `
    )
    .all(matchId);

  const summary = {
    yes: [],
    no: [],
    maybe: [],
    pending: []
  };

  for (const row of rows) {
    if (row.status === "yes") summary.yes.push(row.name);
    else if (row.status === "no") summary.no.push(row.name);
    else if (row.status === "maybe") summary.maybe.push(row.name);
    else summary.pending.push(row.name);
  }

  return summary;
}

function formatMatchMessage(match, summary) {
  if (!match) return "⚽ Aucun evenement programme pour le moment.";

  const isTraining = match.event_kind !== "match";
  const header = isTraining
    ? `🏃 *Prochain entrainement* (${match.format || "5v5"})`
    : `⚽ *Prochain match* vs ${match.opponent || "?"}`;

  const lines = [
    header,
    `🆔 #${match.id}`,
    `📅 ${match.date} a ${match.time}`,
    `📍 ${match.location}`,
    ""
  ];

  if (match.maps_url) {
    lines.push(`🗺 ${match.maps_url}`, "");
  }

  lines.push(
    `✅ Dispos (${summary.yes.length}): ${summary.yes.join(", ") || "-"}`,
    `❌ Absents (${summary.no.length}): ${summary.no.join(", ") || "-"}`,
    `🤔 Peut-etre (${summary.maybe.length}): ${summary.maybe.join(", ") || "-"}`,
    `⏳ En attente (${summary.pending.length}): ${summary.pending.join(", ") || "-"}`
  );

  return lines.join("\n");
}

function formatAvailabilityConfirmation(playerName, status, yesCount, totalCount) {
  const label = status === "yes" ? "✅ DISPO" : status === "no" ? "❌ ABSENT" : "⏳ EN ATTENTE";
  return `👤 ${playerName}: ${label}\n📊 ${yesCount}/${totalCount} joueurs disponibles`;
}

module.exports = {
  createMatch,
  getCurrentMatch,
  setAvailability,
  getAvailabilitySummary,
  formatMatchMessage,
  formatAvailabilityConfirmation
};
