const { WAState } = require("whatsapp-web.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(error) {
  if (!error) return "erreur inconnue";
  if (typeof error === "string") return error;

  const parts = [
    error.message,
    error.reason,
    error.text,
    error.originalMessage,
    error.description
  ].filter((value) => value && String(value).length > 1);

  if (parts.length) {
    return parts.join(" | ");
  }

  try {
    const serialized = JSON.stringify(error, Object.getOwnPropertyNames(error));
    if (serialized && serialized !== "{}") {
      return serialized.slice(0, 500);
    }
  } catch {
    // ignore
  }

  return String(error);
}

async function waitForConnected(client, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const state = await client.getState();
      if (state === WAState.CONNECTED && client.info) {
        return true;
      }
    } catch {
      // WhatsApp Web charge encore
    }
    await sleep(1500);
  }
  return false;
}

async function prepareChat(client, chatId) {
  if (!client.interface?.openChatWindow) return;
  await client.interface.openChatWindow(chatId);
  await sleep(1500);
}

module.exports = {
  sleep,
  formatError,
  waitForConnected,
  prepareChat
};
