let currentMatchId = null;
let currentDetail = null;
let lightboxImages = [];
let lightboxIndex = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isAdmin() {
  return document.getElementById("matchDetailPane")?.dataset?.isAdmin === "1";
}

function playerRow(player) {
  const initials = String(player.name || "?")
    .split(" ")
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `
    <div class="player-row">
      <span class="pos-badge">${escapeHtml(player.position || "SUB")}</span>
      <span class="avatar">${escapeHtml(initials)}</span>
      <span>${escapeHtml(player.name)}</span>
    </div>`;
}

function buildPlayerOptions(players, selectedId) {
  const opts = ['<option value="">— Joueur —</option>'];
  for (const p of players) {
    const sel = Number(selectedId) === Number(p.id) ? "selected" : "";
    opts.push(`<option value="${p.id}" ${sel}>${escapeHtml(p.name)}</option>`);
  }
  return opts.join("");
}

function renderGoalRow(goal = {}) {
  const players = currentDetail?.lineup_players || [];
  const row = document.createElement("div");
  row.className = "goal-row";
  row.innerHTML = `
    <select class="form-input goal-scorer">${buildPlayerOptions(players, goal.player_id)}</select>
    <select class="form-input goal-assist">${buildPlayerOptions(players, goal.assist_player_id)}</select>
    <select class="form-input goal-team">
      <option value="a" ${goal.team !== "b" ? "selected" : ""}>Équipe A</option>
      <option value="b" ${goal.team === "b" ? "selected" : ""}>Équipe B</option>
    </select>
    <button type="button" class="btn btn-sm btn-danger goal-remove">✕</button>
  `;
  row.querySelector(".goal-remove").addEventListener("click", () => row.remove());
  return row;
}

function renderGoalsEditor(goals) {
  const list = document.getElementById("goalsList");
  if (!list) return;
  list.innerHTML = "";
  const items = goals?.length ? goals : [{}];
  items.forEach((g) => list.appendChild(renderGoalRow(g)));
}

function collectGoalsPayload() {
  return [...document.querySelectorAll("#goalsList .goal-row")]
    .map((row) => {
      const player_id = Number(row.querySelector(".goal-scorer")?.value);
      const assist = row.querySelector(".goal-assist")?.value;
      const team = row.querySelector(".goal-team")?.value || "a";
      if (!player_id) return null;
      return {
        player_id,
        assist_player_id: assist ? Number(assist) : null,
        team
      };
    })
    .filter(Boolean);
}

function renderMotmPanel(detail) {
  const options = document.getElementById("motmVoteOptions");
  const tallyEl = document.getElementById("motmTally");
  const hint = document.getElementById("motmHint");
  if (!options || !tallyEl) return;

  const players = detail.lineup_players || [];
  options.innerHTML = "";

  if (!players.length) {
    hint.textContent = "Aucune composition — validez un lineup d'abord.";
    tallyEl.innerHTML = "";
    return;
  }

  if (detail.can_vote_motm) {
    hint.textContent = "Choisissez le meilleur joueur du match (1 vote).";
    for (const p of players) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `motm-vote-btn ${Number(detail.user_motm_vote) === Number(p.id) ? "is-voted" : ""}`;
      btn.textContent = p.name;
      btn.addEventListener("click", () => submitMotmVote(p.id));
      options.appendChild(btn);
    }
  } else {
    hint.textContent = "Vote réservé aux joueurs ayant participé à ce match.";
  }

  const tally = detail.motm_tally || [];
  if (!tally.length) {
    tallyEl.innerHTML = "<p class='metric-sub'>Aucun vote pour le moment.</p>";
    return;
  }

  tallyEl.innerHTML = tally
    .map(
      (t, idx) => `
      <div class="motm-tally-row ${idx === 0 ? "is-leader" : ""}">
        <span>${escapeHtml(t.name)}</span>
        <span class="badge badge-gold">${t.votes} vote${t.votes > 1 ? "s" : ""}</span>
      </div>`
    )
    .join("");
}

function renderMediaItems(media) {
  const mediaGrid = document.getElementById("mediaGrid");
  if (!mediaGrid) return;

  lightboxImages = media.filter((item) => item.type === "image");
  const cards = media.map((item, idx) => {
    if (item.type === "video") {
      return `<div class="media-item"><video controls src="${escapeHtml(item.url)}"></video></div>`;
    }
    const imageIndex = lightboxImages.findIndex((img) => img.id === item.id);
    return `<div class="media-item"><img src="${escapeHtml(item.url)}" alt="media-${idx}" onclick="openLightbox(${imageIndex})"></div>`;
  });
  mediaGrid.innerHTML = cards.join("") || "<p class='metric-sub'>Aucun média.</p>";
}

