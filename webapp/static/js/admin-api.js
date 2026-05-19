const TOKEN_KEY = "footbot_admin_token";

function footbotIsSessionAdmin() {
  return window.FOOTBOT_IS_ADMIN === true || window.FOOTBOT_IS_ADMIN === "true";
}

function getAdminToken() {
  if (footbotIsSessionAdmin()) {
    return "";
  }
  let token = localStorage.getItem(TOKEN_KEY);
  if (!token) {
    token = window.prompt("Token admin (ADMIN_TOKEN du fichier .env) :", "");
    if (token) {
      localStorage.setItem(TOKEN_KEY, token.trim());
      return token.trim();
    }
    return "";
  }
  return token;
}

function adminHeaders(extra = {}) {
  const headers = { "Content-Type": "application/json", ...extra };
  if (footbotIsSessionAdmin()) {
    return headers;
  }
  const token = getAdminToken();
  if (token) {
    headers["X-Admin-Token"] = token;
  }
  return headers;
}

function adminForbiddenMessage() {
  return "Accès réservé aux administrateurs. Connectez-vous avec un compte admin.";
}
