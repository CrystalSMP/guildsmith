// Weitere Features: Self-Roles, Temp-Voice, Mod-Log, Embed-Builder
import {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ChannelType, AuditLogEvent,
} from "discord.js";

export const DEFAULTS2 = {
  tempvoice: { enabled: false, hub: "", category: "", name: "🔊 {name}s Kanal", limit: 0 },
  modlog: { enabled: false, channel: "", msgDelete: true, msgEdit: true, join: true, leave: true, ban: true, roles: true, nick: true },
};

let client = null;

// ---------- Hilfen ----------
const hex = (c) => (/^#?[0-9a-f]{6}$/i.test(c || "") ? parseInt(String(c).replace("#", ""), 16) : 0x7c6cff);
const isUrl = (u) => /^https?:\/\/\S+$/i.test(u || "");
export function buildEmbed(e = {}) {
  const b = new EmbedBuilder().setColor(hex(e.color));
  if (e.title) b.setTitle(String(e.title).slice(0, 256));
  if (e.description) b.setDescription(String(e.description).slice(0, 4000));
  if (isUrl(e.url)) b.setURL(e.url);
  if (e.author) b.setAuthor({ name: String(e.author).slice(0, 256), iconURL: isUrl(e.authorIcon) ? e.authorIcon : undefined });
  if (isUrl(e.image)) b.setImage(e.image);
  if (isUrl(e.thumbnail)) b.setThumbnail(e.thumbnail);
  if (e.footer) b.setFooter({ text: String(e.footer).slice(0, 2048), iconURL: isUrl(e.footerIcon) ? e.footerIcon : undefined });
  if (e.timestamp) b.setTimestamp();
  const fields = (e.fields || []).filter((f) => f.name || f.value).slice(0, 25);
  if (fields.length) b.addFields(fields.map((f) => ({ name: String(f.name || "​").slice(0, 256), value: String(f.value || "​").slice(0, 1024), inline: !!f.inline })));
  return b;
}
const hasContent = (e) => e && (e.title || e.description || e.image || e.author || (e.fields || []).some((f) => f.name || f.value));

// ---------- Bot ----------
export function setupFeatures2(c, full, guildData, save) {
  client = c;

  // Self-Roles: Buttons und Dropdown
  c.on("interactionCreate", async (i) => {
    if (!i.guild) return;
    try {
      if (i.isButton() && i.customId.startsWith("gs_sr:")) {
        const [, pid, rid] = i.customId.split(":");
        const p = guildData(i.guild.id).selfroles.find((x) => x.id === pid);
        if (!p || !p.roles.some((r) => r.role === rid)) return i.reply({ content: "Diese Rolle ist nicht mehr verfügbar.", ephemeral: true });
        const has = i.member.roles.cache.has(rid);
        if (!has && p.single) await i.member.roles.remove(p.roles.map((r) => r.role).filter((r) => r !== rid && i.member.roles.cache.has(r)));
        if (has) await i.member.roles.remove(rid); else await i.member.roles.add(rid);
        return i.reply({ content: has ? `➖ <@&${rid}> entfernt.` : `➕ Du hast jetzt <@&${rid}>.`, ephemeral: true });
      }
      if (i.isStringSelectMenu() && i.customId.startsWith("gs_srm:")) {
        const p = guildData(i.guild.id).selfroles.find((x) => x.id === i.customId.split(":")[1]);
        if (!p) return i.reply({ content: "Dieses Menü ist nicht mehr aktiv.", ephemeral: true });
        const all = p.roles.map((r) => r.role), pick = i.values.filter((v) => all.includes(v));
        await i.member.roles.remove(all.filter((r) => !pick.includes(r) && i.member.roles.cache.has(r)));
        if (pick.length) await i.member.roles.add(pick);
        return i.reply({ content: pick.length ? `✅ Deine Rollen: ${pick.map((r) => `<@&${r}>`).join(", ")}` : "✅ Alle Rollen aus diesem Menü entfernt.", ephemeral: true });
      }
    } catch (e) {
      if (!i.replied) i.reply({ content: "❌ " + (/Missing Permissions/.test(e.message) ? "Mir fehlen die Rechte – meine Rolle muss über diesen Rollen stehen." : e.message), ephemeral: true }).catch(() => {});
    }
  });

  // Temp-Voice: "Join to create"
  c.on("voiceStateUpdate", async (oldS, newS) => {
    const guild = newS.guild, g = guildData(guild.id), cfg = g.tempvoice;
    g.tempChannels ||= [];
    try {
      // Leeren Temp-Kanal löschen
      if (oldS.channelId && oldS.channelId !== newS.channelId && g.tempChannels.includes(oldS.channelId)) {
        const ch = oldS.channel || (await guild.channels.fetch(oldS.channelId).catch(() => null));
        if (!ch || ch.members.size === 0) {
          await ch?.delete("Temp-Voice leer").catch(() => {});
          g.tempChannels = g.tempChannels.filter((id) => id !== oldS.channelId); save();
        }
      }
      // Hub betreten -> eigenen Kanal erstellen
      if (cfg.enabled && cfg.hub && newS.channelId === cfg.hub && newS.member) {
        const hub = newS.channel;
        const m = newS.member;
        const ch = await guild.channels.create({
          name: cfg.name.replaceAll("{name}", m.displayName).replaceAll("{user}", m.user.username).slice(0, 100),
          type: ChannelType.GuildVoice,
          parent: cfg.category || hub.parentId || null,
          userLimit: Math.max(0, Math.min(99, Number(cfg.limit) || 0)),
          permissionOverwrites: [{ id: m.id, allow: ["ManageChannels", "MoveMembers", "MuteMembers"] }],
        });
        g.tempChannels.push(ch.id); save();
        await m.voice.setChannel(ch).catch(async () => { await ch.delete().catch(() => {}); });
      }
    } catch (e) { console.log("⚠ Temp-Voice:", e.message); }
  });

  // Mod-Log
  const log = async (guild, key, embed) => {
    const cfg = guildData(guild.id).modlog;
    if (!cfg.enabled || !cfg[key] || !cfg.channel) return;
    const ch = guild.channels.cache.get(cfg.channel);
    if (ch) ch.send({ embeds: [embed.setTimestamp()] }).catch(() => {});
  };
  const E = (color, title) => new EmbedBuilder().setColor(color).setTitle(title);
  if (full) {
    c.on("messageDelete", (m) => {
      if (!m.guild || m.author?.bot) return;
      log(m.guild, "msgDelete", E(0xef4444, "🗑 Nachricht gelöscht").setDescription(
        `**Von:** ${m.author ? `${m.author} (${m.author.tag})` : "unbekannt"}\n**Kanal:** ${m.channel}\n\n${(m.content || "*kein Text / nicht im Speicher*").slice(0, 1800)}`));
    });
    c.on("messageUpdate", (o, n) => {
      if (!n.guild || n.author?.bot || o.content === n.content || !o.content) return;
      log(n.guild, "msgEdit", E(0xeab308, "✏ Nachricht bearbeitet").setDescription(`**Von:** ${n.author} · ${n.channel} · [Zur Nachricht](${n.url})`)
        .addFields({ name: "Vorher", value: o.content.slice(0, 1000) || "​" }, { name: "Nachher", value: (n.content || "").slice(0, 1000) || "​" }));
    });
    c.on("guildMemberAdd", (m) => {
      const age = Math.floor((Date.now() - m.user.createdTimestamp) / 864e5);
      log(m.guild, "join", E(0x22c55e, "📥 Beigetreten").setThumbnail(m.user.displayAvatarURL())
        .setDescription(`${m} (${m.user.tag})\nAccount-Alter: **${age} Tage**${age < 7 ? " ⚠️ neu!" : ""}\nMitglieder: ${m.guild.memberCount}`));
    });
    c.on("guildMemberRemove", (m) => {
      log(m.guild, "leave", E(0x94a3b8, "📤 Verlassen").setThumbnail(m.user.displayAvatarURL())
        .setDescription(`${m.user.tag}\nRollen: ${m.roles?.cache.filter((r) => r.id !== m.guild.id).map((r) => r.name).join(", ") || "keine"}`));
    });
    c.on("guildMemberUpdate", (o, n) => {
      const added = n.roles.cache.filter((r) => !o.roles.cache.has(r.id)), removed = o.roles.cache.filter((r) => !n.roles.cache.has(r.id));
      if (added.size || removed.size)
        log(n.guild, "roles", E(0x7c6cff, "🏷 Rollen geändert").setDescription(`${n}\n${added.map((r) => `➕ ${r}`).join("\n")}\n${removed.map((r) => `➖ ${r}`).join("\n")}`));
      if (o.nickname !== n.nickname)
        log(n.guild, "nick", E(0x38bdf8, "✏ Nickname geändert").setDescription(`${n}\n**Vorher:** ${o.nickname || "–"}\n**Nachher:** ${n.nickname || "–"}`));
    });
  }
  c.on("guildBanAdd", async (b) => {
    let by = "";
    try {
      const a = (await b.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 })).entries.first();
      if (a?.target?.id === b.user.id) by = `\n**Von:** ${a.executor}${a.reason ? `\n**Grund:** ${a.reason}` : ""}`;
    } catch {}
    log(b.guild, "ban", E(0x991b1b, "🔨 Gebannt").setDescription(`${b.user.tag} (${b.user.id})${by}`));
  });
  c.on("guildBanRemove", (b) => log(b.guild, "ban", E(0x22c55e, "🔓 Entbannt").setDescription(`${b.user.tag} (${b.user.id})`)));
}

