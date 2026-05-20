function setFeedback(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("is-error", isError);
}

function syncOpponentField() {
  const kind = document.getElementById("eventKind")?.value;
  const opponent = document.getElementById("opponent");
  if (!opponent) return;

  const isMatch = kind === "match";
  opponent.disabled = !isMatch;
  opponent.required = isMatch;
  if (!isMatch) {
    opponent.value = "";
  }
}

async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Erreur ${response.status}`);
  }
  return payload;
}

function getFormatMaxForEvent(matchId) {
  const card = document.querySelector(`[data-match-id="${matchId}"]`);
  const raw = card?.dataset.formatMax;
  const max = Number(raw);
  return Number.isFinite(max) && max > 0 ? max : null;
}

function hideLineupPicker(matchId) {
  const picker = document.querySelector(`[data-lineup-picker="${matchId}"]`);
  if (picker) picker.classList.add("hidden");
}

async function openLineupPicker(matchId, feedback) {
  const picker = document.querySelector(`[data-lineup-picker="${matchId}"]`);
  const list = document.querySelector(`[data-lineup-list="${matchId}"]`);
  if (!picker || !list) return;

  setFeedback(feedback, "Chargement des joueurs...");
  const res = await fetch(`/calendrier/${matchId}/lineup/players`, { headers: adminHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

  const max = data.format_max || data.yes_players.length;
  const selected = new Set((data.selected_ids || []).map(Number));

  list.innerHTML = "";
  for (const player of data.yes_players) {
    const id = `lineup-${matchId}-${player.id}`;
    const checked = selected.has(player.id) ? "checked" : "";
    list.insertAdjacentHTML(
      "beforeend",
      `<label><input type="checkbox" name="lineup-player" value="${player.id}" ${checked}> ${player.name}</label>`
    );
  }

  list.querySelectorAll('input[name="lineup-player"]').forEach((input) => {
    input.addEventListener("change", () => {
      const checked = list.querySelectorAll('input[name="lineup-player"]:checked');
      if (checked.length > max) {
        input.checked = false;
        setFeedback(feedback, `Maximum ${max} joueurs pour ${data.format}.`, true);
      }
    });
  });

  picker.classList.remove("hidden");
  setFeedback(feedback, `Sélectionnez jusqu'à ${max} joueurs, puis validez.`);
}

function getSelectedLineupIds(matchId) {
  const list = document.querySelector(`[data-lineup-list="${matchId}"]`);
  if (!list) return [];
  return [...list.querySelectorAll('input[name="lineup-player"]:checked')].map((el) =>
    Number(el.value)
  );
}

