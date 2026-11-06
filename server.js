import crypto from "node:crypto";
import express from "express";
import { getMode } from "./site.js";
import { startBot } from "./bot.js";

const app = express();
app.use(express.json({ limit: "1mb" }));
const ORIGINS = (process.env.ALLOWED_ORIGINS || "https://crystalsmp.github.io").split(",");
app.use((req, res, next) => {
  if (ORIGINS.includes(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.static("public"));

const DISCORD = "https://discord.com/api/v10";
const TOKEN = process.env.DISCORD_BOT_TOKEN;

// Discord-Rechte (Bitflags) die die AI benutzen darf
const PERMS = {
  ADMINISTRATOR: 1n << 3n,
  MANAGE_CHANNELS: 1n << 4n,
  MANAGE_GUILD: 1n << 5n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  VIEW_CHANNEL: 1n << 10n,
  SEND_MESSAGES: 1n << 11n,
  MANAGE_MESSAGES: 1n << 13n,
  EMBED_LINKS: 1n << 14n,
  ATTACH_FILES: 1n << 15n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  MENTION_EVERYONE: 1n << 17n,
  CONNECT: 1n << 20n,
  SPEAK: 1n << 21n,
  MUTE_MEMBERS: 1n << 22n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
};

const SYSTEM = `Du planst Discord-Server. Antworte NUR mit JSON (kein Markdown) in diesem Format:
{
  "summary": "kurze Beschreibung auf Deutsch",
  "roles": [{ "name": "Admin", "color": "#e74c3c", "hoist": true, "permissions": ["ADMINISTRATOR"] }],
  "categories": [{
    "name": "📢 Info",
    "private_to_roles": [],
    "channels": [{ "name": "regeln", "type": "text", "topic": "Serverregeln", "readonly": true }]
  }]
}
Regeln: roles von höchster zu niedrigster Rolle. Erlaubte permissions: ${Object.keys(PERMS).join(", ")}.
type ist "text" oder "voice". Textkanal-Namen klein, mit Bindestrichen, Emojis erlaubt.
private_to_roles: Rollennamen die die Kategorie sehen dürfen (leer = alle). readonly: nur Rollen mit MANAGE_MESSAGES/ADMINISTRATOR dürfen schreiben.
Maximal 15 Rollen, 10 Kategorien, 40 Kanäle.`;

function parseJson(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI hat kein JSON geliefert");
  return JSON.parse(m[0]);
}

async function ask(messages) {
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || "KI-Fehler");
  return parseJson(d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "");
}

app.get("/api/mode", (_req, res) => res.json(getMode()));
app.use(["/api/plan", "/api/revise"], requireAuth, (_req, res, next) => {
  const m = getMode();
  if (!m.ai) return res.status(503).json({ error: m.message || "Die KI ist gerade pausiert." });
  next();
});

// Neuer Plan aus Prompt
app.post("/api/plan", async (req, res) => {
  try {
    res.json(await ask([{ role: "user", content: req.body.prompt }]));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Plan ändern
app.post("/api/revise", async (req, res) => {
  try {
    const { prompt, plan, change } = req.body;
    res.json(
      await ask([
        { role: "user", content: prompt },
        { role: "assistant", content: JSON.stringify(plan) },
        { role: "user", content: `Ändere den Plan: ${change}\nGib den kompletten neuen Plan als JSON zurück.` },
      ])
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function discord(method, path, body) {
  for (;;) {
    const r = await fetch(DISCORD + path, {
      method,
      headers: { Authorization: `Bot ${TOKEN}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 429) {
      const { retry_after } = await r.json();
      await new Promise((ok) => setTimeout(ok, (retry_after ?? 1) * 1000 + 100));
      continue;
    }
    if (!r.ok) throw new Error(`Discord ${method} ${path}: ${r.status} ${await r.text()}`);
    return r.status === 204 ? null : r.json();
  }
}

const bits = (list = []) =>
  list.reduce((acc, p) => acc | (PERMS[p] ?? 0n), 0n);

// ---------- Discord-Login (OAuth2) ----------
const PAGES_URL = process.env.PAGES_URL || "https://crystalsmp.github.io/guildsmith";
const sessions = new Map(); // sid -> { user, accessToken, guilds, guildsAt }
const pending = new Map();  // state -> redirectUri
let appId = null;
async function clientId() {
  if (!appId) appId = (await discord("GET", "/oauth2/applications/@me")).id;
  return appId;
}
const cookies = (req) => Object.fromEntries((req.headers.cookie || "").split(";").map((c) => c.trim().split("=")).filter((c) => c[0]));
const isLocal = (req) => /^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || "");
const redirectUri = (req) => (isLocal(req) ? `http://${req.headers.host}/auth/callback` : `${PAGES_URL}/callback.html`);
const session = (req) => sessions.get(cookies(req).sid);

app.get("/auth/login", async (req, res) => {
  try {
    const state = crypto.randomBytes(16).toString("hex");
    const uri = redirectUri(req);
    pending.set(state, uri);
    const q = new URLSearchParams({ client_id: await clientId(), response_type: "code", scope: "identify guilds", redirect_uri: uri, state, prompt: "none" });
    res.redirect("https://discord.com/oauth2/authorize?" + q);
  } catch (e) {
    res.status(500).send("Login-Fehler: " + e.message);
  }
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  const uri = pending.get(state);
  pending.delete(state);
  if (!code || !uri) return res.redirect("/");
  try {
    const t = await fetch(DISCORD + "/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: await clientId(), client_secret: process.env.DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: uri }),
    }).then((r) => r.json());
    if (!t.access_token) throw new Error(t.error_description || t.error || "kein Token");
    const user = await fetch(DISCORD + "/users/@me", { headers: { Authorization: "Bearer " + t.access_token } }).then((r) => r.json());
    const sid = crypto.randomBytes(24).toString("hex");
    sessions.set(sid, { user, accessToken: t.access_token });
    res.setHeader("Set-Cookie", `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${isLocal(req) ? "" : "; Secure"}`);
    res.redirect("/");
  } catch (e) {
    res.status(500).send("Login-Fehler: " + e.message);
  }
});

app.get("/auth/logout", (req, res) => {
  sessions.delete(cookies(req).sid);
  res.setHeader("Set-Cookie", "sid=; Path=/; Max-Age=0");
  res.redirect("/");
});

function requireAuth(req, res, next) {
  const s = session(req);
  if (!s) return res.status(401).json({ error: "Bitte zuerst mit Discord anmelden." });
  req.sess = s;
  next();
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.get("/api/me", requireAuth, (req, res) => {
  const u = req.sess.user;
  res.json({ id: u.id, name: u.global_name || u.username, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null });
});

const MANAGE = (1n << 3n) | (1n << 5n); // ADMINISTRATOR oder MANAGE_GUILD
// Server des Nutzers, die er verwalten darf, + ob der Bot drauf ist
async function userGuilds(s, fresh) {
  if (fresh || !s.guilds || Date.now() - s.guildsAt > 15000) {
    const r = await fetch(DISCORD + "/users/@me/guilds", { headers: { Authorization: "Bearer " + s.accessToken } });
    if (!r.ok) throw new Error("Discord: " + r.status);
    s.guilds = (await r.json()).filter((g) => g.owner || (BigInt(g.permissions) & MANAGE));
    s.guildsAt = Date.now();
  }
  const botGuilds = new Set((await discord("GET", "/users/@me/guilds")).map((g) => g.id));
  return s.guilds.map((g) => ({
    id: g.id, name: g.name, owner: g.owner, installed: botGuilds.has(g.id),
    icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96` : null,
  }));
}

app.get("/api/guilds", requireAuth, async (req, res) => {
  try {
    res.json(await userGuilds(req.sess, req.query.fresh === "1"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/invite", requireAuth, async (req, res) => {
  try {
    const q = new URLSearchParams({ client_id: await clientId(), scope: "bot", permissions: "8" });
    if (req.query.guild) { q.set("guild_id", req.query.guild); q.set("disable_guild_select", "true"); }
    res.json({ url: "https://discord.com/oauth2/authorize?" + q });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Build: streamt Fortschritt als Text
app.post("/api/build", requireAuth, async (req, res) => {
  const { guildId, plan, wipe } = req.body;
  const g = (await userGuilds(req.sess).catch(() => [])).find((x) => x.id === guildId);
  if (!g) return res.status(403).send("❌ Du darfst diesen Server nicht verwalten.");
  if (!g.installed) return res.status(400).send("❌ Der Bot ist noch nicht auf diesem Server.");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  const log = (s) => res.write(s + "\n");
  try {
    if (wipe) {
      log("🧹 Lösche alte Kanäle...");
      for (const c of await discord("GET", `/guilds/${guildId}/channels`)) {
        await discord("DELETE", `/channels/${c.id}`).catch((e) => log("  ⚠ " + e.message));
      }
      log("🧹 Lösche alte Rollen...");
      for (const r of await discord("GET", `/guilds/${guildId}/roles`)) {
        if (r.managed || r.id === guildId) continue;
        await discord("DELETE", `/guilds/${guildId}/roles/${r.id}`).catch(() => log(`  ⚠ Rolle ${r.name} übersprungen`));
      }
    }

    const roleIds = {};
    // von unten nach oben erstellen, damit die Reihenfolge stimmt
    for (const r of [...plan.roles].reverse()) {
      const made = await discord("POST", `/guilds/${guildId}/roles`, {
        name: r.name,
        color: parseInt((r.color || "#99aab5").replace("#", ""), 16),
        hoist: !!r.hoist,
        mentionable: true,
        permissions: bits(r.permissions).toString(),
      });
      roleIds[r.name] = made.id;
      log(`🎭 Rolle: ${r.name}`);
    }

    const writers = plan.roles
      .filter((r) => (r.permissions || []).some((p) => p === "ADMINISTRATOR" || p === "MANAGE_MESSAGES"))
      .map((r) => roleIds[r.name]);

    for (const cat of plan.categories) {
      const priv = (cat.private_to_roles || []).filter((n) => roleIds[n]);
      const catOverwrites = priv.length
        ? [
            { id: guildId, type: 0, deny: PERMS.VIEW_CHANNEL.toString(), allow: "0" },
            ...priv.map((n) => ({ id: roleIds[n], type: 0, allow: PERMS.VIEW_CHANNEL.toString(), deny: "0" })),
          ]
        : [];
      const category = await discord("POST", `/guilds/${guildId}/channels`, {
        name: cat.name, type: 4, permission_overwrites: catOverwrites,
      });
      log(`📁 Kategorie: ${cat.name}`);

      for (const ch of cat.channels || []) {
        const overwrites = [...catOverwrites];
        if (ch.readonly) {
          const ev = overwrites.find((o) => o.id === guildId);
          if (ev) ev.deny = (BigInt(ev.deny) | PERMS.SEND_MESSAGES).toString();
          else overwrites.push({ id: guildId, type: 0, deny: PERMS.SEND_MESSAGES.toString(), allow: "0" });
          for (const w of writers) overwrites.push({ id: w, type: 0, allow: PERMS.SEND_MESSAGES.toString(), deny: "0" });
        }
        await discord("POST", `/guilds/${guildId}/channels`, {
          name: ch.name,
          type: ch.type === "voice" ? 2 : 0,
          topic: ch.type === "voice" ? undefined : ch.topic,
          parent_id: category.id,
          permission_overwrites: overwrites,
        });
        log(`   ${ch.type === "voice" ? "🔊" : "#"} ${ch.name}`);
      }
    }
    log("✅ Fertig!");
  } catch (e) {
    log("❌ Fehler: " + e.message);
  }
  res.end();
});

const port = process.env.PORT || 3001;
startBot(TOKEN);
app.listen(port, () => console.log(`Läuft auf http://localhost:${port}`)).on("error", (e) => {
  if (e.code === "EADDRINUSE") console.log(`❌ Port ${port} ist schon belegt. Läuft Guildsmith schon in einem anderen Fenster? Dann das zuerst schließen – oder in der .env einen anderen PORT eintragen.`);
  else console.log("❌", e.message);
  process.exit(1);
});
