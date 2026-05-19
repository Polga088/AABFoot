const { db } = require("../db/database");

const EMOJI_COLORS = {
  Rouge: "🔴",
  Vert: "🟢",
  Bleu: "🔵",
  Jaune: "🟡",
  Orange: "🟠",
  Noir: "⚫",
  Blanc: "⚪"
};

function fisherYatesShuffle(items) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function rolesTemplate(size) {
  if (size >= 5) return ["GK", "DEF", "DEF", "MID", "ATT"];
  if (size === 4) return ["GK", "DEF", "MID", "ATT"];
  if (size === 3) return ["GK", "DEF", "ATT"];
  if (size === 2) return ["DEF", "ATT"];
  return ["ATT"];
}

function withRoles(players) {
  const template = rolesTemplate(players.length);
  return players.map((player, index) => ({
    ...player,
    role: template[index] || "SUB"
  }));
}

function saveLineup(matchId, teamAIds, teamBIds, colorA, colorB) {
  const existing = db.prepare("SELECT id FROM lineups WHERE match_id = ?").get(matchId);
  if (existing) {
    db.prepare(
      "UPDATE lineups SET team_a = ?, team_b = ?, color_a = ?, color_b = ? WHERE match_id = ?"
    ).run(JSON.stringify(teamAIds), JSON.stringify(teamBIds), colorA, colorB, matchId);
    return existing.id;
  }

  const result = db
    .prepare("INSERT INTO lineups (match_id, team_a, team_b, color_a, color_b) VALUES (?, ?, ?, ?, ?)")
    .run(matchId, JSON.stringify(teamAIds), JSON.stringify(teamBIds), colorA, colorB);
  return result.lastInsertRowid;
}

function generateLineup(matchId, colorA = "Rouge", colorB = "Vert") {
  const availablePlayers = db
    .prepare(
      `
      SELECT p.id, p.name
      FROM availabilities a
      JOIN players p ON p.id = a.player_id
      WHERE a.match_id = ?
        AND a.status = 'yes'
        AND p.active = 1
      ORDER BY p.name ASC
    `
    )
    .all(matchId);

  if (!availablePlayers.length) {
    throw new Error("Aucun joueur disponible pour générer une composition.");
  }

  const shuffled = fisherYatesShuffle(availablePlayers);
  const splitIndex = Math.ceil(shuffled.length / 2);
  const rawTeamA = shuffled.slice(0, splitIndex);
  const rawTeamB = shuffled.slice(splitIndex);

  const teamA = withRoles(rawTeamA);
  const teamB = withRoles(rawTeamB);

  const teamAIds = teamA.map((p) => p.id);
  const teamBIds = teamB.map((p) => p.id);
  const lineupId = saveLineup(matchId, teamAIds, teamBIds, colorA, colorB);

  return {
    id: lineupId,
    matchId,
    colorA,
    colorB,
    teamA,
    teamB,
    createdAt: new Date().toISOString()
  };
}

function formatLineupMessage(lineup, match) {
  const colorAEmoji = EMOJI_COLORS[lineup.colorA] || "🎽";
  const colorBEmoji = EMOJI_COLORS[lineup.colorB] || "🎽";

  const renderTeam = (players) =>
    players.length
      ? players.map((p) => `- ${p.role} : ${p.name}`).join("\n")
      : "- Aucun joueur";

  return [
    "🧠 *Composition générée*",
    `⚽ Match #${match.id} - ${match.date} ${match.time}`,
    `📍 ${match.location}`,
    "",
    `${colorAEmoji} *Equipe ${lineup.colorA}*`,
    renderTeam(lineup.teamA),
    "",
    `${colorBEmoji} *Equipe ${lineup.colorB}*`,
    renderTeam(lineup.teamB)
  ].join("\n");
}

module.exports = {
  EMOJI_COLORS,
  generateLineup,
  formatLineupMessage
};
