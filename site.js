// Gemeinsame Helfer für Modus (Wartung / KI pausiert / Hinweis) und Tunnel-URL.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const MODE_FILE = "mode.json";
const DEFAULT = { state: "normal", ai: true, title: null, message: null, url: "" };

export function getMode() {
  try { return { ...DEFAULT, ...JSON.parse(readFileSync(MODE_FILE, "utf8")) }; } catch { return { ...DEFAULT }; }
}

export function setMode(patch) {
  const m = { ...getMode(), ...patch };
  writeFileSync(MODE_FILE, JSON.stringify(m, null, 2));
  return m;
}

// Schreibt public/tunnel.js und pusht es, damit GitHub Pages den Stand kennt.
export function publish(m = getMode()) {
  const url = m.state === "maintenance" ? "" : m.url;
  const site = { state: m.state, ai: m.ai, title: m.title, message: m.message };
  writeFileSync("public/tunnel.js", `window.TUNNEL_URL = ${JSON.stringify(url)};\nwindow.SITE = ${JSON.stringify(site)};\n`);
  try {
    execSync('git add public/tunnel.js && git commit -q -m "Status aktualisiert" && git push -q', { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
