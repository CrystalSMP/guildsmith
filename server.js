import express from "express";

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
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
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
  if (!r.ok) throw new Error(d.error?.message || "Gemini Fehler");
  return parseJson(d.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "");
}

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

// Server, auf denen der Bot ist
app.get("/api/guilds", async (_req, res) => {
  try {
    res.json(await discord("GET", "/users/@me/guilds"));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/invite", async (_req, res) => {
  try {
    const me = await discord("GET", "/oauth2/applications/@me");
    res.json({ url: `https://discord.com/oauth2/authorize?client_id=${me.id}&scope=bot&permissions=8` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Build: streamt Fortschritt als Text
app.post("/api/build", async (req, res) => {
  const { guildId, plan, wipe } = req.body;
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Läuft auf http://localhost:${port}`));
