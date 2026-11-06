// Custom Bots: Der Nutzer beschreibt, was passieren soll – die KI baut daraus eine Automation
// aus festen, sicheren Bausteinen (Auslöser + Aktionen). Es wird nie fremder Code ausgeführt.
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { guildData, saveData } from "./features.js";

// ---------- Bausteine ----------
const TRIGGERS = {
  interval: "Alle X Minuten ({minutes}, mind. 10)",
  daily: "Jeden Tag um eine Uhrzeit ({time} \"HH:MM\")",
  weekly: "Jede Woche ({day} 0=So…6=Sa, {time} \"HH:MM\")",
  member_join: "Wenn jemand dem Server beitritt",
  member_leave: "Wenn jemand den Server verlässt",
  message: "Wenn eine Nachricht geschrieben wird ({contains}, {startsWith} oder {equals} – optional {channel})",
  slash_command: "Eigener Slash-Befehl, z.B. /regeln ({command} nur kleine Buchstaben/Zahlen/-, OHNE /, {description} kurz auf Deutsch). Für ALLE Wünsche mit /befehl immer diesen Auslöser nehmen!",
};
const ACTIONS = {
  send_message: "Nachricht in Kanal senden ({channel}, {text})",
  reply: "Auf die auslösende Nachricht antworten ({text})",
  dm_user: "Dem auslösenden Nutzer eine DM schicken ({text})",
  add_role: "Dem auslösenden Nutzer eine Rolle geben ({role})",
  remove_role: "Dem auslösenden Nutzer eine Rolle nehmen ({role})",
  timeout_user: "Auslösenden Nutzer stummschalten ({minutes})",
  delete_message: "Auslösende Nachricht löschen",
  clear_channel: "Alle Nachrichten der letzten 14 Tage in Kanal löschen ({channel})",
  recreate_channel: "Kanal löschen und identisch neu erstellen – leert ihn komplett ({channel})",
  create_channel: "Neuen Kanal erstellen ({name}, {kind} \"text\" oder \"voice\", optional {category})",
  delete_channel: "Kanal löschen ({channel})",
  rename_channel: "Kanal umbenennen ({channel}, {name})",
};
const NEEDS_USER = new Set(["reply", "dm_user", "add_role", "remove_role", "timeout_user", "delete_message"]);
const NEEDS_MESSAGE = new Set(["delete_message"]);

export function automationPrompt(meta) {
  return `Du baust "Custom Bots" für Discord-Server. Der Nutzer beschreibt auf Deutsch, was sein Bot automatisch tun soll.
Übersetze das in EINE Automation aus diesen Bausteinen – nichts anderes ist möglich:

AUSLÖSER (trigger.type):
${Object.entries(TRIGGERS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

AKTIONEN (actions[].type), werden der Reihe nach ausgeführt:
${Object.entries(ACTIONS).map(([k, v]) => `- ${k}: ${v}`).join("\n")}

Platzhalter in Texten/Namen: {user} (Erwähnung), {name}, {server}, {count} (Mitgliederzahl), {date}, {time}.
Aktionen mit Nutzer (reply, dm_user, add_role, remove_role, timeout_user) gehen nur bei member_join/member_leave/message/slash_command.
delete_message geht nur bei message. Bei slash_command ist reply die Antwort auf den Befehl (optional {private}: true = nur für den Nutzer sichtbar).

KANÄLE dieses Servers (id: name): ${meta.channels.map((c) => `${c.id}: ${c.type === 2 ? "🔊" : "#"}${c.name}`).join(", ") || "keine"}
KATEGORIEN: ${meta.categories.map((c) => `${c.id}: ${c.name}`).join(", ") || "keine"}
ROLLEN: ${meta.roles.map((r) => `${r.id}: ${r.name}`).join(", ") || "keine"}
Benutze für {channel}, {category} und {role} immer die ID aus den Listen.

Antworte NUR mit JSON:
{"name":"kurzer Name","summary":"1 Satz auf Deutsch, was der Bot tut","trigger":{"type":"...", ...},"actions":[{"type":"...", ...}]}

Wenn der Wunsch NICHTS mit Discord zu tun hat, gefährlich/missbräuchlich ist (Spam, Raids, Massen-DMs, Daten sammeln) oder mit den Bausteinen nicht geht, antworte:
{"error":"kurze, freundliche Erklärung auf Deutsch, was nicht geht und was stattdessen ginge"}
Wenn ein Kanal/eine Rolle fehlt, die der Nutzer meint, nutze create_channel oder erkläre es im error.`;
}