async function fetchMatchDetail(matchId) {
  try {
    currentMatchId = matchId;
    const response = await fetch(`/match/${matchId}`);
    const payload = await response.json();
    if (!payload.success) return;

    currentDetail = payload;
    document.querySelectorAll(".match-card").forEach((card) => {
      card.classList.toggle("active-card", Number(card.dataset.matchId) === Number(matchId));
    });

    const match = payload.match || {};
    const lineup = payload.lineup || { team_a: [], team_b: [] };

    const title = document.getElementById("detailMatchTitle");
    if (title) title.textContent = match.title || `Match #${match.id}`;

    const scoreDisplay = document.getElementById("scoreDisplay");
    if (scoreDisplay) {
      const left = match.score_a != null ? match.score_a : "—";
      const right = match.score_b != null ? match.score_b : "—";
      scoreDisplay.textContent = `${left} - ${right}`;
    }

    const teamALabel = document.getElementById("teamALabel");
    const teamBLabel = document.getElementById("teamBLabel");
    if (teamALabel && lineup.color_a) teamALabel.textContent = `Équipe ${lineup.color_a}`;
    if (teamBLabel && lineup.color_b) teamBLabel.textContent = `Équipe ${lineup.color_b}`;

    const motm = document.getElementById("manOfTheMatchBadge");
    if (motm) {
      if (match.homme_du_match) {
        motm.style.display = "inline-flex";
        motm.textContent = `⭐ ${match.homme_du_match}`;
      } else {
        motm.style.display = "none";
      }
    }

    document.getElementById("teamAList").innerHTML =
      (lineup.team_a || []).map(playerRow).join("") || "<p class='metric-sub'>—</p>";
    document.getElementById("teamBList").innerHTML =
      (lineup.team_b || []).map(playerRow).join("") || "<p class='metric-sub'>—</p>";

    if (isAdmin()) {
      document.getElementById("scoreAInput").value = match.score_a ?? 0;
      document.getElementById("scoreBInput").value = match.score_b ?? 0;
      document.getElementById("matchNotesInput").value = match.notes || "";
      renderGoalsEditor(payload.goals || []);
    }

    renderMotmPanel(payload);
    renderMediaItems(payload.media || []);
  } catch (error) {
    console.error("fetchMatchDetail:", error);
  }
}

async function saveMatchResult() {
  const feedback = document.getElementById("saveResultFeedback");
  if (!currentMatchId) return;

  try {
    feedback.textContent = "Enregistrement...";
    const response = await fetch(`/match/${currentMatchId}/result`, {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        score_a: Number(document.getElementById("scoreAInput").value),
        score_b: Number(document.getElementById("scoreBInput").value),
        notes: document.getElementById("matchNotesInput").value.trim(),
        goals: collectGoalsPayload()
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Erreur");
    feedback.textContent = "Match enregistré dans l'historique.";
    setTimeout(() => window.location.reload(), 900);
  } catch (error) {
    feedback.textContent = error.message;
    feedback.classList.add("is-error");
  }
}

async function submitMotmVote(playerId) {
  if (!currentMatchId) return;
  try {
    const response = await fetch(`/match/${currentMatchId}/motm/vote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_id: playerId })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Erreur");
    await fetchMatchDetail(currentMatchId);
  } catch (error) {
    alert(error.message);
  }
}

async function uploadMedia(matchId, file) {
  if (!matchId || !file) return;
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(`/match/${matchId}/upload`, { method: "POST", body: form });
  const payload = await response.json();
  if (payload.success) await fetchMatchDetail(matchId);
}

function triggerUploadPicker() {
  document.getElementById("mediaInput")?.click();
}

function openLightbox(index) {
  if (index < 0 || index >= lightboxImages.length) return;
  lightboxIndex = index;
  const overlay = document.getElementById("lightboxOverlay");
  const image = document.getElementById("lightboxImage");
  if (!overlay || !image) return;
  image.src = lightboxImages[lightboxIndex].url;
  overlay.style.display = "flex";
}

function lightboxClose() {
  document.getElementById("lightboxOverlay").style.display = "none";
}

function lightboxPrev() {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  document.getElementById("lightboxImage").src = lightboxImages[lightboxIndex].url;
}

function lightboxNext() {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  document.getElementById("lightboxImage").src = lightboxImages[lightboxIndex].url;
}

document.addEventListener("DOMContentLoaded", () => {
  const pane = document.getElementById("matchDetailPane");
  const initialMatchId = pane?.dataset?.selectedId;
  if (initialMatchId) fetchMatchDetail(Number(initialMatchId));

  document.getElementById("addGoalBtn")?.addEventListener("click", () => {
    document.getElementById("goalsList")?.appendChild(renderGoalRow({}));
  });
  document.getElementById("saveResultBtn")?.addEventListener("click", saveMatchResult);

  const input = document.getElementById("mediaInput");
  input?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (file) await uploadMedia(currentMatchId, file);
    input.value = "";
  });

  const dropzone = document.getElementById("uploadDropzone");
  dropzone?.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("drag-over");
  });
  dropzone?.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone?.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) await uploadMedia(currentMatchId, file);
  });
});
