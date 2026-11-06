// Custom Bots: Der Nutzer beschreibt, was passieren soll – die KI baut daraus eine Automation
// aus festen, sicheren Bausteinen (Auslöser + Aktionen). Es wird nie fremder Code ausgeführt.
import { ChannelType, EmbedBuilder } from "discord.js";
import { guildData, saveData } from "./features.js";

// ---------- Bausteine ----------
const TRIGGERS = {
  interval: "Alle X Minuten ({minutes}, mind. 10)",
  daily: "Jeden Tag um eine Uhrzeit ({time} \"HH:MM\")",
  weekly: "Jede Woche ({day} 0=So…6=Sa, {time} \"HH:MM\")",
  member_join: "Wenn jemand dem Server beitritt",
  member_leave: "Wenn jemand den Server verlässt",
  message: "Wenn eine Nachricht geschrieben wird ({contains}, {startsWith} oder {equals} – optional {channel})",
  slash_command: "Eigener Slash-Befehl wie /regeln ({command} nur a-z 0-9 - ohne /, {description} kurz auf Deutsch, optional {options}: bis zu 5 Eingabefelder [{\"name\":\"song\",\"description\":\"Name des Songs\",\"type\":\"text|number|user|role|channel\",\"required\":true}]). Optional {staff}: true = nur fürs Team (Nachrichten verwalten) – bei Moderations-Befehlen wie /warn, /ban, /clear IMMER true. Für ALLE Wünsche mit /befehl diesen Auslöser nehmen!",
};
const ACTIONS = {
  send_message: "Nachricht in Kanal senden ({channel}, {text} und/oder {embed})",
  reply: "Antworten – auf die Nachricht bzw. den /Befehl ({text} und/oder {embed}, optional {private}: true = nur für den Nutzer sichtbar)",
  dm_user: "DM schicken ({text} und/oder {embed}, optional {target})",
  add_role: "Rolle geben ({role}, optional {target})",
  remove_role: "Rolle nehmen ({role}, optional {target})",
  timeout_user: "Stummschalten ({minutes}, optional {target})",
  delete_message: "Auslösende Nachricht löschen",
  clear_channel: "Alle Nachrichten der letzten 14 Tage in Kanal löschen ({channel})",
  recreate_channel: "Kanal löschen und identisch neu erstellen – leert ihn komplett ({channel})",
  create_channel: "Neuen Kanal erstellen ({name}, {kind} \"text\" oder \"voice\", optional {category})",
  delete_channel: "Kanal löschen ({channel})",
  rename_channel: "Kanal umbenennen ({channel}, {name})",
};
const USER_ACTIONS = new Set(["reply", "dm_user", "add_role", "remove_role", "timeout_user", "delete_message"]);
const OPT_TYPES = { text: 3, number: 10, user: 6, channel: 7, role: 8 };

