/**
 * Maroc : 0663104773 et 212663104773 → même numéro (canonique 212…@c.us côté serveur).
 */
function phoneDigitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function phoneToCanonicalDigits(raw) {
  let digits = phoneDigitsOnly(raw);
  if (!digits) return "";

  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `212${digits.slice(1)}`;
  } else if (digits.length === 9 && (digits.startsWith("6") || digits.startsWith("7"))) {
    digits = `212${digits}`;
  }

  if (digits.startsWith("212") && digits.length > 12) {
    digits = digits.slice(0, 12);
  }

  if (!/^212[67]\d{8}$/.test(digits)) return "";
  return digits;
}

function normalizePhoneInput(raw) {
  const digits = phoneToCanonicalDigits(raw);
  return digits ? `${digits}@c.us` : "";
}

function formatLocalPhone(raw) {
  const digits = phoneToCanonicalDigits(raw);
  if (!digits) return "";
  return `0${digits.slice(3)}`;
}

function bindPhoneInput(input, hintEl) {
  if (!input) return;

  const refresh = () => {
    const local = formatLocalPhone(input.value);
    const canonical = phoneToCanonicalDigits(input.value);
    if (!hintEl) return;
    if (!canonical) {
      hintEl.textContent = "Format : 0663104773 ou 212663104773";
      hintEl.classList.remove("is-ok");
      return;
    }
    hintEl.textContent = `Reconnu : ${local} = 212${canonical.slice(3)}`;
    hintEl.classList.add("is-ok");
  };

  input.addEventListener("input", refresh);
  input.addEventListener("blur", refresh);
  refresh();
}