async function handleCreateEvent(event) {
  event.preventDefault();
  const feedback = document.getElementById("formFeedback");
  const form = event.currentTarget;

  const payload = {
    event_kind: form.event_kind.value,
    opponent: form.opponent.value.trim(),
    format: form.format.value,
    date: form.date.value,
    time: form.time.value,
    location: form.location.value.trim(),
    maps_url: form.maps_url.value.trim(),
    notes: form.notes.value.trim(),
    publish_poll: form.publish_poll.checked
  };

  try {
    setFeedback(feedback, "Création en cours...");
    const result = await postJson("/calendrier/add", payload);
    const pollMsg = result.poll_queued
      ? " Sondage en file d'attente (envoi sous ~15 s si le bot est connecté)."
      : "";
    setFeedback(feedback, `Événement #${result.match_id} créé.${pollMsg}`);
    form.reset();
    form.location.value = "Terrain habituel";
    syncOpponentField();
    setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
}

async function handleEventAction(button) {
  const matchId = button.dataset.matchId;
  const action = button.dataset.action;
  const feedback = document.querySelector(`[data-feedback-for="${matchId}"]`);

  try {
    if (action === "poll") {
      setFeedback(feedback, "Publication du sondage...");
      await postJson(`/calendrier/${matchId}/poll`);
      setFeedback(feedback, "Sondage en file d'attente. Actualisez dans quelques secondes.");
    }

    if (action === "lineup") {
      const colorA = window.prompt("Couleur équipe A (ex: Rouge)", "Rouge") || "Rouge";
      const colorB = window.prompt("Couleur équipe B (ex: Vert)", "Vert") || "Vert";
      setFeedback(feedback, "Génération de la composition...");
      const result = await postJson(`/calendrier/${matchId}/lineup/generate`, {
        color_a: colorA,
        color_b: colorB
      });
      const reserveMsg =
        result.reserve_count > 0 ? ` · ${result.reserve_count} en réserve.` : "";
      setFeedback(
        feedback,
        `Lineup OK : ${result.team_a_count} vs ${result.team_b_count} (${result.color_a} / ${result.color_b})${reserveMsg}`
      );
    }

    if (action === "lineup-pick") {
      await openLineupPicker(matchId, feedback);
    }

    if (action === "lineup-save") {
      const playerIds = getSelectedLineupIds(matchId);
      const max = getFormatMaxForEvent(matchId);
      if (!playerIds.length) {
        setFeedback(feedback, "Sélectionnez au moins un joueur.", true);
        return;
      }
      if (max && playerIds.length > max) {
        setFeedback(feedback, `Maximum ${max} joueurs.`, true);
        return;
      }
      const colorA = window.prompt("Couleur équipe A", "Rouge") || "Rouge";
      const colorB = window.prompt("Couleur équipe B", "Vert") || "Vert";
      setFeedback(feedback, "Enregistrement de la composition...");
      const result = await postJson(`/calendrier/${matchId}/lineup/generate`, {
        color_a: colorA,
        color_b: colorB,
        player_ids: playerIds
      });
      hideLineupPicker(matchId);
      setFeedback(
        feedback,
        `Composition enregistrée : ${result.team_a_count} vs ${result.team_b_count} (${result.selected_count}/${result.format_max}).`
      );
    }

    if (action === "lineup-cancel") {
      hideLineupPicker(matchId);
      setFeedback(feedback, "");
    }

    if (action === "notify") {
      if (button.disabled) return;
      button.disabled = true;
      const force = window.confirm(
        "Envoyer les MP gilets + infos ?\n\nOK = envoi unique\nAnnuler = ne rien faire"
      );
      if (!force) {
        button.disabled = false;
        return;
      }
      setFeedback(feedback, "Envoi des messages privés (une seule fois)...");
      await postJson(`/calendrier/${matchId}/lineup/notify`, { force: false });
      setFeedback(
        feedback,
        "MP en file d'attente. Si déjà envoyés, ils ne seront pas renvoyés."
      );
    }

    if (action === "poll-delete-local") {
      const ok = window.confirm(
        "Retirer le sondage du calendrier ?\n\n" +
          "• Fonctionne sans WhatsApp connecte.\n" +
          "• Le message peut rester dans le groupe jusqu'a reconnexion du bot."
      );
      if (!ok) return;
      setFeedback(feedback, "Suppression locale...");
      const result = await postJson(`/calendrier/${matchId}/poll/delete`, { local_only: true });
      setFeedback(feedback, result.message || "Sondage retire.");
      setTimeout(() => window.location.reload(), 800);
    }

    if (action === "delete-event") {
      const ok = window.confirm(
        "Supprimer cet evenement du calendrier ?\nDisponibilites et lineup associes seront effaces."
      );
      if (!ok) return;
      setFeedback(feedback, "Suppression...");
      const res = await fetch(`/calendrier/${matchId}`, {
        method: "DELETE",
        headers: adminHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
      setFeedback(feedback, data.message || "Evenement supprime.");
      setTimeout(() => window.location.reload(), 800);
    }

    if (action === "poll-republish") {
      if (!window.confirm("Republier le sondage ? L'ancien sera supprimé si présent.")) return;
      setFeedback(feedback, "Republication en cours...");
      await postJson(`/calendrier/${matchId}/poll/republish`);
      setFeedback(feedback, "Nouveau sondage en file d'attente (~20 s).");
    }

    if (action === "edit-event") {
      const date = window.prompt("Date (YYYY-MM-DD)");
      if (date === null) return;
      const time = window.prompt("Heure (HH:MM)");
      if (time === null) return;
      const location = window.prompt("Lieu");
      if (location === null) return;
      const mapsUrl = window.prompt("Lien Google Maps (vide = inchangé)", "");
      await fetch(`/calendrier/${matchId}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          date: date.trim(),
          time: time.trim(),
          location: location.trim(),
          maps_url: mapsUrl.trim() || undefined
        })
      }).then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Erreur");
      });
      setFeedback(feedback, "Événement mis à jour. Republiez le sondage si besoin.");
    }
  } catch (error) {
    setFeedback(feedback, error.message, true);
    if (action === "notify") {
      button.disabled = false;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const kindSelect = document.getElementById("eventKind");
  kindSelect?.addEventListener("change", syncOpponentField);
  syncOpponentField();

  document.getElementById("eventForm")?.addEventListener("submit", handleCreateEvent);

  document.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => handleEventAction(button));
  });
});