export function automationPrompt(meta) {
  return `Du baust "Custom Bots" für Discord-Server. Der Nutzer beschreibt auf Deutsch, was sein Bot automatisch tun soll.
Übersetze das in EINE Automation aus diesen Bausteinen – nichts anderes ist möglich:

AUSLÖSER (trigger.type):
${Object.entries(TRIGGERS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

AKTIONEN (actions[].type), werden der Reihe nach ausgeführt:
${Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

EMBEDS ({embed}): {"title":"…","description":"…","color":"#7c6cff","url":"…","image":"…","thumbnail":"…","footer":"…","fields":[{"name":"…","value":"…","inline":true}]} – alles optional.

PLATZHALTER in allen Texten, Embed-Feldern und Namen:
{user} Erwähnung des Auslösers, {name} sein Name, {avatar} sein Profilbild-Link, {server}, {count} Mitgliederzahl, {date}, {time}
{option:NAME} = Wert eines /Befehl-Eingabefelds (bei user/role/channel als Erwähnung). Für Links/Bilder aus Eingaben z.B. "url":"{option:link}".

ZIELE:
- {target}: "option:NAME" = der Nutzer aus einem user-Eingabefeld, sonst der Auslöser.
- {role}: Rollen-ID, "option:NAME" (role-Eingabe) oder "new:Rollenname" (wird beim Aktivieren erstellt).
- {channel}: Kanal-ID, "option:NAME" (channel-Eingabe) oder "new:kanal-name" (wird beim Aktivieren erstellt).
- Rolle in Text pingen: <@&ROLLEN-ID> oder <@&new:Rollenname>.
Aktionen mit Nutzer (reply, dm_user, add_role, remove_role, timeout_user) gehen nur bei member_join/member_leave/message/slash_command. delete_message nur bei message.

KANÄLE dieses Servers (id: name): ${meta.channels.map((c) => `${c.id}: ${c.type === 2 ? "🔊" : "#"}${c.name}`).join(", ") || "keine"}
KATEGORIEN: ${meta.categories.map((c) => `${c.id}: ${c.name}`).join(", ") || "keine"}
ROLLEN: ${meta.roles.map((r) => `${r.id}: ${r.name}`).join(", ") || "keine"}
Fehlt ein Kanal oder eine Rolle, die der Nutzer will: NICHT ablehnen, sondern mit "new:…" erstellen lassen.

Antworte NUR mit JSON:
{"name":"kurzer Name","summary":"1 Satz auf Deutsch, was der Bot tut","trigger":{"type":"...", ...},"actions":[{"type":"...", ...}]}

Nur wenn der Wunsch NICHTS mit Discord zu tun hat oder missbräuchlich ist (Spam, Raids, Massen-DMs, Daten sammeln, Nutzer belästigen), antworte:
{"error":"kurze, freundliche Erklärung auf Deutsch, was nicht geht und was stattdessen ginge"}`;
}

// ---------- Prüfen ----------
const str = (v, n) => (v == null ? undefined : String(v).slice(0, n));
function cleanEmbed(e) {
  if (!e || typeof e !== "object") return undefined;
  const o = {
    title: str(e.title, 256), description: str(e.description, 4000), url: str(e.url, 500), image: str(e.image, 500),
    thumbnail: str(e.thumbnail, 500), footer: str(e.footer, 200),
    color: /^#?[0-9a-f]{6}$/i.test(String(e.color || "")) ? "#" + String(e.color).replace("#", "") : undefined,
    fields: Array.isArray(e.fields) ? e.fields.slice(0, 10).map((f) => ({ name: str(f.name, 256) || "​", value: str(f.value, 1024) || "​", inline: !!f.inline })) : undefined,
  };
  for (const k of Object.keys(o)) if (o[k] === undefined || o[k] === "") delete o[k];
  if (!o.title && !o.description && !o.fields?.length && !o.image) return undefined;
  return o;
}

