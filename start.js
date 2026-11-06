// Startet Guildsmith lokal + Cloudflare-Tunnel und leitet die GitHub-Pages-Seite darauf um.
import { spawn } from "node:child_process";
import { getMode, setMode, publish } from "./site.js";

const PORT = process.env.PORT || 3000;
// Starten beendet die Wartung automatisch
if (getMode().state === "maintenance") setMode({ state: "normal", ai: true, title: null, message: null });

const server = spawn(process.execPath, ["--env-file=.env", "server.js"], { stdio: "inherit" });
const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });

let done = false;
const onData = (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || done) return;
  done = true;
  console.log(`\n🌐 Tunnel: ${m[0]}`);
  const ok = publish(setMode({ url: m[0] }));
  console.log(ok ? "✅ GitHub Pages leitet in ca. 1 Minute auf den Tunnel weiter.\n" : "⚠ Konnte Tunnel-URL nicht pushen (git Login prüfen).\n");
};
tunnel.stdout.on("data", onData);
tunnel.stderr.on("data", onData);

const stop = () => { tunnel.kill(); server.kill(); process.exit(); };
process.on("SIGINT", stop);
server.on("exit", stop);