// ---------- API ----------
export function registerFeatures2(app, { requireAuth, wrap, R, needBot, guildData, save }) {
  // Self-Roles
  app.get(R("selfroles"), requireAuth, wrap(async (req, res) => res.json(guildData(req.params.id).selfroles)));
  app.post(R("selfroles"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const b = req.body, g = guildData(req.params.id);
    const roles = (b.roles || []).filter((r) => r.role).slice(0, b.mode === "menu" ? 25 : 20);
    if (!roles.length) return res.status(400).json({ error: "Wähle mindestens eine Rolle." });
    const ch = await client.channels.fetch(b.channel).catch(() => null);
    if (!ch) return res.status(400).json({ error: "Kanal nicht gefunden." });
    const guild = await client.guilds.fetch(req.params.id);
    const p = { id: Date.now().toString(36), channel: b.channel, title: String(b.title || "Wähle deine Rollen").slice(0, 256), text: String(b.text || "").slice(0, 2000),
      color: b.color, mode: b.mode === "menu" ? "menu" : "buttons", single: !!b.single,
      roles: roles.map((r) => ({ role: r.role, label: String(r.label || guild.roles.cache.get(r.role)?.name || "Rolle").slice(0, 80), emoji: String(r.emoji || "").slice(0, 8), desc: String(r.desc || "").slice(0, 100) })) };
    const components = [];
    if (p.mode === "menu") {
      const menu = new StringSelectMenuBuilder().setCustomId(`gs_srm:${p.id}`).setPlaceholder("Rollen auswählen…")
        .setMinValues(0).setMaxValues(p.single ? 1 : p.roles.length)
        .addOptions(p.roles.map((r) => ({ label: r.label, value: r.role, description: r.desc || undefined, emoji: r.emoji || undefined })));
      components.push(new ActionRowBuilder().addComponents(menu));
    } else {
      for (let i = 0; i < p.roles.length; i += 5)
        components.push(new ActionRowBuilder().addComponents(p.roles.slice(i, i + 5).map((r) => {
          const btn = new ButtonBuilder().setCustomId(`gs_sr:${p.id}:${r.role}`).setLabel(r.label).setStyle(ButtonStyle.Secondary);
          if (r.emoji) btn.setEmoji(r.emoji);
          return btn;
        })));
    }
    const desc = p.text + (p.mode === "buttons" ? `\n\n${p.roles.map((r) => `${r.emoji || "•"} <@&${r.role}>${r.desc ? ` – ${r.desc}` : ""}`).join("\n")}` : "");
    let msg;
    try { msg = await ch.send({ embeds: [buildEmbed({ title: p.title, description: desc.trim(), color: p.color })], components }); }
    catch (e) { return res.status(400).json({ error: /emoji/i.test(e.message) ? "Ein Emoji ist ungültig – nimm normale Emojis wie 🎮." : e.message }); }
    p.message = msg.id;
    g.selfroles.unshift(p); g.selfroles.splice(30); save();
    res.json(p);
  }));
  app.delete(R("selfroles/:pid"), requireAuth, wrap(async (req, res) => {
    const g = guildData(req.params.id), p = g.selfroles.find((x) => x.id === req.params.pid);
    if (p) {
      const ch = await client?.channels.fetch(p.channel).catch(() => null);
      (await ch?.messages.fetch(p.message).catch(() => null))?.delete().catch(() => {});
    }
    g.selfroles = g.selfroles.filter((x) => x.id !== req.params.pid); save();
    res.json({ ok: true });
  }));

  // Embed-Builder: senden oder bestehende Bot-Nachricht bearbeiten
  app.post(R("embed"), requireAuth, wrap(async (req, res) => {
    if (!needBot(res)) return;
    const { channel, content, embed, edit } = req.body;
    if (!content && !hasContent(embed)) return res.status(400).json({ error: "Die Nachricht ist leer." });
    const payload = { content: content ? String(content).slice(0, 2000) : undefined, embeds: hasContent(embed) ? [buildEmbed(embed)] : [] };
    if (edit) {
      const m = /channels\/\d+\/(\d+)\/(\d+)/.exec(edit);
      if (!m) return res.status(400).json({ error: "Ungültiger Nachrichten-Link (Rechtsklick auf die Nachricht → Link kopieren)." });
      const ch = await client.channels.fetch(m[1]).catch(() => null);
      if (!ch || ch.guildId !== req.params.id) return res.status(400).json({ error: "Kanal nicht gefunden." });
      const msg = await ch.messages.fetch(m[2]).catch(() => null);
      if (!msg) return res.status(400).json({ error: "Nachricht nicht gefunden." });
      if (msg.author.id !== client.user.id) return res.status(400).json({ error: "Ich kann nur meine eigenen Nachrichten bearbeiten." });
      await msg.edit(payload);
      return res.json({ ok: true, url: msg.url });
    }
    const ch = await client.channels.fetch(channel).catch(() => null);
    if (!ch || ch.guildId !== req.params.id) return res.status(400).json({ error: "Bitte einen Kanal wählen." });
    const msg = await ch.send(payload);
    const g = guildData(req.params.id);
    g.embedsSaved ||= [];
    g.embedsSaved.unshift({ id: msg.id, url: msg.url, title: embed?.title || content?.slice(0, 50) || "Embed", at: Date.now(), content, embed });
    g.embedsSaved.splice(20); save();
    res.json({ ok: true, url: msg.url });
  }));
  app.get(R("embeds"), requireAuth, wrap(async (req, res) => res.json(guildData(req.params.id).embedsSaved || [])));
}