export function validateAutomation(a, meta) {
  if (!a || typeof a !== "object") throw new Error("Ungültige Automation.");
  if (a.error) throw new Error(a.error);
  const t = a.trigger || {};
  if (!TRIGGERS[t.type]) throw new Error("Unbekannter Auslöser.");
  const ch = new Set(meta.channels.map((c) => c.id)), cat = new Set(meta.categories.map((c) => c.id)), ro = new Set(meta.roles.map((r) => r.id));
  const trigger = { type: t.type };
  if (t.type === "interval") trigger.minutes = Math.max(10, Math.min(10080, Number(t.minutes) || 60));
  if (t.type === "daily" || t.type === "weekly") {
    if (!/^\d{1,2}:\d{2}$/.test(String(t.time))) throw new Error("Uhrzeit fehlt.");
    trigger.time = String(t.time).padStart(5, "0");
    if (t.type === "weekly") trigger.day = Math.max(0, Math.min(6, Number(t.day) || 0));
  }
  if (t.type === "message") {
    for (const k of ["contains", "startsWith", "equals"]) if (t[k]) trigger[k] = String(t[k]).slice(0, 200);
    if (t.channel && ch.has(t.channel)) trigger.channel = t.channel;
    if (!trigger.contains && !trigger.startsWith && !trigger.equals) throw new Error("Bei Nachrichten-Auslösern fehlt der Text, auf den reagiert werden soll.");
  }
  const opts = new Map(); // name -> type
  if (t.type === "slash_command") {
    const cmd = String(t.command || "").toLowerCase().replace(/^\//, "").replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    if (!cmd) throw new Error("Der Befehl braucht einen Namen.");
    trigger.command = cmd;
    trigger.description = String(t.description || "Custom Befehl").slice(0, 100);
    if (t.staff) trigger.staff = true;
    trigger.options = (Array.isArray(t.options) ? t.options : []).slice(0, 5).map((o) => {
      const name = String(o.name || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9_-]/g, "").slice(0, 32);
      const type = OPT_TYPES[o.type] ? o.type : "text";
      if (!name || opts.has(name)) return null;
      opts.set(name, type);
      return { name, description: String(o.description || name).slice(0, 100), type, required: o.required !== false };
    }).filter(Boolean)
      .sort((x, y) => y.required - x.required); // Pflichtfelder müssen bei Discord zuerst kommen
  }
  const optOf = (v, type) => {
    const m = /^option:(.+)$/.exec(String(v || ""));
    if (!m) return null;
    if (opts.get(m[1]) !== type) throw new Error(`Das Eingabefeld „${m[1]}“ muss vom Typ ${type} sein.`);
    return "option:" + m[1];
  };
  const isNew = (v) => /^new:.{1,90}$/.test(String(v || ""));
  const withUser = ["member_join", "member_leave", "message", "slash_command"].includes(t.type);

  const actions = (a.actions || []).slice(0, 8).map((x) => {
    if (!ACTIONS[x.type]) throw new Error(`Unbekannte Aktion „${x.type}“.`);
    const o = { type: x.type };
    if (x.target) { o.target = optOf(x.target, "user"); if (!o.target) delete o.target; }
    if (USER_ACTIONS.has(x.type) && !withUser && !o.target) throw new Error(`„${x.type}“ geht nur, wenn ein Nutzer etwas auslöst.`);
    if (x.type === "delete_message" && t.type !== "message") throw new Error("Nachricht löschen geht nur bei Nachrichten.");
    if (x.type === "reply" && !["message", "slash_command"].includes(t.type)) throw new Error("Antworten geht nur bei Nachrichten oder /Befehlen.");
    if ("channel" in x || ["send_message", "clear_channel", "recreate_channel", "delete_channel", "rename_channel"].includes(x.type)) {
      if (ch.has(x.channel) || isNew(x.channel)) o.channel = x.channel;
      else o.channel = optOf(x.channel, "channel");
      if (!o.channel) throw new Error("Ein Kanal aus der Automation existiert nicht.");
    }
    if (["add_role", "remove_role"].includes(x.type)) {
      if (ro.has(x.role) || isNew(x.role)) o.role = x.role; else o.role = optOf(x.role, "role");
      if (!o.role) throw new Error("Eine Rolle aus der Automation existiert nicht.");
    }
    if (x.text != null && x.text !== "") o.text = String(x.text).slice(0, 1900);
    const em = cleanEmbed(x.embed);
    if (em) o.embed = em;
    if (["send_message", "reply", "dm_user"].includes(x.type) && !o.text && !o.embed) throw new Error("Eine Nachricht hat keinen Inhalt.");
    if (x.name != null) o.name = String(x.name).slice(0, 90);
    if (x.type === "create_channel") {
      o.kind = x.kind === "voice" || x.type2 === "voice" ? "voice" : "text";
      if (x.category && cat.has(x.category)) o.category = x.category;
      if (!o.name) throw new Error("Neuer Kanal braucht einen Namen.");
    }
    if (x.type === "rename_channel" && !o.name) throw new Error("Neuer Kanalname fehlt.");
    if (x.type === "reply" && x.private) o.private = true;
    if (x.type === "timeout_user") o.minutes = Math.max(1, Math.min(10080, Number(x.minutes) || 10));
    return o;
  });
  if (!actions.length) throw new Error("Die Automation hat keine Aktionen.");
  return { name: String(a.name || "Custom Bot").slice(0, 60), summary: String(a.summary || "").slice(0, 300), trigger, actions };
}

