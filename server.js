import crypto from "node:crypto";
import express from "express";
import { getMode } from "./site.js";
import { startBot } from "./bot.js";
import { registerFeatureRoutes } from "./features.js";

const app = express();
app.use(express.json({ limit: "12mb" }));
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
  try { return JSON.parse(m[0]); } catch {}
  // Kleine KI-Fehler reparieren: Kommentare, Kommas zu viel/zu wenig
  const fixed = m[0]
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/}\s*{/g, "},{")
    .replace(/([}\]"\d]|true|false|null)(\s*\n\s*")/g, "$1,$2");
  return JSON.parse(fixed);
}

// Fortschritt aus dem halb fertigen JSON lesen (was plant die KI gerade?)
function progressOf(text) {
  const ci = text.indexOf('"categories"');
  const rolesPart = ci === -1 ? text : text.slice(0, ci);
  const catPart = ci === -1 ? "" : text.slice(ci);
  const names = (t) => [...t.matchAll(/"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  const roles = names(rolesPart);
  const channels = (catPart.match(/"type"\s*:/g) || []).length;
  const catNames = names(catPart);
  const categories = Math.max(0, catNames.length - channels);
  let step = "understand", detail = "";
  if (text.includes('"summary"')) step = "summary";
  if (text.includes('"roles"')) { step = "roles"; detail = roles.at(-1) || ""; }
  if (ci !== -1) { step = "channels"; detail = catNames.at(-1) || ""; }
  return { step, detail, roles: roles.length, categories, channels };
}

// ---------- Modelle ----------
const list = (v, d) => (v || d).split(",").map((m) => m.trim()).filter(Boolean);
const ENGINES = {
  fast: { label: "Guildsmith V1 Fast", desc: "Schnell, für die meisten Server",
    models: list(process.env.FAST_MODELS, "gemini-3.5-flash-lite,gemini-3.6-flash"), thinking: "minimal" },
  pro: { label: "Guildsmith V1 Pro", desc: "Gründlicher, für große Server", v2only: true,
    models: list(process.env.PRO_MODELS, "gemini-3.8-flash,gemini-3.6-flash,gemini-3.5-flash-lite"), thinking: process.env.PRO_THINKING ?? "medium" },
  v2: { label: "Guildsmith V2 Beta", desc: "Neueste Engine · 1 Server pro Tag", beta: true, daily: 1,
    models: list(process.env.V2_MODELS, "gemini-3.6-flash,gemini-3.8-flash,gemini-3.5-flash-lite"), thinking: process.env.V2_THINKING ?? "low" },
};

// Tageslimit (pro Discord-Nutzer) in usage.json
import { readFileSync as rf, writeFileSync as wf } from "node:fs";
const today = () => new Date().toISOString().slice(0, 10);
const loadUsage = () => { try { return JSON.parse(rf("usage.json", "utf8")); } catch { return {}; } };
function usedToday(uid, engine) { const u = loadUsage()[uid]; return u?.date === today() ? u[engine] || 0 : 0; }
function addUse(uid, engine) {
  const all = loadUsage();
  const u = all[uid]?.date === today() ? all[uid] : { date: today() };
  u[engine] = (u[engine] || 0) + 1;
  all[uid] = u;
  wf("usage.json", JSON.stringify(all, null, 2));
}

// Kaputtes JSON? Bis zu 2× neu fragen, dabei das nächste Modell zuerst nehmen
async function ask(messages, onProgress = () => {}, engine = ENGINES.fast, tries = 0) {
  try {
    return await askOnce(messages, onProgress, engine);
  } catch (e) {
    if (!(e instanceof SyntaxError) && !/kein JSON/.test(e.message)) throw e;
    if (tries >= 2) throw new Error("Die KI hat zweimal einen fehlerhaften Plan geliefert. Bitte nochmal versuchen.");
    onProgress({ step: "retry", attempt: tries + 1, max: 2, wait: 0 });
    const m = engine.models;
    return ask(messages, onProgress, { ...engine, models: [...m.slice(1), m[0]] }, tries + 1);
  }
}

async function askOnce(messages, onProgress = () => {}, engine = ENGINES.fast) {
  // Bei Überlastung automatisch neu versuchen, danach optional Ersatzmodell
  const models = engine.models;
  // Wenig "Nachdenken" = viel schneller (Standard: minimal)
  const thinking = engine.thinking;
  const makeBody = (withThinking) => JSON.stringify({
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: { responseMimeType: "application/json", ...(withThinking && thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {}) },
  });
  onProgress({ step: "understand" });
  const TRIES = 2; // Versuche pro Modell, danach nächstes Ersatzmodell
  const noThinking = new Set();
  let r, attempt = 0;
  for (;;) {
    const model = models[Math.min(Math.floor(attempt / TRIES), models.length - 1)];
    let status, msg;
    try {
      // Antwortet ein Modell 25 s lang gar nicht, gilt es als überlastet
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: makeBody(!noThinking.has(model)),
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) break;
      const d = await r.json().catch(() => ({}));
      status = r.status;
      msg = d.error?.message || d[0]?.error?.message || "KI-Fehler";
    } catch {
      status = 503; msg = "Zeitüberschreitung";
    }
    // Modell kennt diese Denk-Stufe nicht -> ohne nochmal
    if (status === 400 && /thinking/i.test(msg) && !noThinking.has(model)) { noThinking.add(model); continue; }
    attempt++;
    if (![429, 500, 503].includes(status) || attempt >= TRIES * models.length) {
      throw new Error(status === 503 || status === 429 ? "Guildsmith ist gerade stark ausgelastet. Bitte versuch es in ein paar Minuten nochmal." : msg);
    }
    const wait = attempt % TRIES ? 3 : 1; // kurz warten, beim Modellwechsel fast sofort
    onProgress({ step: "retry", attempt, max: TRIES * models.length, wait });
    await new Promise((ok) => setTimeout(ok, wait * 1000));
    onProgress({ step: "understand" });
  }
  let text = "", buf = "";
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      try {
        const d = JSON.parse(line.slice(5));
        text += d.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text || "").join("") || "";
        onProgress(progressOf(text));
      } catch {}
    }
  }
  onProgress({ step: "check" });
  return parseJson(text);
}

