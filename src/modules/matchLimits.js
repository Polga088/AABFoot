const { db } = require("../db/database");
const { formatMaxPlayers } = require("../utils/matchFormat");

function countYesVotes(matchId, excludePlayerId = null) {
  const row = db
    .prepare(
      `
      SELECT COUNT(*) AS count
      FROM availabilities a
      JOIN players p ON p.id = a.player_id
      WHERE a.match_id = ?
        AND a.status = 'yes'
        AND p.active = 1
        AND (? IS NULL OR a.player_id != ?)
    `
    )
    .get(matchId, excludePlayerId, excludePlayerId);

  return Number(row?.count || 0);
}

function canAcceptYesVote(match, playerId) {
  const max = formatMaxPlayers(match.format);
  if (!max) {
    return { allowed: true, max: null, current: countYesVotes(match.id, playerId) };
  }

  const current = countYesVotes(match.id, playerId);
  return {
    allowed: current < max,
    max,
    current
  };
}

module.exports = {
  formatMaxPlayers,
  countYesVotes,
  canAcceptYesVote
};