// Prüft und säubert eine KI-Automation, damit nur erlaubte Werte gespeichert werden
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
  if (t.type === "slash_command") {
    const cmd = String(t.command || "").toLowerCase().replace(/^\//, "").replace(/[^a-z0-9_-]/g, "").slice(0, 32);
    if (!cmd) throw new Error("Der Befehl braucht einen Namen.");
    trigger.command = cmd;
    trigger.description = String(t.description || "Custom Befehl").slice(0, 100);
  }
  const withUser = ["member_join", "member_leave", "message", "slash_command"].includes(t.type);
  const actions = (a.actions || []).slice(0, 8).map((x) => {
    if (!ACTIONS[x.type]) throw new Error(`Unbekannte Aktion „${x.type}“.`);
    if (NEEDS_USER.has(x.type) && !withUser) throw new Error(`„${x.type}“ geht nur, wenn ein Nutzer etwas auslöst.`);
    if (NEEDS_MESSAGE.has(x.type) && t.type !== "message") throw new Error(`„${x.type}“ geht nur bei Nachrichten.`);
    if (x.type === "reply" && !["message", "slash_command"].includes(t.type)) throw new Error("Antworten geht nur bei Nachrichten oder /Befehlen.");
    const o = { type: x.type };
    if ("channel" in x || ["send_message", "clear_channel", "recreate_channel", "delete_channel", "rename_channel"].includes(x.type)) {
      if (!ch.has(x.channel)) throw new Error("Ein Kanal aus der Automation existiert nicht.");
      o.channel = x.channel;
    }
    if (["add_role", "remove_role"].includes(x.type)) { if (!ro.has(x.role)) throw new Error("Eine Rolle aus der Automation existiert nicht."); o.role = x.role; }
    if (x.text != null) o.text = String(x.text).slice(0, 1800);
    if (["send_message", "reply", "dm_user"].includes(x.type) && !o.text) throw new Error("Eine Nachricht hat keinen Text.");
    if (x.name != null) o.name = String(x.name).slice(0, 90);
    if (x.type === "create_channel") { o.type2 = x.type2 === "voice" || x.channelType === "voice" || x.kind === "voice" ? "voice" : "text"; if (x.category && cat.has(x.category)) o.category = x.category; if (!o.name) throw new Error("Neuer Kanal braucht einen Namen."); }
    if (x.type === "rename_channel" && !o.name) throw new Error("Neuer Kanalname fehlt.");
    if (x.type === "reply" && x.private) o.private = true;
    if (x.type === "timeout_user") o.minutes = Math.max(1, Math.min(10080, Number(x.minutes) || 10));
    return o;
  });
  if (!actions.length) throw new Error("Die Automation hat keine Aktionen.");
  return { name: String(a.name || "Custom Bot").slice(0, 60), summary: String(a.summary || "").slice(0, 300), trigger, actions };
}

