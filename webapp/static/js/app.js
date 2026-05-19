let currentMatchId = null;
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

function playerRow(player) {
  const initials = String(player.name || "?")
    .split(" ")
    .map((part) => part[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return `
    <div class="player-row">
      <span class="pos-badge">${escapeHtml(player.position || "SUB")}</span>
      <span class="avatar">${escapeHtml(initials)}</span>
      <span>${escapeHtml(player.name || "Inconnu")}</span>
    </div>
  `;
}

function renderMediaItems(media) {
  const mediaGrid = document.getElementById("mediaGrid");
  if (!mediaGrid) return;

  lightboxImages = media.filter((item) => item.type === "image");
  const cards = media.map((item, idx) => {
    if (item.type === "video") {
      return `
        <div class="media-item">
          <video controls src="${escapeHtml(item.url)}"></video>
          <p>${escapeHtml(item.caption || "")}</p>
        </div>
      `;
    }

    const imageIndex = lightboxImages.findIndex((img) => img.id === item.id);
    return `
      <div class="media-item">
        <img src="${escapeHtml(item.url)}" alt="media-${idx}" onclick="openLightbox(${imageIndex})">
        <p>${escapeHtml(item.caption || "")}</p>
      </div>
    `;
  });

  const placeholders = Math.max(0, 3 - media.length);
  for (let i = 0; i < placeholders; i += 1) {
    cards.push('<div class="media-item media-empty">Zone upload</div>');
  }

  mediaGrid.innerHTML = cards.join("");
}

async function fetchMatchDetail(matchId) {
  try {
    currentMatchId = matchId;
    const response = await fetch(`/match/${matchId}`);
    const payload = await response.json();
    if (!payload.success) return;

    document.querySelectorAll(".match-card").forEach((card) => {
      card.classList.toggle("active-card", Number(card.dataset.matchId) === Number(matchId));
    });

    const match = payload.match || {};
    const lineup = payload.lineup || { team_a: [], team_b: [] };

    const scoreDisplay = document.getElementById("scoreDisplay");
    if (scoreDisplay) {
      const left = match.score_a != null ? match.score_a : "-";
      const right = match.score_b != null ? match.score_b : "-";
      scoreDisplay.textContent = `${left} - ${right}`;
    }

    const motm = document.getElementById("manOfTheMatchBadge");
    if (motm) {
      if (match.homme_du_match) {
        motm.style.display = "inline-flex";
        motm.textContent = `⭐ Homme du match: ${match.homme_du_match}`;
      } else {
        motm.style.display = "none";
      }
    }

    const teamA = document.getElementById("teamAList");
    const teamB = document.getElementById("teamBList");
    if (teamA) teamA.innerHTML = (lineup.team_a || []).map(playerRow).join("") || "<p class='metric-sub'>Aucun joueur</p>";
    if (teamB) teamB.innerHTML = (lineup.team_b || []).map(playerRow).join("") || "<p class='metric-sub'>Aucun joueur</p>";

    renderMediaItems(payload.media || []);
  } catch (error) {
    console.error("Erreur fetchMatchDetail:", error);
  }
}

async function uploadMedia(matchId, file) {
  if (!matchId || !file) return;

  const form = new FormData();
  form.append("file", file);
  form.append("caption", "");

  const response = await fetch(`/match/${matchId}/upload`, {
    method: "POST",
    body: form
  });
  const payload = await response.json();
  if (payload.success) {
    await fetchMatchDetail(matchId);
  }
}

function triggerUploadPicker() {
  const input = document.getElementById("mediaInput");
  if (input) input.click();
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
  const overlay = document.getElementById("lightboxOverlay");
  if (overlay) overlay.style.display = "none";
}

function lightboxPrev() {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex - 1 + lightboxImages.length) % lightboxImages.length;
  const image = document.getElementById("lightboxImage");
  if (image) image.src = lightboxImages[lightboxIndex].url;
}

function lightboxNext() {
  if (!lightboxImages.length) return;
  lightboxIndex = (lightboxIndex + 1) % lightboxImages.length;
  const image = document.getElementById("lightboxImage");
  if (image) image.src = lightboxImages[lightboxIndex].url;
}

function renderWalletWeekChart() {
  const chart = document.getElementById("walletWeekChart");
  if (!chart) return;

  let series = [];
  try {
    series = JSON.parse(chart.dataset.series || "[]");
  } catch (error) {
    console.error("Invalid wallet series JSON", error);
    return;
  }
  if (!Array.isArray(series) || !series.length) return;

  const maxAbs = Math.max(...series.map((item) => Math.abs(Number(item.balance || 0))), 1);
  chart.innerHTML = series
    .map((item) => {
      const value = Number(item.balance || 0);
      const ratio = Math.max(8, Math.round((Math.abs(value) / maxAbs) * 100));
      const colorClass = value > 30 ? "bar-green" : value >= 10 ? "bar-amber" : "bar-red";
      return `
        <div class="week-bar-col">
          <div class="week-bar-val">${escapeHtml(value.toFixed(0))}</div>
          <div class="week-bar ${colorClass}" style="height:${ratio}%;"></div>
          <div class="week-bar-label">${escapeHtml(item.label || "")}</div>
        </div>
      `;
    })
    .join("");
}

function setWalletFilter(filterType) {
  const rows = document.querySelectorAll("#walletHistoryTable tbody tr");
  rows.forEach((row) => {
    const txType = row.dataset.txType;
    row.style.display = filterType === "all" || txType === filterType ? "" : "none";
  });

  document.querySelectorAll("[data-wallet-filter]").forEach((btn) => {
    btn.classList.toggle("active-pill", btn.dataset.walletFilter === filterType);
  });
}

function exportWalletCsv() {
  const rows = Array.from(document.querySelectorAll("#walletHistoryTable tbody tr"))
    .filter((row) => row.style.display !== "none")
    .map((row) =>
      Array.from(row.querySelectorAll("td"))
        .map((cell) => `"${String(cell.textContent || "").trim().replace(/"/g, '""')}"`)
        .join(",")
    );

  const header = ["Type", "Description", "Date", "Montant", "Solde"]
    .map((item) => `"${item}"`)
    .join(",");
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "wallet-history.csv";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.addEventListener("DOMContentLoaded", () => {
  const pane = document.getElementById("matchDetailPane");
  const initialMatchId = pane?.dataset?.selectedId;
  if (initialMatchId) {
    fetchMatchDetail(Number(initialMatchId));
  }

  const input = document.getElementById("mediaInput");
  if (input) {
    input.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      if (file) await uploadMedia(currentMatchId, file);
      input.value = "";
    });
  }

  const dropzone = document.getElementById("uploadDropzone");
  if (dropzone) {
    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      dropzone.classList.add("drag-over");
    });
    dropzone.addEventListener("dragleave", () => {
      dropzone.classList.remove("drag-over");
    });
    dropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      dropzone.classList.remove("drag-over");
      const file = event.dataTransfer?.files?.[0];
      if (file) await uploadMedia(currentMatchId, file);
    });
  }

  renderWalletWeekChart();
});
