const fs = require("fs");
const { execSync } = require("child_process");

function resolveChromiumPath() {
  const fromEnv = (process.env.PUPPETEER_EXECUTABLE_PATH || "").trim();
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const candidates = [
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/google-chrome-stable",
    "/snap/bin/chromium"
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const which = execSync("which chromium-browser 2>/dev/null || which chromium 2>/dev/null", {
      encoding: "utf8"
    }).trim();
    if (which && fs.existsSync(which)) {
      return which;
    }
  } catch {
    // ignore
  }

  return undefined;
}

function buildPuppeteerOptions() {
  const executablePath = resolveChromiumPath();
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run"
  ];

  const options = { headless: true, args };
  if (executablePath) {
    options.executablePath = executablePath;
  }
  return { options, executablePath };
}

module.exports = {
  resolveChromiumPath,
  buildPuppeteerOptions
};
