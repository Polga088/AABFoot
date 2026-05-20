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

const lineupStateByMatch = new Map();

function hideLineupPicker(matchId) {
  const picker = document.querySelector(`[data-lineup-picker="${matchId}"]`);
  if (picker) picker.classList.add("hidden");
  lineupStateByMatch.delete(matchId);
}

function getLineupState(matchId) {
  return lineupStateByMatch.get(matchId);
}

function playerName(state, playerId) {
  return state.players.get(playerId)?.name || `Joueur#${playerId}`;
}

function renderLineupPickerUi(matchId, feedback) {
  const state = getLineupState(matchId);
  if (!state) return;

  const rosterA = document.querySelector(`[data-lineup-team-a="${matchId}"]`);
  const rosterB = document.querySelector(`[data-lineup-team-b="${matchId}"]`);
  const pool = document.querySelector(`[data-lineup-pool="${matchId}"]`);
  const countA = document.querySelector(`[data-lineup-count-a="${matchId}"]`);
  const countB = document.querySelector(`[data-lineup-count-b="${matchId}"]`);

  const teamMaxLabel = state.teamMax ? ` / ${state.teamMax}` : "";
  if (countA) countA.textContent = `${state.teamA.size}${teamMaxLabel}`;
  if (countB) countB.textContent = `${state.teamB.size}${teamMaxLabel}`;

  const renderRoster = (el, ids, teamKey) => {
    if (!el) return;
    el.innerHTML = "";
    for (const id of ids) {
      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.justifyContent = "space-between";
      li.style.alignItems = "center";
      li.style.gap = "8px";
      const label = document.createElement("span");
      label.textContent = playerName(state, id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-sm";
      btn.textContent = "Retirer";
      btn.addEventListener("click", () => {
        state[teamKey].delete(id);
        renderLineupPickerUi(matchId, feedback);
      });
      li.appendChild(label);
      li.appendChild(btn);
      el.appendChild(li);
    }
    if (!ids.size) {
      const li = document.createElement("li");
      li.className = "metric-sub";
      li.textContent = "Aucun joueur";
      el.appendChild(li);
    }
  };

  renderRoster(rosterA, state.teamA, "teamA");
  renderRoster(rosterB, state.teamB, "teamB");

  if (!pool) return;
  pool.innerHTML = "";
  const unassigned = [...state.players.keys()].filter(
    (id) => !state.teamA.has(id) && !state.teamB.has(id)
  );

  for (const id of unassigned) {
    const row = document.createElement("div");
    row.className = "lineup-pool-row";
    row.innerHTML = `<span>${playerName(state, id)}</span>`;
    const actions = document.createElement("div");
    actions.className = "lineup-pool-actions";

    const btnA = document.createElement("button");
    btnA.type = "button";
    btnA.className = "btn btn-sm";
    btnA.textContent = "→ A";
    btnA.addEventListener("click", () => assignPlayerToTeam(matchId, id, "A", feedback));

    const btnB = document.createElement("button");
    btnB.type = "button";
    btnB.className = "btn btn-sm";
    btnB.textContent = "→ B";
    btnB.addEventListener("click", () => assignPlayerToTeam(matchId, id, "B", feedback));

    actions.appendChild(btnA);
    actions.appendChild(btnB);
    row.appendChild(actions);
    pool.appendChild(row);
  }

  if (!unassigned.length) {
    pool.innerHTML = '<p class="metric-sub">Tous les joueurs sont assignés à une équipe.</p>';
  }
}

function assignPlayerToTeam(matchId, playerId, team, feedback) {
  const state = getLineupState(matchId);
  if (!state) return;

  const target = team === "A" ? state.teamA : state.teamB;
  const other = team === "A" ? state.teamB : state.teamA;

  if (state.teamMax && target.size >= state.teamMax) {
    setFeedback(
      feedback,
      `Équipe ${team} complète (max ${state.teamMax} pour ${state.format}).`,
      true
    );
    return;
  }

  if (state.formatMax) {
    const total = state.teamA.size + state.teamB.size;
    if (!target.has(playerId) && !other.has(playerId) && total >= state.formatMax) {
      setFeedback(
        feedback,
        `Maximum ${state.formatMax} joueurs au total (${state.format}).`,
        true
      );
      return;
    }
  }

  other.delete(playerId);
  target.add(playerId);
  renderLineupPickerUi(matchId, feedback);
  setFeedback(feedback, "");
}

async function openLineupPicker(matchId, feedback) {
  const picker = document.querySelector(`[data-lineup-picker="${matchId}"]`);
  const pool = document.querySelector(`[data-lineup-pool="${matchId}"]`);
  if (!picker || !pool) return;

  setFeedback(feedback, "Chargement des joueurs...");
  const res = await fetch(`/calendrier/${matchId}/lineup/players`, { headers: adminHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);

  const players = new Map();
  for (const p of data.pool_players || []) {
    players.set(p.id, p);
  }

  const colorAInput = document.querySelector(`[data-lineup-color-a="${matchId}"]`);
  const colorBInput = document.querySelector(`[data-lineup-color-b="${matchId}"]`);
  if (colorAInput) colorAInput.value = data.color_a || "Rouge";
  if (colorBInput) colorBInput.value = data.color_b || "Vert";

  lineupStateByMatch.set(matchId, {
    players,
    teamA: new Set((data.team_a_ids || []).map(Number)),
    teamB: new Set((data.team_b_ids || []).map(Number)),
    format: data.format || "",
    formatMax: data.format_max || null,
    teamMax: data.team_max || null,
    source: data.source
  });

  const hint = document.querySelector(`[data-lineup-hint="${matchId}"]`);
  if (hint) {
    const perTeam = data.team_max ? `${data.team_max} par équipe` : "répartis en 2";
    const total = data.format_max ? ` (${data.format_max} max)` : "";
    if (data.source === "all_players") {
      hint.textContent =
        `Sondage non visible ou sans votes — liste complète des joueurs actifs. ` +
        `Assignez ${perTeam}${total}, puis validez. Les joueurs choisis seront marqués « dispo ».`;
    } else {
      hint.textContent =
        `Joueurs ayant voté « Oui ». Assignez ${perTeam}${total} (équipe A / équipe B).`;
    }
  }

  renderLineupPickerUi(matchId, feedback);
  picker.classList.remove("hidden");
  picker.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
      const state = getLineupState(matchId);
      if (!state) {
        setFeedback(feedback, "Ouvrez d'abord « Choisir lineup ».", true);
        return;
      }

      const teamAIds = [...state.teamA];
      const teamBIds = [...state.teamB];
      if (!teamAIds.length || !teamBIds.length) {
        setFeedback(feedback, "Chaque équipe doit avoir au moins 1 joueur.", true);
        return;
      }

      const colorA =
        document.querySelector(`[data-lineup-color-a="${matchId}"]`)?.value.trim() || "Rouge";
      const colorB =
        document.querySelector(`[data-lineup-color-b="${matchId}"]`)?.value.trim() || "Vert";

      setFeedback(feedback, "Enregistrement des 2 équipes...");
      const result = await postJson(`/calendrier/${matchId}/lineup/generate`, {
        color_a: colorA,
        color_b: colorB,
        team_a_ids: teamAIds,
        team_b_ids: teamBIds
      });
      hideLineupPicker(matchId);
      setFeedback(
        feedback,
        `Équipes enregistrées : ${result.team_a_count} (${result.color_a}) vs ${result.team_b_count} (${result.color_b}).`
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
