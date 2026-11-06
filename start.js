// Startet Guildsmith lokal + Cloudflare-Tunnel und leitet die GitHub-Pages-Seite darauf um.
import { spawn, execSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const PORT = process.env.PORT || 3000;
const server = spawn(process.execPath, ["--env-file=.env", "server.js"], { stdio: "inherit" });
const tunnel = spawn("cloudflared", ["tunnel", "--url", `http://localhost:${PORT}`], { stdio: ["ignore", "pipe", "pipe"] });

let done = false;
const onData = (buf) => {
  const m = String(buf).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
  if (!m || done) return;
  done = true;
  console.log(`\n🌐 Tunnel: ${m[0]}`);
  writeFileSync("public/tunnel.js", `window.TUNNEL_URL = "${m[0]}";\n`);
  try {
    execSync('git add public/tunnel.js && git commit -q -m "Tunnel-URL aktualisiert" && git push -q', { stdio: "inherit" });
    console.log("✅ GitHub Pages leitet in ca. 1 Minute auf den Tunnel weiter.\n");
  } catch {
    console.log("⚠ Konnte Tunnel-URL nicht pushen (git/gh Login prüfen).\n");
  }
};
tunnel.stdout.on("data", onData);
tunnel.stderr.on("data", onData);

const stop = () => { tunnel.kill(); server.kill(); process.exit(); };
process.on("SIGINT", stop);
server.on("exit", stop);
