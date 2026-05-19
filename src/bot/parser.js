const { detectIntent } = require("../llm/ollama");

async function parseIntent(text = "", phone = "") {
  const raw = text || "";
  const normalized = raw.toLowerCase().trim();

  const rules = [
    {
      regex: /^!?solde$|mon solde|wallet/i,
      intent: "wallet_balance"
    },
    {
      regex: /^!paye$|j'?ai payé|paid/i,
      intent: "cotisation_pay"
    },
    {
      regex: /^!dispo\s+oui|je (suis |)dispo|je viens|présent/i,
      intent: "availability_yes"
    },
    {
      regex: /^!dispo\s+non|je (peux|peut) pas|absent|pas là/i,
      intent: "availability_no"
    },
    {
      regex: /^!lineup$/i,
      intent: "lineup_show"
    },
    {
      regex: /^!match$|prochain match|y'?a match/i,
      intent: "match_info"
    },
    {
      regex: /^!aide$|aide|help|commandes/i,
      intent: "help"
    },
    {
      regex: /^!crediter\s+(\w+)\s+(\d+)/i,
      intent: "admin_credit",
      valueFromMatch: (match) => ({
        name: match[1],
        amount: Number(match[2])
      })
    },
    {
      regex: /^!addmatch\s+(.+)/i,
      intent: "admin_add_match",
      valueFromMatch: (match) => ({
        payload: match[1]
      })
    },
    {
      regex: /^!addplayer\s+(\w+)\s+([\d]+)/i,
      intent: "admin_add_player",
      valueFromMatch: (match) => ({
        name: match[1],
        phone: `${match[2]}@c.us`
      })
    },
    {
      regex: /^!stats$/i,
      intent: "admin_stats"
    },
    {
      regex: /^!broadcast\s+(.+)/i,
      intent: "admin_broadcast",
      valueFromMatch: (match) => ({
        message: match[1]
      })
    },
    {
      regex: /^!join\s+(\w+)/i,
      intent: "player_join",
      valueFromMatch: (match) => ({
        name: match[1]
      })
    }
  ];

  for (const rule of rules) {
    const match = normalized.match(rule.regex);
    if (!match) continue;

    return {
      intent: rule.intent,
      value: rule.valueFromMatch ? rule.valueFromMatch(match, phone) : null,
      confidence: 0.98,
      raw
    };
  }

  const llmResult = await detectIntent(raw, phone);
  return {
    intent: llmResult?.intent || "unknown",
    value: llmResult?.value || null,
    confidence: llmResult?.confidence || 0.4,
    raw
  };
}

module.exports = {
  parseIntent
};
