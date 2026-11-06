// Alle Dashboard-Features: Bot-Logik + API-Routen.
// Daten liegen in data.json (pro Server).
import { readFileSync, writeFileSync } from "node:fs";
import { setupAutomations, automationPrompt, validateAutomation, describe, runActions, syncCommands } from "./automations.js";
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits,
} from "discord.js";

// ---------- Speicher ----------
const FILE = "data.json";
let db = {};
try { db = JSON.parse(readFileSync(FILE, "utf8")); } catch {}
let saveTimer = null;
const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => writeFileSync(FILE, JSON.stringify(db, null, 1)), 300); };

const DEFAULTS = {
  welcome: { enabled: false, channel: "", message: "Willkommen {user} auf **{server}**! 🎉 Du bist Mitglied Nr. {count}.", dm: false, leaveEnabled: false, leaveMessage: "{name} hat den Server verlassen. 👋" },
  autoroles: { enabled: false, roles: [] },
  verify: { enabled: false, channel: "", role: "", title: "Verifizierung", text: "Klicke auf den Button, um dich zu verifizieren und den Server freizuschalten." },
  tickets: { enabled: false, channel: "", category: "", staffRole: "", title: "Support", text: "Brauchst du Hilfe? Klicke unten, um ein Ticket zu öffnen.", count: 0 },
  xp: { enabled: false, channel: "", message: "🎉 {user} ist jetzt **Level {level}**!", rewards: [] },
  automod: { enabled: false, invites: true, links: false, caps: false, words: [], logChannel: "" },
};

export const saveData = () => save();

export function guildData(id) {
  const g = (db[id] ||= {});
  for (const [k, v] of Object.entries(DEFAULTS)) g[k] = { ...structuredClone(v), ...(g[k] || {}) };
  g.xpUsers ||= {}; g.stats ||= {}; g.polls ||= {}; g.giveaways ||= {}; g.backups ||= []; g.automations ||= [];
  return g;
}

const day = () => new Date().toISOString().slice(0, 10);
function stat(gid, key, n = 1) {
  const s = guildData(gid).stats;
  const d = (s[day()] ||= { joins: 0, leaves: 0, messages: 0 });
  d[key] += n;
  // nur 90 Tage behalten
  const keys = Object.keys(s).sort();
  while (keys.length > 90) delete s[keys.shift()];
  save();
}

const fill = (t, m, extra = {}) => String(t || "")
  .replaceAll("{user}", `<@${m.id}>`).replaceAll("{name}", m.user?.username || m.displayName || "")
  .replaceAll("{server}", m.guild.name).replaceAll("{count}", m.guild.memberCount)
  .replace(/\{(\w+)\}/g, (all, k) => (k in extra ? extra[k] : all));
const levelFor = (xp) => Math.floor(Math.sqrt(xp / 100));
const xpForLevel = (l) => l * l * 100;