app.get("/api/mode", (_req, res) => res.json(getMode()));
app.use(["/api/plan", "/api/revise", "/api/questions"], requireAuth, (_req, res, next) => {
  const m = getMode();
  if (!m.ai) return res.status(503).json({ error: m.message || "Die KI ist gerade pausiert." });
  next();
});

// ---------- Rückfragen vor dem Planen ----------
const Q_SYSTEM = `Du hilfst, einen Discord-Server zu planen. Der Nutzer beschreibt kurz seinen Server.
Stelle 2 bis 3 kurze Rückfragen auf Deutsch, die den Plan deutlich besser machen (z.B. Größe, Sprache, Stil, wichtige Bereiche) –
aber nur Dinge, die NICHT schon in der Beschreibung stehen. Jede Frage hat 2 bis 4 kurze Antwortmöglichkeiten (max. 5 Wörter).
Antworte NUR mit JSON: {"questions":[{"q":"Frage?","options":["A","B","C"],"multi":false}]}
multi=true nur, wenn mehrere Antworten sinnvoll sind. Ist die Beschreibung schon sehr genau, gib {"questions":[]} zurück.`;

// Allgemeiner KI-Aufruf: System-Text + Nutzertext -> JSON (schnelle Modelle, mit Ersatz)
async function aiJson(system, prompt) {
  let last = "Guildsmith ist gerade ausgelastet. Bitte gleich nochmal versuchen.";
  for (const model of [...ENGINES.v2.models, ...ENGINES.fast.models]) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "low" } },
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) { last = (await r.json().catch(() => ({}))).error?.message || last; continue; }
      const d = await r.json();
      return parseJson(d.candidates?.[0]?.content?.parts?.filter((x) => !x.thought).map((x) => x.text || "").join("") || "");
    } catch (e) { if (e instanceof SyntaxError) last = "Die KI hat ungültige Daten geliefert."; }
  }
  throw new Error(last);
}

app.post("/api/questions", async (req, res) => {
  const prompt = String(req.body.prompt || "").slice(0, 2000);
  for (const model of ENGINES.fast.models) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: Q_SYSTEM }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const out = parseJson(d.candidates?.[0]?.content?.parts?.map((x) => x.text || "").join("") || "");
      const questions = (out.questions || []).slice(0, 3)
        .filter((q) => q.q && Array.isArray(q.options) && q.options.length)
        .map((q) => ({ q: String(q.q), options: q.options.slice(0, 4).map(String), multi: !!q.multi }));
      return res.json({ questions });
    } catch {}
  }
  res.json({ questions: [] }); // Fragen sind optional – lieber direkt planen als abbrechen
});