// ---------- Ausführen ----------
const pad = (n) => String(n).padStart(2, "0");
function fillText(t, ctx) {
  const now = new Date();
  return String(t || "")
    .replaceAll("{user}", ctx.user ? `<@${ctx.user.id}>` : "")
    .replaceAll("{name}", ctx.user?.username || "")
    .replaceAll("{server}", ctx.guild.name)
    .replaceAll("{count}", String(ctx.guild.memberCount))
    .replaceAll("{date}", now.toLocaleDateString("de-DE"))
    .replaceAll("{time}", `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

async function runActions(client, guild, auto, ctx = {}) {
  ctx.guild = guild;
  const log = [];
  for (const a of auto.actions) {
    try {
      const ch = a.channel ? await guild.channels.fetch(a.channel).catch(() => null) : null;
      switch (a.type) {
        case "send_message": await ch?.send(fillText(a.text, ctx)); break;
        case "reply":
          if (ctx.interaction) {
            const payload = { content: fillText(a.text, ctx), ephemeral: !!a.private };
            if (ctx.interaction.replied || ctx.interaction.deferred) await ctx.interaction.followUp(payload); else await ctx.interaction.reply(payload);
          } else await ctx.message?.reply(fillText(a.text, ctx));
          break;
        case "dm_user": await ctx.user?.send(fillText(a.text, ctx)); break;
        case "add_role": await ctx.member?.roles.add(a.role); break;
        case "remove_role": await ctx.member?.roles.remove(a.role); break;
        case "timeout_user": await ctx.member?.timeout(a.minutes * 60000, `Custom Bot: ${auto.name}`); break;
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
          await guild.channels.create({ name: fillText(a.name, ctx), type: a.type2 === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText, parent: a.category || null });
          break;
        case "delete_channel": await ch?.delete(`Custom Bot: ${auto.name}`); break;
        case "rename_channel": await ch?.setName(fillText(a.name, ctx)); break;
      }
      log.push(`✓ ${a.type}`);
    } catch (e) {
      log.push(`✗ ${a.type}: ${e.message}`);
    }
  }
  // Slash-Befehl ohne eigene Antwort: kurz bestätigen, sonst zeigt Discord "Die Anwendung reagiert nicht"
  if (ctx.interaction && !ctx.interaction.replied && !ctx.interaction.deferred) {
    await ctx.interaction.reply({ content: log.some((l) => l.startsWith("✗")) ? "⚠️ Das hat nicht ganz geklappt." : "✅ Erledigt!", ephemeral: true }).catch(() => {});
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

// Slash-Befehle eines Servers bei Discord registrieren (überschreibt nur Guildsmith-Befehle)
let botClient = null;
export async function syncCommands(gid) {
  if (!botClient?.isReady()) return;
  const cmds = new Map();
  for (const a of guildData(gid).automations)
    if (a.enabled && a.trigger.type === "slash_command" && !cmds.has(a.trigger.command))
      cmds.set(a.trigger.command, { name: a.trigger.command, description: a.trigger.description || "Custom Befehl", type: 1 });
  try {
    await botClient.application.commands.set([...cmds.values()], gid);
  } catch (e) { console.log("⚠ Slash-Befehle:", e.message); }
}

export function setupAutomations(client, full, allGuildIds) {
  botClient = client;
  client.once("clientReady", () => { for (const gid of allGuildIds()) if (client.guilds.cache.has(gid)) syncCommands(gid); });
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

// Text für die Anzeige im Dashboard
export function describe(a, meta) {
  const chn = (id) => "#" + (meta.channels.find((c) => c.id === id)?.name || "gelöschter-kanal");
  const rol = (id) => "@" + (meta.roles.find((r) => r.id === id)?.name || "gelöschte-rolle");
  const days = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
  const t = a.trigger;
  const when = {
    interval: `Alle ${t.minutes >= 60 && t.minutes % 60 === 0 ? t.minutes / 60 + " Std." : t.minutes + " Min."}`,
    daily: `Jeden Tag um ${t.time} Uhr`,
    weekly: `Jeden ${days[t.day]} um ${t.time} Uhr`,
    member_join: "Wenn jemand beitritt",
    member_leave: "Wenn jemand geht",
    slash_command: `Befehl /${t.command}${t.description ? ` – ${t.description}` : ""}`,
    message: `Wenn eine Nachricht ${t.equals ? `„${t.equals}“ ist` : t.startsWith ? `mit „${t.startsWith}“ beginnt` : `„${t.contains}“ enthält`}${t.channel ? ` in ${chn(t.channel)}` : ""}`,
  }[t.type];
  const what = a.actions.map((x) => ({
    send_message: `💬 Nachricht in ${chn(x.channel)}: „${x.text}“`,
    reply: `↩ Antworten${x.private ? " (nur für den Nutzer)" : ""}: „${x.text}“`,
    dm_user: `✉ DM: „${x.text}“`,
    add_role: `➕ Rolle ${rol(x.role)} geben`,
    remove_role: `➖ Rolle ${rol(x.role)} nehmen`,
    timeout_user: `🔇 ${x.minutes} Min. stummschalten`,
    delete_message: "🗑 Nachricht löschen",
    clear_channel: `🧹 ${chn(x.channel)} leeren`,
    recreate_channel: `♻ ${chn(x.channel)} löschen & neu erstellen`,
    create_channel: `➕ Kanal „${x.name}“ erstellen`,
    delete_channel: `🗑 ${chn(x.channel)} löschen`,
    rename_channel: `✏ ${chn(x.channel)} umbenennen in „${x.name}“`,
  }[x.type]));
  return { when, what };
}
