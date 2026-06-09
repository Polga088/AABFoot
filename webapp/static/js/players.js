function parseError(payload, status) {
  if (payload?.error === "forbidden") {
    return adminForbiddenMessage();
  }
  return payload?.error || payload?.message || `Erreur ${status}`;
}

function setFeedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

function getPlayersIndex() {
  const node = document.getElementById("playersData");
  if (!node) return new Map();
  try {
    const list = JSON.parse(node.textContent || "[]");
    return new Map(list.map((p) => [String(p.id), p]));
  } catch {
    return new Map();
  }
}

const playersById = getPlayersIndex();
let groupScanPollTimer = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setScanFeedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

function renderUnknownNumbers(unknown) {
  const wrap = document.getElementById("unknownNumbersWrap");
  const body = document.getElementById("unknownNumbersBody");
  const summary = document.getElementById("groupScanSummary");
  if (!wrap || !body || !summary) return;

  if (!unknown?.length) {
    wrap.hidden = true;
    summary.hidden = false;
    summary.textContent = "Tous les membres du groupe sont deja enregistres.";
    return;
  }

  summary.hidden = false;
  summary.textContent = `${unknown.length} numero(s) a ajouter.`;
  wrap.hidden = false;
  body.innerHTML = unknown
    .map(
      (entry) => `
      <tr>
        <td><code>${escapeHtml(entry.phone)}</code></td>
        <td>${escapeHtml(entry.name || "—")}</td>
        <td>
          <button type="button" class="btn btn-sm btn-add-unknown" data-phone="${escapeHtml(entry.phone)}" data-name="${escapeHtml(entry.name || "")}">
            Ajouter
          </button>
        </td>
      </tr>`
    )
    .join("");

  body.querySelectorAll(".btn-add-unknown").forEach((btn) => {
    btn.addEventListener("click", () => {
      const phoneInput = document.getElementById("playerPhone");
      const displayNameInput = document.getElementById("playerDisplayName");
      if (phoneInput) phoneInput.value = btn.dataset.phone || "";
      if (displayNameInput) displayNameInput.value = btn.dataset.name || "";
      phoneInput?.focus();
      phoneInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      setScanFeedback(
        document.getElementById("groupScanFeedback"),
        `Numero ${btn.dataset.phone} pre-rempli. Validez le formulaire ci-dessous.`
      );
    });
  });
}

function applyGroupScanPayload(scan) {
  const feedback = document.getElementById("groupScanFeedback");
  if (!scan) {
    setScanFeedback(feedback, "");
    return;
  }

  if (scan.status === "pending") {
    setScanFeedback(feedback, "Scan en cours… (le bot traite la demande)");
    return;
  }

  if (scan.status === "error") {
    const err = scan.result?.error || "Echec du scan";
    setScanFeedback(feedback, err, true);
    return;
  }

  if (scan.status === "done" && scan.result) {
    const { groupName, totalParticipants, registeredCount, unknown } = scan.result;
    setScanFeedback(
      feedback,
      `Dernier scan : ${groupName || "Groupe"} — ${unknown?.length || 0} nouveau(x) sur ${totalParticipants} (${registeredCount} deja en base).`
    );
    renderUnknownNumbers(unknown || []);
  }
}

