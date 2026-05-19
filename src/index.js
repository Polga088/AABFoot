require("dotenv").config();

const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");
const { initDatabase } = require("./db/database");
const { handleMessage } = require("./bot/handler");
const { handlePollVote } = require("./modules/poll");
const { startBackgroundJobs } = require("./jobs/queue");
const { startScheduler } = require("./scheduler/cron");
const { warnIfInvalidGroupId, logGroupDirectory } = require("./modules/groups");

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  }
});

function registerClientEvents() {
  client.on("qr", (qr) => qrcode.generate(qr, { small: true }));

  client.on("loading_screen", (percent) => {
    if (percent === 100) {
      console.log("WhatsApp Web charge a 100%");
    }
  });

  client.on("ready", async () => {
    console.log("✅ FootBot connecté !");
    warnIfInvalidGroupId();
    await logGroupDirectory(client);
    await new Promise((resolve) => setTimeout(resolve, 8000));
    startBackgroundJobs(client);
  });

  client.on("vote_update", async (vote) => {
    try {
      await handlePollVote(client, vote);
    } catch (error) {
      console.error("Erreur traitement vote sondage:", error);
    }
  });

  client.on("message", async (msg) => {
    try {
      if (msg.fromMe) return;
      if (msg.from === "status@broadcast") return;

      await handleMessage(client, msg);
    } catch (error) {
      console.error("Erreur pendant le traitement du message:", error);
    }
  });

  client.on("disconnected", (reason) => {
    console.log("❌ Déconnecté:", reason);

    setTimeout(async () => {
      try {
        await client.initialize();
      } catch (error) {
        console.error("Erreur lors de la reconnexion:", error);
      }
    }, 5000);
  });
}

let isShuttingDown = false;

async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\nArret du bot (${signal})...`);

  try {
    await client.destroy();
  } catch (error) {
    console.error("Erreur a l'arret du client:", error.message);
  }

  process.exit(0);
}

async function bootstrap() {
  try {
    initDatabase();
    registerClientEvents();
    startScheduler(client);
    await client.initialize();
  } catch (error) {
    const message = String(error?.message || error);
    console.error("Erreur critique au demarrage du bot:", error);

    if (message.includes("browser is already running")) {
      console.error("");
      console.error("→ Une ancienne session Chrome est encore ouverte.");
      console.error("→ Lancez:  bash scripts/stop-bot.sh");
      console.error("→ Puis:    npm run dev");
    }
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

bootstrap();

module.exports = {
  client
};
