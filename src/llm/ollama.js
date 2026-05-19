const axios = require("axios");

const ollamaClient = axios.create({
  baseURL: process.env.OLLAMA_URL || "http://localhost:11434",
  timeout: 10000
});

async function askOllama(prompt) {
  const model = process.env.OLLAMA_MODEL || "llama3.2";
  const { data } = await ollamaClient.post("/api/generate", {
    model,
    prompt,
    stream: false
  });

  return data?.response || "Aucune reponse d'Ollama.";
}

function sanitizeJsonResponse(raw) {
  const cleaned = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    return cleaned.slice(first, last + 1);
  }

  return cleaned;
}

async function detectIntent(message) {
  try {
    const model = process.env.OLLAMA_MODEL || "llama3.2";
    const prompt = `[SYSTEM] Tu gères un bot WhatsApp pour une équipe de football amateur marocaine.
Les joueurs écrivent en français, darija ou mélange des deux.
Analyse le message et réponds UNIQUEMENT avec un objet JSON valide, sans texte autour.
Format : {"intent":"...","value":null,"confidence":0.0}

Intents: wallet_balance, availability_yes, availability_no, 
match_info, lineup_show, help, unknown

[USER] ${message}`;

    const { data } = await ollamaClient.post("/api/generate", {
      model,
      stream: false,
      prompt
    });

    const raw = data?.response || "";
    const parsed = JSON.parse(sanitizeJsonResponse(raw));

    return {
      intent: parsed.intent || "unknown",
      value: parsed.value || null,
      confidence: Number(parsed.confidence || 0)
    };
  } catch {
    return {
      intent: "unknown",
      value: null,
      confidence: 0
    };
  }
}

module.exports = {
  askOllama,
  detectIntent
};