// Alles mit "new:…" (Kanäle/Rollen) beim Aktivieren wirklich erstellen und durch IDs ersetzen
export async function materialize(a, gid, discord) {
  const made = new Map();
  const make = async (kind, name) => {
    const key = kind + name;
    if (!made.has(key)) {
      const r = kind === "role"
        ? await discord("POST", `/guilds/${gid}/roles`, { name, mentionable: true })
        : await discord("POST", `/guilds/${gid}/channels`, { name, type: 0 });
      made.set(key, r.id);
    }
    return made.get(key);
  };
  for (const x of a.actions) {
    if (/^new:/.test(x.channel || "")) x.channel = await make("channel", x.channel.slice(4));
    if (/^new:/.test(x.role || "")) x.role = await make("role", x.role.slice(4));
  }
  // Rollen-Pings <@&new:Name> in Texten
  const fix = async (s) => {
    if (typeof s !== "string") return s;
    for (const m of [...s.matchAll(/<@&new:([^>]{1,90})>/g)]) s = s.replace(m[0], `<@&${await make("role", m[1])}>`);
    return s;
  };
  for (const x of a.actions) {
    x.text = await fix(x.text);
    if (x.embed) for (const k of ["title", "description", "footer"]) x.embed[k] = await fix(x.embed[k]);
    if (x.embed?.fields) for (const f of x.embed.fields) f.value = await fix(f.value);
  }
  return a;
}

