// Discord-Bot: schickt eine Willkommensnachricht, wenn Guildsmith einem Server beitritt.
import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } from "discord.js";

const PAGES_URL = process.env.PAGES_URL || "https://crystalsmp.github.io/guildsmith";

export function startBot(token) {
  if (!token) return;
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });

  client.once("clientReady", () => console.log(`🤖 Bot online als ${client.user.tag}`));

  client.on("guildCreate", async (guild) => {
    try {
      const me = guild.members.me;
      const canSend = (c) => c && c.type === ChannelType.GuildText && c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      const channel = canSend(guild.systemChannel)
        ? guild.systemChannel
        : guild.channels.cache.filter(canSend).sort((a, b) => a.rawPosition - b.rawPosition).first();
      if (!channel) return;

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Guildsmith ist bereit. ⚒️")
        .setDescription(
          "Beschreib einfach, wie dein Server aussehen soll – Guildsmith V1 plant **Rollen, Kategorien und Kanäle** und baut alles mit einem Klick.\n\n" +
          "**So geht's:**\n1. Auf **Diesen Server bauen** klicken\n2. Mit Discord anmelden\n3. Server im Chat beschreiben → Plan prüfen → **Build**"
        )
        .setThumbnail(`${PAGES_URL}/logo.png`)
        .setFooter({ text: "Guildsmith V1" });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Diesen Server bauen").setEmoji("🔨").setURL(`${PAGES_URL}/?guild=${guild.id}`),
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel("Dashboard öffnen").setEmoji("📋").setURL(`${PAGES_URL}/`)
      );

      await channel.send({ embeds: [embed], components: [row] });
      console.log(`👋 Willkommensnachricht auf ${guild.name} gesendet`);
    } catch (e) {
      console.log("⚠ Willkommensnachricht fehlgeschlagen:", e.message);
    }
  });

  client.login(token).catch((e) => console.log("⚠ Bot-Login fehlgeschlagen:", e.message));
}
