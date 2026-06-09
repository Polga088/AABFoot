const { parseIntent } = require("./parser");
const { helpMessage } = require("./responses");
const { askOllama } = require("../llm/ollama");
const { db } = require("../db/database");
const { applyMatchVote, getCotisationAmount } = require("../modules/matchCotisation");
const { canAcceptYesVote } = require("../modules/matchLimits");
const { findPlayerByPhone } = require("../modules/players");
const { normalizePhone, isWhatsAppInternalId } = require("../utils/phone");

function isAdmin(player, phone) {
  return Boolean(player && (player.role === "admin" || phone === process.env.ADMIN_PHONE));
}

function isAdminSender(msg, player) {
  const adminPhone = (process.env.ADMIN_PHONE || "").trim();
  const sender = (msg.author || msg.from || "").trim();
  if (adminPhone && sender === adminPhone) return true;
  return isAdmin(player, sender);
}

function upsertAvailability(playerId, matchId, status) {
  db.prepare(
    `
      INSERT INTO availabilities (player_id, match_id, status, responded_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(player_id, match_id)
      DO UPDATE SET
        status = excluded.status,
        responded_at = CURRENT_TIMESTAMP
    `
  ).run(playerId, matchId, status);
}

function getUpcomingMatch() {
  return db
    .prepare(
      `
      SELECT id, date, time, location, status, format, event_kind, opponent
      FROM matches
      WHERE status IN ('scheduled', 'training')
      ORDER BY date ASC, time ASC
      LIMIT 1
    `
    )
    .get();
}

function formatLineupTeam(ids) {
  if (!Array.isArray(ids) || !ids.length) return "Aucun joueur";
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT id, name FROM players WHERE id IN (${placeholders})`).all(...ids);
  const byId = new Map(rows.map((row) => [row.id, row.name]));
  return ids.map((id) => byId.get(id) || `Joueur#${id}`).join(", ");
}

