function setFeedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

async function postBotAction(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || "Erreur");
  return data;
}

document.getElementById("defaultCotisationForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.getElementById("defaultCotisationFeedback");
  const amount = Number(document.getElementById("defaultCotisation")?.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    setFeedback(feedback, "Montant invalide", true);
    return;
  }
  try {
    const res = await fetch("/finance/settings/cotisation", {
      method: "PUT",
      headers: adminHeaders(),
      body: JSON.stringify({ amount })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Erreur");
    setFeedback(feedback, `Cotisation globale : ${data.default_cotisation} dh (synchro bot OK).`);
    document.querySelector("[data-default-cotisation]")?.setAttribute(
      "data-default-cotisation",
      String(data.default_cotisation)
    );
    document.querySelectorAll("tr[data-uses-default='1'] .cotisation-input").forEach((input) => {
      input.value = Number(data.default_cotisation).toFixed(2);
    });
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
});

document.getElementById("publishCotisationReportBtn")?.addEventListener("click", async () => {
  const feedback = document.getElementById("cotisationReportFeedback");
  try {
    const data = await postBotAction("/finance/bot/cotisation-report");
    setFeedback(feedback, data.message || "Demande envoyee au bot.");
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
});

function getLowBalanceIds() {
  const node = document.getElementById("lowBalanceIds");
  if (!node) return [];
  try {
    return JSON.parse(node.textContent || "[]");
  } catch {
    return [];
  }
}

async function queueWalletReminder(playerIds) {
  return postBotAction("/finance/bot/wallet-reminder", { player_ids: playerIds });
}

document.getElementById("remindAllLowBalanceBtn")?.addEventListener("click", async () => {
  const ids = getLowBalanceIds();
  if (!ids.length) return;
  if (!window.confirm(`Envoyer un rappel WhatsApp a ${ids.length} joueur(s) ?`)) return;
  try {
    const data = await queueWalletReminder(ids);
    alert(data.message || "Rappels en file d'attente.");
  } catch (error) {
    alert(error.message);
  }
});

document.querySelectorAll(".btn-wallet-remind").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const playerId = Number(btn.dataset.playerId);
    if (!playerId) return;
    try {
      const data = await queueWalletReminder([playerId]);
      btn.disabled = true;
      btn.textContent = "Envoye";
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = "Rappeler";
      }, 4000);
      alert(data.message || "Rappel en file d'attente.");
    } catch (error) {
      alert(error.message);
    }
  });
});

document.getElementById("creditForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.getElementById("creditFeedback");
  try {
    const res = await fetch("/finance/credit", {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({
        player_id: Number(document.getElementById("creditPlayer").value),
        amount: Number(document.getElementById("creditAmount").value),
        description: document.getElementById("creditDesc").value.trim()
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");
    setFeedback(feedback, `Crédité. Nouveau solde : ${data.balance} dh`);
    setTimeout(() => window.location.reload(), 1000);
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
});

function downloadExport(type) {
  if (footbotIsSessionAdmin()) {
    window.location.href = `/finance/export?type=${type}`;
    return;
  }
  const token = getAdminToken();
  if (!token) {
    alert(adminForbiddenMessage());
    return;
  }
  window.location.href = `/finance/export?type=${type}&token=${encodeURIComponent(token)}`;
}

document.getElementById("exportTransactions")?.addEventListener("click", (e) => {
  e.preventDefault();
  fetch(`/finance/export?type=transactions`, { headers: { "X-Admin-Token": getAdminToken() } })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cotisations.csv";
      a.click();
    });
});

document.getElementById("exportPlayers")?.addEventListener("click", (e) => {
  e.preventDefault();
  fetch(`/finance/export?type=players`, { headers: { "X-Admin-Token": getAdminToken() } })
    .then((r) => r.blob())
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "joueurs.csv";
      a.click();
    });
});

document.querySelectorAll(".cotisation-input").forEach((input) => {
  input.addEventListener("change", async () => {
    const playerId = input.dataset.playerId;
    const raw = input.value.trim();
    const amount = raw === "" ? null : Number(raw);
    if (amount !== null && (!Number.isFinite(amount) || amount <= 0)) {
      alert("Montant invalide");
      return;
    }
    try {
      const res = await fetch(`/finance/players/${playerId}/cotisation`, {
        method: "PUT",
        headers: adminHeaders(),
        body: JSON.stringify({ cotisation_amount: amount })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Erreur");
      input.value = Number(data.cotisation_amount).toFixed(2);
      const row = input.closest("tr");
      const badge = row?.querySelector(".cotisation-default-badge");
      if (amount === null) {
        row?.setAttribute("data-uses-default", "1");
        input.dataset.custom = "0";
        if (!badge) {
          const span = document.createElement("span");
          span.className = "badge badge-blue cotisation-default-badge";
          span.textContent = "défaut";
          input.parentElement?.appendChild(span);
        }
      } else {
        row?.setAttribute("data-uses-default", "0");
        input.dataset.custom = "1";
        badge?.remove();
      }
    } catch (error) {
      alert(error.message);
    }
  });
});

document.getElementById("importForm")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const feedback = document.getElementById("importFeedback");
  const file = document.getElementById("importFile").files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append("file", file);

  try {
    const res = await fetch("/finance/import", {
      method: "POST",
      headers: { "X-Admin-Token": getAdminToken() },
      body: formData
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erreur");
    const errMsg = data.errors?.length ? ` Erreurs: ${data.errors.join("; ")}` : "";
    setFeedback(
      feedback,
      `Import OK — ${data.players_created} joueur(s) créé(s), ${data.credits_applied} crédit(s).${errMsg}`
    );
    setTimeout(() => window.location.reload(), 1500);
  } catch (error) {
    setFeedback(feedback, error.message, true);
  }
});
