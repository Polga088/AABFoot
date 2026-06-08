function setFeedback(el, msg, isError = false) {
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("is-error", isError);
}

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
