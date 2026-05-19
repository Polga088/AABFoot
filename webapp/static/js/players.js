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
      const res = await fetch(`/joueurs/${player.id}`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({
          phone: phone.trim(),
          active: true
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(parseError(data, res.status));
      window.location.reload();
    } catch (error) {
      alert(error.message);
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
