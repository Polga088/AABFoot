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
      setFeedback(
        feedback,
        `Lineup OK : ${result.team_a_count} vs ${result.team_b_count} (${result.color_a} / ${result.color_b}).`
      );
    }

    if (action === "notify") {
      setFeedback(feedback, "Envoi des messages privés...");
      await postJson(`/calendrier/${matchId}/lineup/notify`);
      setFeedback(
        feedback,
        "MP en file d'attente (date, heure, Maps, couleur gilet). Vérifiez que le bot est connecté."
      );
    }

    if (action === "poll-delete") {
      if (!window.confirm("Supprimer le sondage WhatsApp de ce match ?")) return;
      setFeedback(feedback, "Suppression en cours...");
      await postJson(`/calendrier/${matchId}/poll/delete`);
      setFeedback(feedback, "Suppression en file d'attente (~20 s).");
      setTimeout(() => window.location.reload(), 2000);
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
