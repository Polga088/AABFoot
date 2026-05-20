function formatMaxPlayers(format) {
  const value = String(format || "").trim().toLowerCase();
  const match = value.match(/^(\d+)v(\d+)$/);
  if (!match) return null;
  return Number(match[1]) + Number(match[2]);
}

module.exports = {
  formatMaxPlayers
};