async function fetchGroupScanStatus() {
  const res = await fetch("/joueurs/scan-groupe", { headers: adminHeaders() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseError(data, res.status));
  return data.scan;
}

function stopGroupScanPolling() {
  if (groupScanPollTimer) {
    clearInterval(groupScanPollTimer);
    groupScanPollTimer = null;
  }
}

function startGroupScanPolling() {
  stopGroupScanPolling();
  groupScanPollTimer = setInterval(async () => {
    try {
      const scan = await fetchGroupScanStatus();
      applyGroupScanPayload(scan);
      if (scan?.status === "done" || scan?.status === "error") {
        stopGroupScanPolling();
      }
    } catch (error) {
      stopGroupScanPolling();
      setScanFeedback(document.getElementById("groupScanFeedback"), error.message, true);
    }
  }, 3000);
}

document.getElementById("scanGroupBtn")?.addEventListener("click", async () => {
  const feedback = document.getElementById("groupScanFeedback");
  try {
    setScanFeedback(feedback, "Demande envoyee au bot…");
    const res = await fetch("/joueurs/scan-groupe", {
      method: "POST",
      headers: adminHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseError(data, res.status));
    setScanFeedback(feedback, data.message || "Scan lance.");
    startGroupScanPolling();
  } catch (error) {
    setScanFeedback(feedback, error.message, true);
  }
});

fetchGroupScanStatus()
  .then((scan) => {
    applyGroupScanPayload(scan);
    if (scan?.status === "pending") startGroupScanPolling();
  })
  .catch(() => {});

document.getElementById("playerForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.getElementById("playerFormFeedback");
  const form = event.currentTarget;

  try {
    const res = await fetch("/joueurs", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        phone: form.phone.value.trim(),
        display_name: form.display_name?.value?.trim() || "",
        initial_balance: Number(form.initial_balance.value || 0)
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseError(data, res.status));
    setFeedback(feedback, "Joueur ajoute.");
    setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
});

async function savePlayer(player, { phone, displayName }) {
  const res = await fetch(`/joueurs/${player.id}`, {
    method: "PUT",
    headers: adminHeaders(),
    body: JSON.stringify({
      phone: phone.trim(),
      display_name: displayName,
      active: true
    })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(parseError(data, res.status));
}

document.querySelectorAll(".btn-edit-player").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const player = playersById.get(String(btn.dataset.playerId));
    if (!player) return;

    const phone = window.prompt(
      `Telephone pour le joueur #${player.id}`,
      (player.phone || "").replace("@c.us", "")
    );
    if (phone === null) return;

    try {
      await savePlayer(player, {
        phone,
        displayName: player.display_name || ""
      });
      window.location.reload();
    } catch (error) {
      alert(error.message);
    }
  });
});

document.querySelectorAll(".player-display-name").forEach((input) => {
  input.addEventListener("change", async () => {
    const player = playersById.get(String(input.dataset.playerId));
    if (!player) return;
    const pageFeedback = document.getElementById("playersPageFeedback");
    try {
      await savePlayer(player, {
        phone: (player.phone || "").replace("@c.us", ""),
        displayName: input.value.trim()
      });
      setFeedback(pageFeedback, `Nom enregistre pour #${player.id}.`);
    } catch (error) {
      setFeedback(pageFeedback, error.message, true);
    }
  });
});

document.querySelectorAll(".btn-deactivate-player").forEach((btn) => {
  btn.addEventListener("click", () => deactivatePlayer(btn.dataset.playerId, false));
});

document.querySelectorAll(".btn-delete-player").forEach((btn) => {
  btn.addEventListener("click", () => deactivatePlayer(btn.dataset.playerId, true));
});

document.querySelectorAll(".btn-reactivate-player").forEach((btn) => {
  btn.addEventListener("click", async () => {
    try {
      const res = await fetch(`/joueurs/${btn.dataset.playerId}/reactivate`, {
        method: "POST",
        headers: adminHeaders()
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseError(data, res.status));
      window.location.reload();
    } catch (error) {
      alert(error.message);
    }
  });
});

async function deactivatePlayer(playerId, permanent) {
  const msg = permanent
    ? "Supprimer DEFINITIVEMENT ce joueur ?\n(Historique et solde seront effaces)"
    : "Desactiver ce joueur ?\n(Il disparaitra de la liste, recuperable via Voir inactifs)";

  if (!window.confirm(msg)) return;

  const pageFeedback = document.getElementById("playersPageFeedback");

  try {
    const url = permanent ? `/joueurs/${playerId}?permanent=1` : `/joueurs/${playerId}`;
    const res = await fetch(url, {
      method: "DELETE",
      headers: adminHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(parseError(data, res.status));

    setFeedback(pageFeedback, data.message || "Operation reussie.");
    setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    setFeedback(pageFeedback, error.message, true);
    alert(error.message);
  }
}