// ---------- Ausführen ----------
const pad = (n) => String(n).padStart(2, "0");
function optionValue(ctx, name, raw) {
  const o = ctx.interaction?.options?.get(name);
  if (!o) return "";
  if (raw) return o.value;
  if (o.type === 6) return `<@${o.value}>`;
  if (o.type === 8) return `<@&${o.value}>`;
  if (o.type === 7) return `<#${o.value}>`;
  return String(o.value);
}
function fillText(t, ctx) {
  if (t == null) return t;
  const now = new Date();
  return String(t)
    .replace(/\{option:([a-z0-9_-]+)\}/g, (_, n) => optionValue(ctx, n))
    .replaceAll("{user}", ctx.user ? `<@${ctx.user.id}>` : "")
    .replaceAll("{name}", ctx.user?.globalName || ctx.user?.username || "")
    .replaceAll("{avatar}", ctx.user?.displayAvatarURL?.({ size: 256 }) || "")
    .replaceAll("{server}", ctx.guild.name)
    .replaceAll("{count}", String(ctx.guild.memberCount))
    .replaceAll("{date}", now.toLocaleDateString("de-DE"))
    .replaceAll("{time}", `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}
const isUrl = (u) => /^https?:\/\/\S+$/i.test(u || "");
function buildEmbed(e, ctx) {
  if (!e) return null;
  const b = new EmbedBuilder().setColor(e.color ? parseInt(e.color.slice(1), 16) : 0x7c6cff);
  const f = (k) => fillText(e[k], ctx);
  if (e.title) b.setTitle(f("title").slice(0, 256));
  if (e.description) b.setDescription(f("description").slice(0, 4000));
  if (isUrl(f("url"))) b.setURL(f("url"));
  if (isUrl(f("image"))) b.setImage(f("image"));
  if (isUrl(f("thumbnail"))) b.setThumbnail(f("thumbnail"));
  if (e.footer) b.setFooter({ text: f("footer").slice(0, 2048) });
  if (e.fields) b.addFields(e.fields.map((x) => ({ name: fillText(x.name, ctx).slice(0, 256) || "​", value: fillText(x.value, ctx).slice(0, 1024) || "​", inline: x.inline })));
  return b;
}
function payload(a, ctx) {
  const p = {};
  if (a.text) p.content = fillText(a.text, ctx);
  const em = buildEmbed(a.embed, ctx);
  if (em) p.embeds = [em];
  return p;
}

async function resolveTarget(a, ctx) {
  if (!a.target) return { member: ctx.member, user: ctx.user };
  const id = optionValue(ctx, a.target.slice(7), true);
  const member = id ? await ctx.guild.members.fetch(id).catch(() => null) : null;
  return { member, user: member?.user };
}
const resolveId = (v, ctx) => (String(v || "").startsWith("option:") ? optionValue(ctx, v.slice(7), true) : v);

async function runActions(client, guild, auto, ctx = {}) {
  ctx.guild = guild;
  const log = [];
  for (const a of auto.actions) {
    try {
      const chId = resolveId(a.channel, ctx);
      const ch = chId ? await guild.channels.fetch(chId).catch(() => null) : null;
      const tgt = USER_ACTIONS.has(a.type) ? await resolveTarget(a, ctx) : {};
      switch (a.type) {
        case "send_message": if (!ch) throw new Error("Kanal nicht gefunden"); await ch.send(payload(a, ctx)); break;
        case "reply":
          if (ctx.interaction) {
            const p = { ...payload(a, ctx), ephemeral: !!a.private };
            if (ctx.interaction.replied || ctx.interaction.deferred) await ctx.interaction.followUp(p); else await ctx.interaction.reply(p);
          } else await ctx.message?.reply(payload(a, ctx));
          break;
        case "dm_user": await tgt.user?.send(payload(a, ctx)); break;
        case "add_role": await tgt.member?.roles.add(resolveId(a.role, ctx)); break;
        case "remove_role": await tgt.member?.roles.remove(resolveId(a.role, ctx)); break;
        case "timeout_user": await tgt.member?.timeout(a.minutes * 60000, `Custom Bot: ${auto.name}`); break;
        case "delete_message": await ctx.message?.delete(); break;
        case "clear_channel": {
          if (!ch?.isTextBased()) break;
          for (let i = 0; i < 10; i++) {
            const msgs = await ch.messages.fetch({ limit: 100 });
            const del = msgs.filter((m) => !m.pinned && Date.now() - m.createdTimestamp < 13.9 * 864e5);
            if (!del.size) break;
            await ch.bulkDelete(del, true);
          }
          break;
        }
        case "recreate_channel": {
          if (!ch) break;
          const copy = await ch.clone({ reason: `Custom Bot: ${auto.name}` });
          await copy.setPosition(ch.position).catch(() => {});
          await ch.delete(`Custom Bot: ${auto.name}`);
          replaceChannelId(guild.id, ch.id, copy.id);
          break;
        }
        case "create_channel":
          await guild.channels.create({ name: fillText(a.name, ctx), type: (a.kind || a.type2) === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText, parent: a.category || null });
          break;
        case "delete_channel": await ch?.delete(`Custom Bot: ${auto.name}`); break;
        case "rename_channel": await ch?.setName(fillText(a.name, ctx)); break;
      }
      log.push(`✓ ${a.type}`);
    } catch (e) {
      log.push(`✗ ${a.type}: ${e.message}`);
    }
  }
  // /Befehl ohne eigene Antwort: kurz bestätigen, sonst zeigt Discord "Die Anwendung reagiert nicht"
  if (ctx.interaction && !ctx.interaction.replied && !ctx.interaction.deferred) {
    const bad = log.filter((l) => l.startsWith("✗"));
    await ctx.interaction.reply({ content: bad.length ? `⚠️ Das hat nicht ganz geklappt: ${bad.join(", ").slice(0, 300)}` : "✅ Erledigt!", ephemeral: true }).catch(() => {});
  }
  const g = guildData(guild.id);
  const stored = g.automations.find((x) => x.id === auto.id);
  if (stored) { stored.lastRun = Date.now(); stored.runs = (stored.runs || 0) + 1; stored.lastLog = log; saveData(); }
  return log;
}

// Nach "Kanal neu erstellen" bekommt der Kanal eine neue ID – überall nachziehen
function replaceChannelId(gid, oldId, newId) {
  for (const a of guildData(gid).automations) {
    if (a.trigger.channel === oldId) a.trigger.channel = newId;
    for (const x of a.actions) if (x.channel === oldId) x.channel = newId;
  }
  saveData();
}

// Slash-Befehle eines Servers bei Discord registrieren
let botClient = null;
export async function syncCommands(gid) {
  if (!botClient?.isReady()) return;
  const cmds = new Map();
  for (const a of guildData(gid).automations)
    if (a.enabled && a.trigger.type === "slash_command" && !cmds.has(a.trigger.command))
      cmds.set(a.trigger.command, {
        name: a.trigger.command, description: a.trigger.description || "Custom Befehl", type: 1,
        default_member_permissions: a.trigger.staff ? "8192" : null,
        options: (a.trigger.options || []).map((o) => ({ name: o.name, description: o.description, type: OPT_TYPES[o.type] || 3, required: !!o.required })),
      });
  try {
    await botClient.application.commands.set([...cmds.values()], gid);
  } catch (e) { console.log("⚠ Slash-Befehle:", e.message); throw new Error("Discord hat den /Befehl abgelehnt: " + e.message); }
}

export function setupAutomations(client, full, allGuildIds) {
  botClient = client;
  client.once("clientReady", () => { for (const gid of allGuildIds()) if (client.guilds.cache.has(gid)) syncCommands(gid).catch(() => {}); });
  client.on("interactionCreate", async (i) => {
    if (!i.isChatInputCommand() || !i.guild) return;
    const a = guildData(i.guild.id).automations.find((x) => x.enabled && x.trigger.type === "slash_command" && x.trigger.command === i.commandName);
    if (!a) return i.reply({ content: "Dieser Befehl ist nicht mehr aktiv.", ephemeral: true }).catch(() => {});
    runActions(client, i.guild, a, { guild: i.guild, member: i.member, user: i.user, interaction: i }).catch(() => {});
  });

  // Zeit-Auslöser: alle 30 Sekunden prüfen
  setInterval(() => {
    const now = new Date();
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    for (const gid of allGuildIds()) {
      const guild = client.guilds.cache.get(gid);
      if (!guild) continue;
      for (const a of guildData(gid).automations) {
        if (!a.enabled) continue;
        const t = a.trigger, last = a.lastRun || 0;
        let due = false;
        if (t.type === "interval") due = Date.now() - last >= t.minutes * 60000;
        if (t.type === "daily") due = hm === t.time && Date.now() - last > 120000;
        if (t.type === "weekly") due = now.getDay() === t.day && hm === t.time && Date.now() - last > 120000;
        if (due) { a.lastRun = Date.now(); runActions(client, guild, a).catch(() => {}); }
      }
    }
  }, 30000);

  if (!full) return;
  const on = (type, ctxOf) => async (...args) => {
    const ctx = ctxOf(...args);
    if (!ctx?.guild) return;
    for (const a of guildData(ctx.guild.id).automations) {
      if (!a.enabled || a.trigger.type !== type) continue;
      if (type === "message") {
        const t = a.trigger, c = ctx.message.content.toLowerCase();
        if (t.channel && t.channel !== ctx.message.channel.id) continue;
        if (t.equals && c.trim() !== t.equals.toLowerCase()) continue;
        if (t.startsWith && !c.startsWith(t.startsWith.toLowerCase())) continue;
        if (t.contains && !c.includes(t.contains.toLowerCase())) continue;
      }
      runActions(client, ctx.guild, a, ctx).catch(() => {});
    }
  };
  client.on("guildMemberAdd", on("member_join", (m) => ({ guild: m.guild, member: m, user: m.user })));
  client.on("guildMemberRemove", on("member_leave", (m) => ({ guild: m.guild, member: null, user: m.user })));
  client.on("messageCreate", on("message", (msg) => msg.guild && !msg.author.bot ? { guild: msg.guild, member: msg.member, user: msg.author, message: msg } : null));
}

export { runActions };

// ---------- Anzeige im Dashboard ----------
export function describe(a, meta) {
  const chn = (id) => String(id).startsWith("new:") ? `#${id.slice(4)} (wird erstellt)` : String(id).startsWith("option:") ? `[Kanal aus „${id.slice(7)}“]` : "#" + (meta.channels.find((c) => c.id === id)?.name || "gelöschter-kanal");
  const rol = (id) => String(id).startsWith("new:") ? `@${id.slice(4)} (wird erstellt)` : String(id).startsWith("option:") ? `[Rolle aus „${id.slice(7)}“]` : "@" + (meta.roles.find((r) => r.id === id)?.name || "gelöschte-rolle");
  const who = (x) => (x.target ? ` an [Nutzer aus „${x.target.slice(7)}“]` : "");
  const pretty = (s) => String(s || "")
    .replace(/<@&new:([^>]+)>/g, "@$1")
    .replace(/<@&(\d+)>/g, (_, id) => "@" + (meta.roles.find((r) => r.id === id)?.name || "rolle"))
    .replace(/<#(\d+)>/g, (_, id) => "#" + (meta.channels.find((c) => c.id === id)?.name || "kanal"));
  const content = (x) => [x.text && `„${pretty(x.text)}“`, x.embed && `📋 Embed „${pretty(x.embed.title || x.embed.description || "")}“`].filter(Boolean).join(" + ");
  const days = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const t = a.trigger;
  const when = {
    interval: `Alle ${t.minutes >= 60 && t.minutes % 60 === 0 ? t.minutes / 60 + " Std." : t.minutes + " Min."}`,
    daily: `Jeden Tag um ${t.time} Uhr`,
    weekly: `Jeden ${days[t.day]} um ${t.time} Uhr`,
    member_join: "Wenn jemand beitritt",
    member_leave: "Wenn jemand geht",
    slash_command: `/${t.command}${(t.options || []).map((o) => ` ${o.required ? "<" : "["}${o.name}${o.required ? ">" : "]"}`).join("")} – ${t.description || ""}${t.staff ? " (nur Team)" : ""}`,
    message: `Wenn eine Nachricht ${t.equals ? `„${t.equals}“ ist` : t.startsWith ? `mit „${t.startsWith}“ beginnt` : `„${t.contains}“ enthält`}${t.channel ? ` in ${chn(t.channel)}` : ""}`,
  }[t.type];
  const what = a.actions.map((x) => ({
    send_message: `💬 In ${chn(x.channel)}: ${content(x)}`,
    reply: `↩ Antworten${x.private ? " (nur für den Nutzer)" : ""}: ${content(x)}`,
    dm_user: `✉ DM${who(x)}: ${content(x)}`,
    add_role: `➕ Rolle ${rol(x.role)} geben${who(x)}`,
    remove_role: `➖ Rolle ${rol(x.role)} nehmen${who(x)}`,
    timeout_user: `🔇 ${x.minutes} Min. stummschalten${who(x)}`,
    delete_message: "🗑 Nachricht löschen",
    clear_channel: `🧹 ${chn(x.channel)} leeren`,
    recreate_channel: `♻ ${chn(x.channel)} löschen & neu erstellen`,
    create_channel: `➕ Kanal „${x.name}“ erstellen`,
    delete_channel: `🗑 ${chn(x.channel)} löschen`,
    rename_channel: `✏ ${chn(x.channel)} umbenennen in „${x.name}“`,
  }[x.type]));
  return { when, what };
}