async function handleMessage(client, msg) {
  try {
    const text = (msg.body || "").trim();
    const from = msg.from;
    const chat = msg.to;

    if (!text) return;

    if (/^!groupid$/i.test(text)) {
      const chat = await msg.getChat();
      const chatId = chat.id?._serialized || msg.from;
      const chatName = chat.name || "Chat";
      const isGroup = chatId.endsWith("@g.us");

      const senderPhone = msg.author || from;
      const senderPlayer = db.prepare("SELECT * FROM players WHERE phone = ?").get(senderPhone);
      if (!isAdminSender(msg, senderPlayer)) {
        await msg.reply("Commande reservee a l'admin.");
        return;
      }

      await msg.reply(
        [
          `📋 *${chatName}*`,
          `ID: \`${chatId}\``,
          isGroup
            ? "✅ C'est un groupe — copiez cet ID dans .env :"
            : "⚠️ Ce n'est pas un groupe (@g.us). Ouvrez le groupe equipe et retapez !groupid",
          "",
          `GROUP_ID=${chatId}`
        ].join("\n")
      );
      console.log(`!groupid → ${chatName}: ${chatId}`);
      return;
    }

    // Filtre groupe : répond seulement aux commandes ! ou mentions
    const isGroup = from.endsWith('@g.us');
    if (isGroup) {
      const isCommand = text.startsWith('!');
      const isMentioned = msg.mentionedIds?.includes(client.info.wid._serialized);
      if (!isCommand && !isMentioned) return;
    }

    const senderId = (msg.author || from || "").trim();
    let player = findPlayerByPhone(senderId);

    if (!player) {
      const joinMatch = text.match(/^!join\s+(\w+)/i);
      if (joinMatch) {
        const name = joinMatch[1];
        const phone = normalizePhone(senderId);
        if (!phone || isWhatsAppInternalId(senderId)) {
          await msg.reply(
            "⚠️ Numero WhatsApp non reconnu. Demandez a l'admin de vous ajouter sur la webapp (/joueurs) avec votre 06… ou 212…"
          );
          return;
        }
        const tx = db.transaction(() => {
          const result = db
            .prepare("INSERT INTO players (name, phone, role, active) VALUES (?, ?, 'player', 1)")
            .run(name, phone);
          db.prepare("INSERT INTO wallets (player_id, balance) VALUES (?, 0)").run(result.lastInsertRowid);
        });
        tx();

        await msg.reply(`✅ Bienvenue ${name} ! Tu as rejoint l'équipe.`);
        return;
      }

      await msg.reply("⚽ Salut ! Demandez a l'admin de vous ajouter sur la webapp, ou tape *!join TonPrenom* (06/212 requis).");
      return;
    }

    const parsed = await parseIntent(text, from);
    const { intent, value, confidence, raw } = parsed;
    let response = "";

    switch (intent) {
      case "wallet_balance": {
        const wallet = db.prepare("SELECT balance FROM wallets WHERE player_id = ?").get(player.id);
        const balance = Number(wallet?.balance || 0);
        response = `Ton solde actuel est de ${balance.toFixed(2)} MAD.`;
        break;
      }

      case "cotisation_pay": {
        const amount = getCotisationAmount(player.id);
        const tx = db.transaction(() => {
          db.prepare(
            "INSERT INTO transactions (player_id, amount, type, description) VALUES (?, ?, 'cotisation', ?)"
          ).run(player.id, -Math.abs(amount), "Paiement cotisation");
          db.prepare(
            "UPDATE wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?"
          ).run(Math.abs(amount), player.id);
        });
        tx();
        response = `✅ Cotisation enregistrée: ${amount.toFixed(2)} MAD.`;
        break;
      }

      case "availability_yes":
      case "availability_no": {
        const upcoming = getUpcomingMatch();
        if (!upcoming) {
          response = "Aucun match planifié pour le moment.";
          break;
        }
        const status = intent === "availability_yes" ? "yes" : "no";
        if (status === "yes") {
          const capacity = canAcceptYesVote(upcoming, player.id);
          if (!capacity.allowed) {
            response = `Complet (${capacity.current}/${capacity.max} pour ${upcoming.format}). Vote refuse.`;
            break;
          }
        }
        const billing = applyMatchVote(player.id, upcoming.id, status);
        let billingNote = "";
        if (billing.action === "debited") {
          billingNote = ` Cotisation: -${billing.amount} dh.`;
        } else if (billing.action === "refunded") {
          billingNote = ` Remboursement: +${billing.amount} dh.`;
        } else if (billing.action === "debit_failed") {
          billingNote = " Solde insuffisant pour la cotisation.";
        }
        response = `Noté: disponibilité "${status}" pour le match #${upcoming.id} (${upcoming.date} ${upcoming.time}).${billingNote}`;
        break;
      }

      case "lineup_show": {
        const lineup = db
          .prepare("SELECT match_id, team_a, team_b, color_a, color_b FROM lineups ORDER BY id DESC LIMIT 1")
          .get();
        if (!lineup) {
          response = "Aucune composition disponible.";
          break;
        }

        const teamAIds = JSON.parse(lineup.team_a || "[]");
        const teamBIds = JSON.parse(lineup.team_b || "[]");
        response = [
          `Composition du match #${lineup.match_id}:`,
          `${lineup.color_a}: ${formatLineupTeam(teamAIds)}`,
          `${lineup.color_b}: ${formatLineupTeam(teamBIds)}`
        ].join("\n");
        break;
      }

      case "match_info": {
        const upcoming = getUpcomingMatch();
        response = upcoming
          ? `Prochain match: #${upcoming.id} le ${upcoming.date} à ${upcoming.time} (${upcoming.location})`
          : "Aucun match planifié.";
        break;
      }

      case "help": {
        response = helpMessage(process.env.BOT_NAME || "FootBot");
        break;
      }

      case "admin_credit": {
        if (!isAdmin(player, from)) {
          response = "Commande réservée à l'admin.";
          break;
        }

        const amount = Number(value?.amount || 0);
        if (!value?.name || amount <= 0) {
          response = "Usage: !crediter Prenom 50";
          break;
        }

        const target = db
          .prepare("SELECT id, name FROM players WHERE LOWER(name) = LOWER(?) LIMIT 1")
          .get(value.name);
        if (!target) {
          response = `Joueur introuvable: ${value.name}`;
          break;
        }

        const tx = db.transaction(() => {
          db.prepare(
            "INSERT INTO transactions (player_id, amount, type, description) VALUES (?, ?, 'credit', ?)"
          ).run(target.id, amount, `Crédit admin par ${player.name}`);
          db.prepare(
            "UPDATE wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE player_id = ?"
          ).run(amount, target.id);
        });
        tx();

        response = `✅ ${amount.toFixed(2)} MAD crédités à ${target.name}.`;
        break;
      }

      case "admin_add_match": {
        if (!isAdmin(player, from)) {
          response = "Commande réservée à l'admin.";
          break;
        }

        const payload = value?.payload || "";
        const parts = payload.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})(?:\s+(.+))?$/);
        if (!parts) {
          response = "Usage: !addmatch YYYY-MM-DD HH:MM [lieu]";
          break;
        }

        const date = parts[1];
        const time = parts[2];
        const location = parts[3] || "Terrain habituel";
        const result = db
          .prepare("INSERT INTO matches (date, time, location, status) VALUES (?, ?, ?, 'scheduled')")
          .run(date, time, location);

        response = `✅ Match ajouté (#${result.lastInsertRowid}) le ${date} à ${time} (${location}).`;
        break;
      }

      case "admin_add_player": {
        if (!isAdmin(player, from)) {
          response = "Commande réservée à l'admin.";
          break;
        }

        if (!value?.name || !value?.phone) {
          response = "Usage: !addplayer Prenom 212XXXXXXXXX";
          break;
        }

        const phone = normalizePhone(value.phone);
        if (!phone || isWhatsAppInternalId(value.phone)) {
          response = "Numero invalide (LID refuse). Utilisez 06… ou 212…";
          break;
        }

        const exists = findPlayerByPhone(phone);
        if (exists) {
          response = "Ce joueur existe déjà.";
          break;
        }

        const tx = db.transaction(() => {
          const result = db
            .prepare("INSERT INTO players (name, phone, role, active) VALUES (?, ?, 'player', 1)")
            .run(value.name, phone);
          db.prepare("INSERT INTO wallets (player_id, balance) VALUES (?, 0)").run(result.lastInsertRowid);
        });
        tx();

        response = `✅ Joueur ajouté: ${value.name} (${value.phone}).`;
        break;
      }

      case "admin_stats": {
        if (!isAdmin(player, from)) {
          response = "Commande réservée à l'admin.";
          break;
        }

        const playersCount = db.prepare("SELECT COUNT(*) AS count FROM players WHERE active = 1").get().count;
        const totalBalance = db.prepare("SELECT COALESCE(SUM(balance), 0) AS total FROM wallets").get().total;
        const txCount = db.prepare("SELECT COUNT(*) AS count FROM transactions").get().count;

        response = [
          "📊 Stats équipe:",
          `Joueurs actifs: ${playersCount}`,
          `Total soldes: ${Number(totalBalance).toFixed(2)} MAD`,
          `Transactions: ${txCount}`
        ].join("\n");
        break;
      }

      case "admin_broadcast": {
        if (!isAdmin(player, from)) {
          response = "Commande réservée à l'admin.";
          break;
        }

        const message = value?.message?.trim();
        if (!message) {
          response = "Usage: !broadcast votre message";
          break;
        }

        const groupId = (process.env.GROUP_ID || "").trim();
        const targetChat = groupId || from || chat;
        await client.sendMessage(targetChat, `📢 ${message}`);
        response = "✅ Broadcast envoyé.";
        break;
      }

      case "player_join": {
        response = `Tu es déjà inscrit ${player.name}.`;
        break;
      }

      default: {
        const llmReply = await askOllama(raw);
        response = llmReply.slice(0, 1500);
      }
    }

    await msg.reply(response);
  } catch (error) {
    console.error("Erreur handler:", error);
    await msg.reply("Erreur interne du bot.");
  }
}

module.exports = {
  handleMessage
};
