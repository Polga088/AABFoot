function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function flagImg(url) {
  if (!url) return "";
  return `<img src="${escapeHtml(url)}" alt="" class="wc-flag" loading="lazy">`;
}

function renderScore(match) {
  if (match.score) {
    return `<strong>${match.score.home} - ${match.score.away}</strong>`;
  }
  if (match.status === "live") {
    return `<span class="wc-live">LIVE</span>`;
  }
  return `<span class="wc-vs">vs</span>`;
}

function renderMatchCard(match, knockout = false) {
  const knockoutClass = knockout ? " knockout" : "";
  return `
    <article class="wc-match-card status-${match.status}${knockoutClass}" data-group="${escapeHtml(match.group_letter || "")}">
      <div class="wc-match-meta">
        <span class="wc-match-group">${escapeHtml(match.group || match.round)}</span>
        <span class="wc-match-round">${escapeHtml(match.round || "")}</span>
      </div>
      <div class="wc-match-teams">
        <div class="wc-match-team">
          ${flagImg(match.team1_flag)}
          <span>${escapeHtml(match.team1)}</span>
        </div>
        <div class="wc-match-score">${renderScore(match)}</div>
        <div class="wc-match-team away">
          ${flagImg(match.team2_flag)}
          <span>${escapeHtml(match.team2)}</span>
        </div>
      </div>
      <div class="wc-match-footer">
        <span>🕐 ${escapeHtml(match.date_gmt1)} · ${escapeHtml(match.time_gmt1)} GMT+1</span>
        <span>📍 ${escapeHtml(match.ground)}</span>
      </div>
    </article>`;
}

function setupTabs() {
  document.querySelectorAll(".wc-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const name = tab.dataset.tab;
      document.querySelectorAll(".wc-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".wc-panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`[data-panel="${name}"]`)?.classList.add("active");
    });
  });
}

function setupGroupFilter() {
  const select = document.getElementById("wcGroupFilter");
  if (!select) return;
  select.addEventListener("change", () => {
    const letter = select.value;
    document.querySelectorAll("#wcScheduleList .wc-match-card").forEach((card) => {
      const show = !letter || card.dataset.group === letter;
      card.style.display = show ? "" : "none";
    });
  });
}

async function refreshWorldCupData() {
  const btn = document.getElementById("wcRefreshBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "↻ Chargement...";
  }
  try {
    const res = await fetch("/api/coupe-du-monde");
    const data = await res.json();
    if (!data.success) return;

    const updated = document.getElementById("wcUpdatedAt");
    if (updated) updated.textContent = `Mis à jour : ${data.updated_at}`;

    const scheduleList = document.getElementById("wcScheduleList");
    if (scheduleList && data.group_matches) {
      scheduleList.innerHTML = data.group_matches.map((m) => renderMatchCard(m, false)).join("");
    }

    setupGroupFilter();
  } catch (e) {
    console.error("WC refresh:", e);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "↻ Actualiser";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  setupGroupFilter();
  document.getElementById("wcRefreshBtn")?.addEventListener("click", refreshWorldCupData);
  // Actualisation auto toutes les 5 min pendant la compétition
  setInterval(refreshWorldCupData, 5 * 60 * 1000);
});