// Antwort als NDJSON streamen: {type:"progress",...} … {type:"done",plan} oder {type:"error"}
async function streamPlan(res, messages, engine) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (o) => res.write(JSON.stringify(o) + "\n");
  let last = "";
  try {
    const plan = await ask(messages, (p) => {
      const k = JSON.stringify(p);
      if (k !== last) { last = k; send({ type: "progress", ...p }); }
    }, engine);
    send({ type: "done", plan });
  } catch (e) {
    send({ type: "error", error: e.message });
  }
  res.end();
}

// ---------- V2 Pre-Access: Rolle im Guildsmith-Discord ----------
const V2_GUILD = process.env.V2_GUILD_ID;
const V2_ROLE = process.env.V2_ROLE_NAME || "V2 Pre-Access";
const v2Cache = new Map(); // userId -> { ok, at }
let v2RoleId = null;
async function hasV2(uid, fresh) {
  if (isTester(uid)) return true; // Pre-Tester: V2-Zugang für immer
  if (!V2_GUILD) return false;
  const c = v2Cache.get(uid);
  if (!fresh && c && Date.now() - c.at < 60000) return c.ok;
  let ok = false;
  try {
    if (!v2RoleId) v2RoleId = (await discord("GET", `/guilds/${V2_GUILD}/roles`)).find((r) => r.name === V2_ROLE)?.id;
    const m = await discord("GET", `/guilds/${V2_GUILD}/members/${uid}`);
    ok = !!v2RoleId && m.roles.includes(v2RoleId);
    if (ok) markTester(uid, m.roles, m.user);
  } catch {} // nicht auf dem Server = kein Zugang
  v2Cache.set(uid, { ok, at: Date.now() });
  return ok;
}

// ---------- Pre-Tester: wer während der Beta V2 hatte, bleibt es für immer ----------
const TESTER_ROLE = process.env.TESTER_ROLE_NAME || "⭐ Pre-Tester";
let testers = {};
try { testers = JSON.parse(rf("testers.json", "utf8")); } catch {}
let testerRoleId = null;
const isTester = (uid) => !!testers[uid];
async function markTester(uid, roles = [], user) {
  if (!testers[uid]) {
    const n = Object.values(testers).reduce((max, t) => Math.max(max, t.n || 0), 0) + 1;
    testers[uid] = { n, since: new Date().toISOString() };
    console.log(`⭐ Neuer Pre-Tester #${n}:`, user?.username || uid);
  }
  // Nummer nachtragen (ältere Einträge) und Namen aktuell halten
  if (!testers[uid].n) testers[uid].n = Object.values(testers).reduce((max, t) => Math.max(max, t.n || 0), 0) + 1;
  if (user) testers[uid].name = user.global_name || user.username;
  wf("testers.json", JSON.stringify(testers, null, 2));
  try {
    if (!testerRoleId) testerRoleId = (await discord("GET", `/guilds/${V2_GUILD}/roles`)).find((r) => r.name === TESTER_ROLE)?.id;
    if (testerRoleId && !roles.includes(testerRoleId)) await discord("PUT", `/guilds/${V2_GUILD}/members/${uid}/roles/${testerRoleId}`);
  } catch (e) { console.log("⚠ Pre-Tester-Rolle:", e.message); }
}
// Beim Start alle aktuellen V2-Mitglieder als Pre-Tester eintragen
async function syncTesters() {
  if (!V2_GUILD) return;
  try {
    if (!v2RoleId) v2RoleId = (await discord("GET", `/guilds/${V2_GUILD}/roles`)).find((r) => r.name === V2_ROLE)?.id;
    const members = await discord("GET", `/guilds/${V2_GUILD}/members?limit=1000`);
    for (const m of members) if (v2RoleId && m.roles.includes(v2RoleId)) await markTester(m.user.id, m.roles, m.user);
  } catch (e) { console.log("⚠ Pre-Tester-Abgleich:", e.message); }
}
setTimeout(syncTesters, 3000);
setInterval(syncTesters, 10 * 60000);

