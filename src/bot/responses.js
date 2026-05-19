function formatHelpMessage(botName = "FootBot") {
  return [
    `🤖 *${botName} - Aide*`,
    "",
    "📌 *Commandes joueurs*",
    "`!join TonPrenom` - Rejoindre l'equipe",
    "`!solde` - Voir ton wallet",
    "`!paye` - Payer la cotisation (10 dh)",
    "`!dispo oui` - Confirmer ta presence",
    "`!dispo non` - Signaler ton absence",
    "`!match` - Voir le prochain match",
    "`!lineup` - Voir la composition",
    "`!aide` - Afficher cette aide",
    "",
    "🛠️ *Commandes admin*",
    "`!crediter Prenom 50` - Crediter un joueur",
    "`!addplayer Prenom 212XXXXXXXXX` - Ajouter un joueur",
    "`!addmatch 2026-06-01 21:00 Terrain Municipal` - Ajouter un match",
    "`!stats` - Statistiques equipe",
    "`!broadcast Message...` - Diffusion au groupe",
    "",
    "💡 Exemple: `!dispo oui`"
  ].join("\n");
}

function formatWelcomeMessage(playerName) {
  return [
    `⚽ Bienvenue *${playerName}* dans l'equipe !`,
    "Tu peux commencer avec :",
    "`!aide` pour voir les commandes",
    "`!solde` pour verifier ton wallet"
  ].join("\n");
}

function formatWebappLink() {
  const webappUrl = process.env.WEBAPP_URL || "http://localhost:5000";
  return [
    "🌐 Consulte toutes les infos de l'equipe en ligne :",
    webappUrl,
    "",
    "📅 Calendrier des matchs",
    "📊 Historique & resultats",
    "💰 Ton wallet personnel"
  ].join("\n");
}

module.exports = {
  formatHelpMessage,
  formatWelcomeMessage,
  formatWebappLink,
  helpMessage: formatHelpMessage
};
