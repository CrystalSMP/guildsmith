// node maintenance.js on|ai-off|notice|normal ["Nachricht"] ["Überschrift"]
import { setMode, publish } from "./site.js";

const [mode = "on", message, title] = process.argv.slice(2);
const clean = (s) => (s && s.trim() ? s.trim() : null);
const msg = clean(message), ttl = clean(title);

const modes = {
  on: { state: "maintenance", ai: false, title: ttl || "🛠️ Wartung", message: msg || "Guildsmith wird gerade gewartet. Schau gleich nochmal vorbei!" },
  "ai-off": { state: "ai-off", ai: false, title: ttl || "⚠️ KI pausiert", message: msg || "Pläne erstellen ist gerade pausiert." },
  notice: { state: "notice", ai: true, title: ttl || "📢 Hinweis", message: msg },
  normal: { state: "normal", ai: true, title: null, message: null },
};
if (!modes[mode]) { console.log("Unbekannter Modus:", mode); process.exit(1); }

const m = setMode(modes[mode]);
const pushed = publish(m);
console.log({
  maintenance: "🛠️  Wartung AN – die Seite ist gesperrt.",
  "ai-off": "⚠️  Seite offen, KI PAUSIERT.",
  notice: "📢 Hinweis-Banner aktiv.",
  normal: "✅ Alles normal.",
}[m.state]);
console.log(pushed ? "   GitHub Pages zeigt es in ca. 1 Minute." : "   ⚠ Konnte nicht zu GitHub pushen (nur lokal gespeichert).");