// ---------- Bot ----------
let client = null;
export function setupFeatures(c, full) {
  client = c;
  setupAutomations(c, full, () => Object.keys(db));
  if (full) {
    c.on("guildMemberAdd", async (m) => {
      stat(m.guild.id, "joins");
      const g = guildData(m.guild.id);
      if (g.autoroles.enabled && g.autoroles.roles.length) m.roles.add(g.autoroles.roles).catch(() => {});
      if (g.welcome.enabled) {
        const text = fill(g.welcome.message, m);
        const ch = m.guild.channels.cache.get(g.welcome.channel);
        if (ch) ch.send({ embeds: [new EmbedBuilder().setColor(0x7c6cff).setDescription(text).setThumbnail(m.user.displayAvatarURL())] }).catch(() => {});
        if (g.welcome.dm) m.send(text).catch(() => {});
      }
    });
    c.on("guildMemberRemove", (m) => {
      stat(m.guild.id, "leaves");
      const g = guildData(m.guild.id);
      if (g.welcome.leaveEnabled) m.guild.channels.cache.get(g.welcome.channel)?.send(fill(g.welcome.leaveMessage, m)).catch(() => {});
    });
    const cooldown = new Map();
    c.on("messageCreate", async (msg) => {
      if (!msg.guild || msg.author.bot) return;
      stat(msg.guild.id, "messages");
      const g = guildData(msg.guild.id);
      // Auto-Moderation
      if (g.automod.enabled && !msg.member?.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const t = msg.content, low = t.toLowerCase();
        let reason = null;
        if (g.automod.invites && /(discord\.gg|discord(app)?\.com\/invite)\//i.test(t)) reason = "Einladungslinks sind nicht erlaubt";
        else if (g.automod.links && /https?:\/\//i.test(t)) reason = "Links sind nicht erlaubt";
        else if (g.automod.words.some((w) => w && low.includes(w.toLowerCase()))) reason = "Unerlaubtes Wort";
        else if (g.automod.caps && t.length > 12 && t.replace(/[^A-Za-zÄÖÜ]/g, "").length > 10 && t === t.toUpperCase()) reason = "Bitte nicht nur in Großbuchstaben schreiben";
        if (reason) {
          await msg.delete().catch(() => {});
          const warn = await msg.channel.send(`⚠️ ${msg.author}, ${reason}.`).catch(() => null);
          setTimeout(() => warn?.delete().catch(() => {}), 6000);
          msg.guild.channels.cache.get(g.automod.logChannel)?.send({ embeds: [new EmbedBuilder().setColor(0xef4444).setTitle("🛡 Auto-Mod").setDescription(`**${msg.author.tag}** in ${msg.channel}\n**Grund:** ${reason}\n**Nachricht:** ${t.slice(0, 500)}`)] }).catch(() => {});
          return;
        }
      }
      // XP
      if (g.xp.enabled) {
        const key = msg.guild.id + msg.author.id;
        if (Date.now() - (cooldown.get(key) || 0) < 60000) return;
        cooldown.set(key, Date.now());
        const u = (g.xpUsers[msg.author.id] ||= { xp: 0, name: msg.author.username, avatar: null });
        const before = levelFor(u.xp);
        u.xp += 15 + Math.floor(Math.random() * 11);
        u.name = msg.author.username; u.avatar = msg.author.displayAvatarURL({ size: 64 });
        const after = levelFor(u.xp);
        save();
        if (after > before) {
          const ch = msg.guild.channels.cache.get(g.xp.channel) || msg.channel;
          ch.send(fill(g.xp.message, msg.member, { level: after })).catch(() => {});
          for (const r of g.xp.rewards) if (Number(r.level) <= after && r.role) msg.member.roles.add(r.role).catch(() => {});
        }
      }
    });
  }

  c.on("interactionCreate", async (i) => {
    if (!i.isButton() || !i.guild) return;
    const g = guildData(i.guild.id);
    const [kind, a, b] = i.customId.split(":");
    try {
      if (kind === "gs_verify") {
        if (!g.verify.role) return i.reply({ content: "Keine Rolle eingestellt.", ephemeral: true });
        await i.member.roles.add(g.verify.role);
        return i.reply({ content: "✅ Du bist jetzt verifiziert!", ephemeral: true });
      }
      if (kind === "gs_ticket") {
        const existing = i.guild.channels.cache.find((ch) => ch.topic === `ticket:${i.user.id}`);
        if (existing) return i.reply({ content: `Du hast schon ein Ticket: ${existing}`, ephemeral: true });
        g.tickets.count++; save();
        const overwrites = [
          { id: i.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
          { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
        ];
        if (g.tickets.staffRole) overwrites.push({ id: g.tickets.staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
        const ch = await i.guild.channels.create({
          name: `ticket-${String(g.tickets.count).padStart(4, "0")}`, type: ChannelType.GuildText,
          parent: g.tickets.category || null, topic: `ticket:${i.user.id}`, permissionOverwrites: overwrites,
        });
        await ch.send({
          content: `${i.user}${g.tickets.staffRole ? ` <@&${g.tickets.staffRole}>` : ""}`,
          embeds: [new EmbedBuilder().setColor(0x7c6cff).setTitle("🎫 Ticket geöffnet").setDescription("Beschreib dein Anliegen – das Team meldet sich gleich.")],
          components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("gs_close").setLabel("Ticket schließen").setEmoji("🔒").setStyle(ButtonStyle.Danger))],
        });
        return i.reply({ content: `🎫 Dein Ticket: ${ch}`, ephemeral: true });
      }
      if (kind === "gs_close") {
        await i.reply("🔒 Ticket wird in 5 Sekunden geschlossen…");
        setTimeout(() => i.channel.delete().catch(() => {}), 5000);
        return;
      }
      if (kind === "gs_poll") {
        const p = g.polls[a];
        if (!p || p.closed) return i.reply({ content: "Diese Umfrage ist beendet.", ephemeral: true });
        for (const opt of p.options) opt.votes = opt.votes.filter((u) => u !== i.user.id);
        p.options[Number(b)].votes.push(i.user.id);
        save();
        await i.update({ embeds: [pollEmbed(p)] });
        return;
      }
      if (kind === "gs_give") {
        const gw = g.giveaways[a];
        if (!gw || gw.ended) return i.reply({ content: "Dieses Giveaway ist vorbei.", ephemeral: true });
        const idx = gw.entries.indexOf(i.user.id);
        if (idx === -1) gw.entries.push(i.user.id); else gw.entries.splice(idx, 1);
        save();
        await i.update({ embeds: [giveEmbed(gw)] });
        return;
      }
    } catch (e) {
      if (!i.replied) i.reply({ content: "❌ Fehler: " + e.message, ephemeral: true }).catch(() => {});
    }
  });

  // Giveaways beenden
  setInterval(() => {
    for (const [gid, g] of Object.entries(db)) for (const gw of Object.values(g.giveaways || {})) {
      if (!gw.ended && Date.now() >= gw.ends) endGiveaway(gid, gw).catch(() => {});
    }
  }, 15000);
}

function pollEmbed(p) {
  const total = p.options.reduce((n, o) => n + o.votes.length, 0) || 0;
  return new EmbedBuilder().setColor(0x7c6cff).setTitle("📊 " + p.question).setFooter({ text: `${total} Stimme(n)${p.closed ? " · beendet" : ""}` })
    .setDescription(p.options.map((o) => {
      const pct = total ? Math.round((o.votes.length / total) * 100) : 0;
      return `**${o.label}**\n${"▰".repeat(Math.round(pct / 10))}${"▱".repeat(10 - Math.round(pct / 10))} ${pct}% (${o.votes.length})`;
    }).join("\n\n"));
}
function giveEmbed(gw) {
  return new EmbedBuilder().setColor(gw.ended ? 0x555555 : 0x22c55e).setTitle("🎁 " + gw.prize)
    .setDescription(gw.ended
      ? (gw.winners.length ? `🏆 Gewinner: ${gw.winners.map((w) => `<@${w}>`).join(", ")}` : "Keine Teilnehmer 😢")
      : `Klicke auf 🎉 zum Mitmachen!\n**Endet:** <t:${Math.floor(gw.ends / 1000)}:R>\n**Gewinner:** ${gw.winnerCount}\n**Teilnehmer:** ${gw.entries.length}`);
}
async function endGiveaway(gid, gw) {
  gw.ended = true;
  const pool = [...gw.entries];
  gw.winners = [];
  while (pool.length && gw.winners.length < gw.winnerCount) gw.winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  save();
  const ch = await client.channels.fetch(gw.channel);
  const msg = await ch.messages.fetch(gw.message).catch(() => null);
  await msg?.edit({ embeds: [giveEmbed(gw)], components: [] });
  if (gw.winners.length) await ch.send(`🎉 Glückwunsch ${gw.winners.map((w) => `<@${w}>`).join(", ")}! Ihr habt **${gw.prize}** gewonnen!`);
}

// ---------- API ----------
export function registerFeatureRoutes(app, { requireAuth, userGuilds, discord, hasV2, aiJson }) {
  const access = async (req, res) => {
    const g = (await userGuilds(req.sess).catch(() => [])).find((x) => x.id === req.params.id);
    if (!g || !g.installed) { res.status(403).json({ error: "Kein Zugriff auf diesen Server." }); return null; }
    return g;
  };
  const needBot = (res) => { if (!client?.isReady()) { res.status(503).json({ error: "Der Bot ist gerade nicht online." }); return false; } return true; };
  const wrap = (fn) => async (req, res) => {
    try { if (await access(req, res)) await fn(req, res); } catch (e) { res.status(500).json({ error: e.message }); }
  };
  const R = (path) => `/api/guild/:id/${path}`;

  // Kanäle & Rollen für Auswahlfelder
  app.get(R("meta"), requireAuth, wrap(async (req, res) => {
    const [channels, roles] = await Promise.all([discord("GET", `/guilds/${req.params.id}/channels`), discord("GET", `/guilds/${req.params.id}/roles`)]);
    res.json({
      text: channels.filter((c) => c.type === 0 || c.type === 5).sort((a, b) => a.position - b.position).map((c) => ({ id: c.id, name: c.name })),
      categories: channels.filter((c) => c.type === 4).map((c) => ({ id: c.id, name: c.name })),
      roles: roles.filter((r) => r.id !== req.params.id && !r.managed).sort((a, b) => b.position - a.position).map((r) => ({ id: r.id, name: r.name, color: r.color })),
      botOnline: !!client?.isReady(),
      intents: !!client?.fullIntents,
    });
  }));

  // Einstellungen lesen / speichern
  app.get(R("config"), requireAuth, wrap(async (req, res) => {
    const g = guildData(req.params.id);
    res.json(Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, g[k]])));
  }));
  app.put(R("config/:feature"), requireAuth, wrap(async (req, res) => {
    const f = req.params.feature;
    if (!DEFAULTS[f]) return res.status(400).json({ error: "Unbekannt." });
    const g = guildData(req.params.id);
    const keep = f === "tickets" ? { count: g.tickets.count } : {};
    g[f] = { ...DEFAULTS[f], ...req.body, ...keep };
    save();
    res.json(g[f]);
  }));

  // Panels posten (Verifizierung / Tickets)
  app.post(R("panel/:kind"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const g = guildData(req.params.id);
    const kind = req.params.kind;
    const cfg = kind === "verify" ? g.verify : g.tickets;
    const ch = await client.channels.fetch(cfg.channel).catch(() => null);
    if (!ch) return res.status(400).json({ error: "Bitte zuerst einen Kanal wählen und speichern." });
    await ch.send({
      embeds: [new EmbedBuilder().setColor(0x7c6cff).setTitle((kind === "verify" ? "✅ " : "🎫 ") + cfg.title).setDescription(cfg.text)],
      components: [new ActionRowBuilder().addComponents(new ButtonBuilder()
        .setCustomId(kind === "verify" ? "gs_verify" : "gs_ticket")
        .setLabel(kind === "verify" ? "Verifizieren" : "Ticket öffnen").setEmoji(kind === "verify" ? "✅" : "🎫")
        .setStyle(kind === "verify" ? ButtonStyle.Success : ButtonStyle.Primary))],
    });
    res.json({ ok: true });
  }));

  // Test-Willkommensnachricht
  app.post(R("welcome/test"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const g = guildData(req.params.id);
    const guild = await client.guilds.fetch(req.params.id);
    const ch = await client.channels.fetch(g.welcome.channel).catch(() => null);
    if (!ch) return res.status(400).json({ error: "Bitte zuerst einen Kanal wählen und speichern." });
    const fake = { id: req.sess.user.id, user: { username: req.sess.user.username }, guild };
    await ch.send({ content: "🧪 *Test:*", embeds: [new EmbedBuilder().setColor(0x7c6cff).setDescription(fill(g.welcome.message, fake))] });
    res.json({ ok: true });
  }));

  // XP-Rangliste
  app.get(R("xp"), requireAuth, wrap(async (req, res) => {
    const u = guildData(req.params.id).xpUsers;
    res.json(Object.entries(u).map(([id, v]) => ({ id, name: v.name, avatar: v.avatar, xp: v.xp, level: levelFor(v.xp), next: xpForLevel(levelFor(v.xp) + 1) }))
      .sort((a, b) => b.xp - a.xp).slice(0, 50));
  }));
  app.delete(R("xp"), requireAuth, wrap(async (req, res) => { guildData(req.params.id).xpUsers = {}; save(); res.json({ ok: true }); }));

  // Statistiken
  app.get(R("stats"), requireAuth, wrap(async (req, res) => {
    const s = guildData(req.params.id).stats;
    const out = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      out.push({ day: d, ...(s[d] || { joins: 0, leaves: 0, messages: 0 }) });
    }
    res.json(out);
  }));

  // Umfragen
  app.get(R("polls"), requireAuth, wrap(async (req, res) => res.json(Object.values(guildData(req.params.id).polls).reverse().slice(0, 20))));
  app.post(R("polls"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const { channel, question, options } = req.body;
    const opts = (options || []).map((o) => String(o).trim()).filter(Boolean).slice(0, 5);
    if (!question || opts.length < 2) return res.status(400).json({ error: "Frage und mindestens 2 Antworten nötig." });
    const ch = await client.channels.fetch(channel).catch(() => null);
    if (!ch) return res.status(400).json({ error: "Kanal nicht gefunden." });
    const id = Date.now().toString(36);
    const p = { id, question, channel, options: opts.map((label) => ({ label, votes: [] })), created: Date.now() };
    const msg = await ch.send({ embeds: [pollEmbed(p)], components: [new ActionRowBuilder().addComponents(
      ...opts.map((o, i) => new ButtonBuilder().setCustomId(`gs_poll:${id}:${i}`).setLabel(o.slice(0, 80)).setStyle(ButtonStyle.Secondary)))] });
    p.message = msg.id;
    guildData(req.params.id).polls[id] = p; save();
    res.json(p);
  }));
  app.post(R("polls/:pid/close"), requireAuth, wrap(async (req, res) => {
    const p = guildData(req.params.id).polls[req.params.pid];
    if (!p) return res.status(404).json({ error: "Nicht gefunden." });
    p.closed = true; save();
    const ch = await client.channels.fetch(p.channel).catch(() => null);
    (await ch?.messages.fetch(p.message).catch(() => null))?.edit({ embeds: [pollEmbed(p)], components: [] });
    res.json(p);
  }));

  // Giveaways
  app.get(R("giveaways"), requireAuth, wrap(async (req, res) => res.json(Object.values(guildData(req.params.id).giveaways).reverse().slice(0, 20))));
  app.post(R("giveaways"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const { channel, prize, minutes, winners } = req.body;
    if (!prize) return res.status(400).json({ error: "Preis fehlt." });
    const ch = await client.channels.fetch(channel).catch(() => null);
    if (!ch) return res.status(400).json({ error: "Kanal nicht gefunden." });
    const id = Date.now().toString(36);
    const gw = { id, prize, channel, winnerCount: Math.max(1, Math.min(10, Number(winners) || 1)), ends: Date.now() + Math.max(1, Number(minutes) || 60) * 60000, entries: [], winners: [], ended: false };
    const msg = await ch.send({ embeds: [giveEmbed(gw)], components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gs_give:${id}`).setLabel("Mitmachen").setEmoji("🎉").setStyle(ButtonStyle.Success))] });
    gw.message = msg.id;
    guildData(req.params.id).giveaways[id] = gw; save();
    res.json(gw);
  }));
  app.post(R("giveaways/:gid/end"), requireAuth, wrap(async (req, res) => {
    const gw = guildData(req.params.id).giveaways[req.params.gid];
    if (!gw || gw.ended) return res.status(400).json({ error: "Nicht aktiv." });
    await endGiveaway(req.params.id, gw);
    res.json(gw);
  }));

  // Backups
  app.get(R("backups"), requireAuth, wrap(async (req, res) => res.json(guildData(req.params.id).backups.map(({ data, ...b }) => b))));
  app.post(R("backups"), requireAuth, wrap(async (req, res) => {
    const gid = req.params.id;
    const [channels, roles] = await Promise.all([discord("GET", `/guilds/${gid}/channels`), discord("GET", `/guilds/${gid}/roles`)]);
    const data = {
      roles: roles.filter((r) => r.id !== gid && !r.managed).sort((a, b) => b.position - a.position)
        .map((r) => ({ name: r.name, color: r.color, hoist: r.hoist, permissions: r.permissions, mentionable: r.mentionable })),
      categories: channels.filter((c) => c.type === 4).sort((a, b) => a.position - b.position).map((cat) => ({
        name: cat.name,
        channels: channels.filter((c) => c.parent_id === cat.id && c.type !== 4).sort((a, b) => a.position - b.position)
          .map((c) => ({ name: c.name, type: c.type, topic: c.topic || undefined })),
      })),
      loose: channels.filter((c) => !c.parent_id && c.type !== 4).map((c) => ({ name: c.name, type: c.type, topic: c.topic || undefined })),
    };
    const b = { id: Date.now().toString(36), name: req.body.name || `Backup ${new Date().toLocaleString("de-DE")}`, created: Date.now(),
      roles: data.roles.length, channels: channels.filter((c) => c.type !== 4).length, data };
    const list = guildData(gid).backups;
    list.unshift(b); list.splice(10);
    save();
    const { data: _, ...meta } = b;
    res.json(meta);
  }));
  app.delete(R("backups/:bid"), requireAuth, wrap(async (req, res) => {
    const g = guildData(req.params.id);
    g.backups = g.backups.filter((b) => b.id !== req.params.bid); save();
    res.json({ ok: true });
  }));
  // Backup als Plan zurückgeben (Wiederherstellen läuft über den normalen Build)
  app.get(R("backups/:bid/plan"), requireAuth, wrap(async (req, res) => {
    const b = guildData(req.params.id).backups.find((x) => x.id === req.params.bid);
    if (!b) return res.status(404).json({ error: "Nicht gefunden." });
    const P = BigInt;
    const names = { 8n: "ADMINISTRATOR", 16n: "MANAGE_CHANNELS", 32n: "MANAGE_GUILD", 2n: "KICK_MEMBERS", 4n: "BAN_MEMBERS", 8192n: "MANAGE_MESSAGES", 268435456n: "MANAGE_ROLES", 1099511627776n: "MODERATE_MEMBERS" };
    res.json({
      summary: `Wiederherstellung von „${b.name}“`,
      roles: b.data.roles.map((r) => ({ name: r.name, color: "#" + (r.color || 0x99aab5).toString(16).padStart(6, "0"), hoist: r.hoist,
        permissions: Object.entries(names).filter(([bit]) => (P(r.permissions) & P(bit)) !== 0n).map(([, n]) => n) })),
      categories: [
        ...(b.data.loose.length ? [{ name: "Allgemein", channels: b.data.loose }] : []),
        ...b.data.categories,
      ].map((c) => ({ name: c.name, channels: c.channels.filter((x) => x.type === 0 || x.type === 2 || x.type === 5)
        .map((x) => ({ name: x.name, type: x.type === 2 ? "voice" : "text", topic: x.topic })) })),
    });
  }));

  // Bot-Profil (nur mit V2 Pre-Access): Name, Avatar, Banner, Bio des Bots auf diesem Server
  const v2wrap = (fn) => wrap(async (req, res) => {
    if (!(await hasV2(req.sess.user.id))) return res.status(403).json({ error: "Bot-Profil ist nur mit V2 Pre-Access verfügbar." });
    await fn(req, res);
  });
  app.get(R("botprofile"), requireAuth, v2wrap(async (req, res) => {
    const m = await discord("GET", `/guilds/${req.params.id}/members/${client?.user?.id || (await discord("GET", "/users/@me")).id}`);
    const u = m.user;
    res.json({
      nick: m.nick || "", bio: m.bio || "", globalName: u.global_name || u.username,
      avatar: m.avatar ? `https://cdn.discordapp.com/guilds/${req.params.id}/users/${u.id}/avatars/${m.avatar}.png?size=128` : (u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null),
      banner: m.banner ? `https://cdn.discordapp.com/guilds/${req.params.id}/users/${u.id}/banners/${m.banner}.png?size=480` : null,
    });
  }));
  app.patch(R("botprofile"), requireAuth, v2wrap(async (req, res) => {
    const body = {};
    if ("nick" in req.body) body.nick = req.body.nick || null;
    if ("bio" in req.body) body.bio = req.body.bio || null;
    for (const k of ["avatar", "banner"]) if (k in req.body) {
      const v = req.body[k];
      if (v && !/^data:image\/(png|jpeg|gif|webp);base64,/.test(v)) return res.status(400).json({ error: "Bild muss PNG, JPG, GIF oder WEBP sein." });
      if (v && v.length > 11_000_000) return res.status(400).json({ error: "Bild ist zu groß (max. 8 MB)." });
      body[k] = v || null;
    }
    await discord("PATCH", `/guilds/${req.params.id}/members/@me`, body);
    res.json({ ok: true });
  }));

  // ---------- Custom Bots (Automationen) ----------
  const autoMeta = async (gid) => {
    const [channels, roles] = await Promise.all([discord("GET", `/guilds/${gid}/channels`), discord("GET", `/guilds/${gid}/roles`)]);
    return {
      channels: channels.filter((c) => [0, 2, 5, 13].includes(c.type)).map((c) => ({ id: c.id, name: c.name, type: c.type })),
      categories: channels.filter((c) => c.type === 4).map((c) => ({ id: c.id, name: c.name })),
      roles: roles.filter((r) => r.id !== gid && !r.managed).map((r) => ({ id: r.id, name: r.name })),
    };
  };
  const view = (a, meta) => ({ ...a, ...describe(a, meta) });
  app.get(R("automations"), requireAuth, wrap(async (req, res) => {
    const meta = await autoMeta(req.params.id);
    res.json(guildData(req.params.id).automations.map((a) => view(a, meta)));
  }));
  // KI: Wunsch -> Automation (wird noch NICHT gespeichert)
  app.post(R("automations/ai"), requireAuth, wrap(async (req, res) => {
    const prompt = String(req.body.prompt || "").slice(0, 1500);
    if (!prompt.trim()) return res.status(400).json({ error: "Beschreib, was dein Bot tun soll." });
    const meta = await autoMeta(req.params.id);
    const raw = await aiJson(automationPrompt(meta), prompt);
    const a = validateAutomation(raw, meta);
    res.json(view(a, meta));
  }));
  app.post(R("automations"), requireAuth, wrap(async (req, res) => {
    const meta = await autoMeta(req.params.id);
    const a = validateAutomation(req.body, meta);
    const g = guildData(req.params.id);
    if (g.automations.length >= 25) return res.status(400).json({ error: "Maximal 25 Custom Bots pro Server." });
    const item = { id: Date.now().toString(36), enabled: true, created: Date.now(), ...a,
      lastRun: a.trigger.type === "interval" ? Date.now() : 0 };
    if (a.trigger.type === "slash_command" && g.automations.some((x) => x.trigger.command === a.trigger.command))
      return res.status(400).json({ error: `Den Befehl /${a.trigger.command} gibt es schon.` });
    g.automations.push(item); save();
    await syncCommands(req.params.id);
    res.json(view(item, meta));
  }));
  app.patch(R("automations/:aid"), requireAuth, wrap(async (req, res) => {
    const a = guildData(req.params.id).automations.find((x) => x.id === req.params.aid);
    if (!a) return res.status(404).json({ error: "Nicht gefunden." });
    if ("enabled" in req.body) a.enabled = !!req.body.enabled;
    save();
    if (a.trigger.type === "slash_command") await syncCommands(req.params.id);
    res.json({ ok: true });
  }));
  app.delete(R("automations/:aid"), requireAuth, wrap(async (req, res) => {
    const g = guildData(req.params.id);
    g.automations = g.automations.filter((x) => x.id !== req.params.aid); save();
    await syncCommands(req.params.id);
    res.json({ ok: true });
  }));
  app.post(R("automations/:aid/run"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const a = guildData(req.params.id).automations.find((x) => x.id === req.params.aid);
    if (!a) return res.status(404).json({ error: "Nicht gefunden." });
    if (!["interval", "daily", "weekly"].includes(a.trigger.type)) return res.status(400).json({ error: "Nur zeitgesteuerte Custom Bots kann man von Hand starten." });
    const guild = await client.guilds.fetch(req.params.id);
    res.json({ log: await runActions(client, guild, a) });
  }));

  // Server-Einstellungen
  app.get(R("settings"), requireAuth, wrap(async (req, res) => {
    const g = await discord("GET", `/guilds/${req.params.id}`);
    res.json({ name: g.name, description: g.description, system_channel_id: g.system_channel_id, verification_level: g.verification_level, afk_timeout: g.afk_timeout });
  }));
  app.patch(R("settings"), requireAuth, wrap(async (req, res) => {
    const allowed = ["name", "system_channel_id", "verification_level"];
    const body = Object.fromEntries(Object.entries(req.body).filter(([k]) => allowed.includes(k)));
    if (body.system_channel_id === "") body.system_channel_id = null;
    const g = await discord("PATCH", `/guilds/${req.params.id}`, body);
    res.json({ name: g.name });
  }));
}
