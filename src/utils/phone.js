/**
 * Numéro canonique Maroc : 212XXXXXXXXX@c.us
 * 0663104773 et 212663104773 → même joueur
 */
function digitsOnly(value) {
  return String(value || "").replace(/\D/g, "");
}

function isValidPlayerPhoneDigits(digits) {
  if (!digits) return false;
  // Maroc WhatsApp : 212 + 9 chiffres (06/07…)
  return /^212[67]\d{8}$/.test(digits);
}

function toCanonicalDigits(raw) {
  let digits = digitsOnly(raw);
  if (!digits) return "";

  if (digits.length === 10 && digits.startsWith("0")) {
    digits = `212${digits.slice(1)}`;
  } else if (digits.length === 9 && (digits.startsWith("6") || digits.startsWith("7"))) {
    digits = `212${digits}`;
  }

  if (digits.startsWith("212") && digits.length > 12) {
    digits = digits.slice(0, 12);
  }

  return isValidPlayerPhoneDigits(digits) ? digits : "";
}

function normalizePhone(phone) {
  if (!phone) return "";
  const value = String(phone).trim();
  const rawId = value.includes("@") ? value.replace(/@.*/, "") : value;
  const digits = toCanonicalDigits(rawId);
  if (!digits) return "";
  return `${digits}@c.us`;
}

function getPhoneLookupVariants(rawPhone) {
  const canonical = normalizePhone(rawPhone);
  if (!canonical) return [];

  const digits = canonical.replace("@c.us", "");
  const variants = new Set([canonical, digits, `${digits}@c.us`]);

  if (digits.startsWith("212") && digits.length >= 12) {
    const local = `0${digits.slice(3)}`;
    variants.add(local);
    variants.add(`${local}@c.us`);
    variants.add(`+${digits}`);
    variants.add(`+${digits}@c.us`);
  }

  return [...variants].filter(Boolean);
}

function formatLocalPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return "";
  const digits = normalized.replace("@c.us", "");
  if (digits.startsWith("212") && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}

module.exports = {
  digitsOnly,
  isValidPlayerPhoneDigits,
  toCanonicalDigits,
  normalizePhone,
  getPhoneLookupVariants,
  formatLocalPhone
};