async function pickEngine(req, res) {
  const key = req.body.engine || "fast";
  const e = ENGINES[key];
  if (!e) { res.status(400).json({ error: "Unbekanntes Modell." }); return null; }
  const v2 = await hasV2(req.sess.user.id);
  if (e.v2only && !v2) { res.status(403).json({ error: `${e.label} ist nur mit V2 Pre-Access verfügbar.` }); return null; }
  return { key, e, v2 };
}

app.get("/api/engines", requireAuth, async (req, res) => {
  const v2 = await hasV2(req.sess.user.id);
  res.json(Object.entries(ENGINES).map(([key, e]) => ({
    key, label: e.label, desc: v2 && e.daily ? "Neueste Engine · unbegrenzt mit Pre-Access" : e.desc,
    locked: !!e.v2only && !v2, beta: !!e.beta, pro: !!e.v2only,
    left: e.daily && !v2 ? Math.max(0, e.daily - usedToday(req.sess.user.id, key)) : null,
  })));
});

// Neuer Plan aus Prompt
app.post("/api/plan", async (req, res) => {
  const p = await pickEngine(req, res);
  if (!p) return;
  const uid = req.sess.user.id;
  if (p.e.daily && !p.v2) {
    if (usedToday(uid, p.key) >= p.e.daily) return res.status(429).json({ error: `Mit ${p.e.label} kannst du nur ${p.e.daily} Server pro Tag erstellen. Morgen geht's wieder – oder nimm V1 Fast.` });
    addUse(uid, p.key);
  }
  streamPlan(res, [{ role: "user", content: req.body.prompt }], p.e);
});

// Plan ändern (zählt nicht zum Tageslimit)
app.post("/api/revise", async (req, res) => {
  const p = await pickEngine(req, res);
  if (!p) return;
  const { prompt, plan, change } = req.body;
  streamPlan(res, [
    { role: "user", content: prompt },
    { role: "assistant", content: JSON.stringify(plan) },
    { role: "user", content: `Ändere den Plan: ${change}
Gib den kompletten neuen Plan als JSON zurück.` },
  ], p.e);
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
app.get("/api/me", requireAuth, async (req, res) => {
  const u = req.sess.user;
  res.json({ id: u.id, name: u.global_name || u.username, avatar: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=64` : null, v2: await hasV2(u.id, req.query.fresh === "1"), tester: testers[u.id] ? { n: testers[u.id].n, since: testers[u.id].since, total: Object.keys(testers).length } : null });
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

// Übersicht eines Servers
app.get("/api/guild/:id/overview", requireAuth, async (req, res) => {
  try {
    const g = (await userGuilds(req.sess)).find((x) => x.id === req.params.id);
    if (!g || !g.installed) return res.status(403).json({ error: "Kein Zugriff." });
    const [info, channels, roles] = await Promise.all([
      discord("GET", `/guilds/${g.id}?with_counts=true`),
      discord("GET", `/guilds/${g.id}/channels`),
      discord("GET", `/guilds/${g.id}/roles`),
    ]);
    res.json({
      name: info.name, icon: g.icon,
      members: info.approximate_member_count, online: info.approximate_presence_count,
      text: channels.filter((c) => c.type === 0 || c.type === 5).length,
      voice: channels.filter((c) => c.type === 2 || c.type === 13).length,
      categories: channels.filter((c) => c.type === 4).length,
      roles: roles.filter((r) => r.id !== g.id && !r.managed).length,
      boosts: info.premium_subscription_count || 0, boostTier: info.premium_tier || 0,
      created: Number((BigInt(g.id) >> 22n) + 1420070400000n),
    });
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
registerFeatureRoutes(app, { requireAuth, userGuilds, discord, hasV2, aiJson });
if (!process.env.NO_BOT) startBot(TOKEN);
app.listen(port, () => console.log(`Läuft auf http://localhost:${port}`)).on("error", (e) => {
  if (e.code === "EADDRINUSE") console.log(`❌ Port ${port} ist schon belegt. Läuft Guildsmith schon in einem anderen Fenster? Dann das zuerst schließen – oder in der .env einen anderen PORT eintragen.`);
  else console.log("❌", e.message);
  process.exit(1);
});
