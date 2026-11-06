// Dashboard-Seiten für alle Features. Nutzt $, esc, guild, showPage, setPlanFromOutside aus index.html.
(() => {
  const api = async (path, opt = {}) => {
    const r = await fetch(`/api/guild/${guild.id}/${path}`, {
      method: opt.method || "GET",
      headers: { "Content-Type": "application/json" },
      body: opt.body ? JSON.stringify(opt.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) location.reload();
    if (!r.ok) throw new Error(d.error || "Fehler " + r.status);
    return d;
  };
  let meta = null, metaFor = null, config = null;
  async function loadMeta(force) {
    if (!force && meta && metaFor === guild.id) return;
    [meta, config] = await Promise.all([api("meta"), api("config")]);
    metaFor = guild.id;
  }
  const toast = (t, bad) => {
    const el = document.createElement("div");
    el.className = "toast" + (bad ? " bad" : "");
    el.textContent = t;
    document.body.append(el);
    setTimeout(() => el.remove(), 2600);
  };
  const run = async (btn, fn, ok) => {
    const t = btn.textContent; btn.disabled = true; btn.textContent = "…";
    try { await fn(); if (ok) toast(ok); } catch (e) { toast(e.message, true); }
    btn.disabled = false; btn.textContent = t;
  };

  // Formular-Bausteine
  const chOpts = (v, none = "– Kanal wählen –") => `<option value="">${none}</option>` + meta.text.map((c) => `<option value="${c.id}" ${c.id === v ? "selected" : ""}># ${esc(c.name)}</option>`).join("");
  const catOpts = (v) => `<option value="">– keine Kategorie –</option>` + meta.categories.map((c) => `<option value="${c.id}" ${c.id === v ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const roleOpts = (v, none = "– Rolle wählen –") => `<option value="">${none}</option>` + meta.roles.map((r) => `<option value="${r.id}" ${r.id === v ? "selected" : ""}>@ ${esc(r.name)}</option>`).join("");
  const field = (label, html, hint = "") => `<label class="fld"><span>${label}</span>${html}${hint ? `<small>${hint}</small>` : ""}</label>`;
  const toggle = (id, on, label) => `<label class="tgl"><input type="checkbox" id="${id}" ${on ? "checked" : ""}><i></i><span>${label}</span></label>`;
  const head = (icon, title, sub, right = "") => `<div class="fhead"><div class="ficon">${icon}</div><div><h2>${title}</h2><p>${sub}</p></div><span class="sp"></span>${right}</div>`;
  const card = (title, body) => `<div class="fcard">${title ? `<h4>${title}</h4>` : ""}${body}</div>`;
  const warnIntents = () => meta.intents ? "" : `<div class="fwarn">⚠️ Für diese Funktion braucht der Bot zwei Rechte: Developer Portal → <b>Bot</b> → <b>Server Members Intent</b> und <b>Message Content Intent</b> einschalten, dann Guildsmith neu starten.</div>`;
  const warnBot = () => meta.botOnline ? "" : `<div class="fwarn">⚠️ Der Bot ist gerade nicht online.</div>`;
  const val = (id) => $(id).value;
  const chk = (id) => $(id).checked;
  const multiRoles = (id, sel = []) => `<div class="rolepick" id="${id}">${meta.roles.map((r) => `<label class="rchip"><input type="checkbox" value="${r.id}" ${sel.includes(r.id) ? "checked" : ""}><span style="--c:#${(r.color || 0x99aab5).toString(16).padStart(6, "0")}">${esc(r.name)}</span></label>`).join("") || "<small>Keine Rollen vorhanden.</small>"}</div>`;
  const pickedRoles = (id) => [...$(id).querySelectorAll("input:checked")].map((x) => x.value);
  const saveCfg = async (f, body) => { config[f] = await api(`config/${f}`, { method: "PUT", body }); };

  const PAGES = {
    // ---------- Server-Einstellungen ----------
    async settings(el) {
      const s = await api("settings");
      el.innerHTML = head("⚙", "Server-Einstellungen", "Grundeinstellungen deines Discord-Servers.") + card("", `
        ${field("Servername", `<input id="sName2" value="${esc(s.name)}" maxlength="100">`)}
        ${field("Systemkanal", `<select id="sSys">${chOpts(s.system_channel_id, "– keiner –")}</select>`, "Hier schickt Discord eigene Beitritts- und Boost-Nachrichten hin.")}
        ${field("Verifizierungsstufe", `<select id="sVer">${["Keine", "Niedrig – E-Mail bestätigt", "Mittel – 5 Min. registriert", "Hoch – 10 Min. auf dem Server", "Sehr hoch – Telefon bestätigt"].map((t, i) => `<option value="${i}" ${i === s.verification_level ? "selected" : ""}>${t}</option>`).join("")}</select>`)}
        <div class="factions"><button class="white" id="sSave">Speichern</button></div>`);
      $("sSave").onclick = (e) => run(e.target, async () => {
        await api("settings", { method: "PATCH", body: { name: val("sName2"), system_channel_id: val("sSys"), verification_level: Number(val("sVer")) } });
        guild.name = val("sName2"); $("sName").textContent = guild.name;
      }, "Gespeichert ✓");
    },

    // ---------- Statistiken ----------
    async stats(el) {
      const d = await api("stats");
      const max = Math.max(1, ...d.map((x) => x.messages));
      const sum = (k) => d.reduce((n, x) => n + x[k], 0);
      el.innerHTML = head("📈", "Statistiken", "Die letzten 14 Tage – zählt ab dem Zeitpunkt, an dem der Bot aktiv ist.") + warnIntents() + `
        <div class="stats">
          <div class="stat"><small>💬 Nachrichten</small><b>${sum("messages")}</b><em>14 Tage</em></div>
          <div class="stat"><small>📥 Beitritte</small><b>${sum("joins")}</b><em>14 Tage</em></div>
          <div class="stat"><small>📤 Austritte</small><b>${sum("leaves")}</b><em>14 Tage</em></div>
          <div class="stat"><small>📊 Wachstum</small><b>${sum("joins") - sum("leaves") >= 0 ? "+" : ""}${sum("joins") - sum("leaves")}</b><em>Mitglieder</em></div>
        </div>` + card("💬 Nachrichten pro Tag", `<div class="bars">${d.map((x) => `<div class="bar" title="${x.day}: ${x.messages} Nachrichten"><i style="height:${Math.round((x.messages / max) * 100)}%"></i><small>${x.day.slice(8)}.</small></div>`).join("")}</div>`)
        + card("📥 Beitritte & Austritte", `<table class="tbl"><tr><th>Tag</th><th>Beitritte</th><th>Austritte</th><th>Nachrichten</th></tr>${[...d].reverse().map((x) => `<tr><td>${new Date(x.day).toLocaleDateString("de-DE")}</td><td class="g">+${x.joins}</td><td class="r">-${x.leaves}</td><td>${x.messages}</td></tr>`).join("")}</table>`);
    },

    // ---------- Willkommen ----------
    async welcome(el) {
      const c = config.welcome;
      el.innerHTML = head("👋", "Willkommen", "Begrüße neue Mitglieder automatisch.", toggle("wOn", c.enabled, "Aktiv")) + warnIntents() + card("Begrüßung", `
        ${field("Kanal", `<select id="wCh">${chOpts(c.channel)}</select>`)}
        ${field("Nachricht", `<textarea id="wMsg" rows="3">${esc(c.message)}</textarea>`, "Platzhalter: {user} = Erwähnung, {name} = Name, {server} = Servername, {count} = Mitgliederzahl")}
        ${toggle("wDm", c.dm, "Zusätzlich als Direktnachricht schicken")}`) + card("Abschied", `
        ${toggle("wLeave", c.leaveEnabled, "Nachricht senden, wenn jemand geht")}
        ${field("Abschieds-Nachricht", `<input id="wLeaveMsg" value="${esc(c.leaveMessage)}">`)}`) + `
        <div class="factions"><button class="ghost" id="wTest">🧪 Test senden</button><button class="white" id="wSave">Speichern</button></div>`;
      const body = () => ({ enabled: chk("wOn"), channel: val("wCh"), message: val("wMsg"), dm: chk("wDm"), leaveEnabled: chk("wLeave"), leaveMessage: val("wLeaveMsg") });
      $("wSave").onclick = (e) => run(e.target, () => saveCfg("welcome", body()), "Gespeichert ✓");
      $("wTest").onclick = (e) => run(e.target, async () => { await saveCfg("welcome", body()); await api("welcome/test", { method: "POST" }); }, "Test gesendet ✓");
    },

    // ---------- Auto-Rollen ----------
    async autoroles(el) {
      const c = config.autoroles;
      el.innerHTML = head("🏷", "Auto-Rollen", "Neue Mitglieder bekommen diese Rollen automatisch.", toggle("aOn", c.enabled, "Aktiv")) + warnIntents()
        + card("Rollen", multiRoles("aRoles", c.roles) + `<small class="muted">Die Rolle des Bots muss in Discord über diesen Rollen stehen.</small>`)
        + `<div class="factions"><button class="white" id="aSave">Speichern</button></div>`;
      $("aSave").onclick = (e) => run(e.target, () => saveCfg("autoroles", { enabled: chk("aOn"), roles: pickedRoles("aRoles") }), "Gespeichert ✓");
    },

    // ---------- Verifizierung ----------
    async verify(el) {
      const c = config.verify;
      el.innerHTML = head("✔", "Verifizierung", "Mitglieder klicken einen Button und bekommen eine Rolle.", toggle("vOn", c.enabled, "Aktiv")) + warnBot() + card("", `
        ${field("Kanal für den Button", `<select id="vCh">${chOpts(c.channel)}</select>`)}
        ${field("Rolle nach Verifizierung", `<select id="vRole">${roleOpts(c.role)}</select>`)}
        ${field("Titel", `<input id="vTitle" value="${esc(c.title)}">`)}
        ${field("Text", `<textarea id="vText" rows="3">${esc(c.text)}</textarea>`)}`) + `
        <div class="factions"><button class="ghost" id="vPost">📤 Button posten</button><button class="white" id="vSave">Speichern</button></div>`;
      const body = () => ({ enabled: chk("vOn"), channel: val("vCh"), role: val("vRole"), title: val("vTitle"), text: val("vText") });
      $("vSave").onclick = (e) => run(e.target, () => saveCfg("verify", body()), "Gespeichert ✓");
      $("vPost").onclick = (e) => run(e.target, async () => { await saveCfg("verify", body()); await api("panel/verify", { method: "POST" }); }, "Button gepostet ✓");
    },

    // ---------- Tickets ----------
    async tickets(el) {
      const c = config.tickets;
      el.innerHTML = head("🎫", "Tickets", `Support-Tickets per Button. Bisher geöffnet: <b>${c.count}</b>`, toggle("tOn", c.enabled, "Aktiv")) + warnBot() + card("", `
        ${field("Kanal für den Ticket-Button", `<select id="tCh">${chOpts(c.channel)}</select>`)}
        ${field("Kategorie für neue Tickets", `<select id="tCat">${catOpts(c.category)}</select>`)}
        ${field("Team-Rolle", `<select id="tRole">${roleOpts(c.staffRole, "– keine –")}</select>`, "Diese Rolle sieht alle Tickets und wird erwähnt.")}
        ${field("Titel", `<input id="tTitle" value="${esc(c.title)}">`)}
        ${field("Text", `<textarea id="tText" rows="3">${esc(c.text)}</textarea>`)}`) + `
        <div class="factions"><button class="ghost" id="tPost">📤 Ticket-Button posten</button><button class="white" id="tSave">Speichern</button></div>`;
      const body = () => ({ enabled: chk("tOn"), channel: val("tCh"), category: val("tCat"), staffRole: val("tRole"), title: val("tTitle"), text: val("tText") });
      $("tSave").onclick = (e) => run(e.target, () => saveCfg("tickets", body()), "Gespeichert ✓");
      $("tPost").onclick = (e) => run(e.target, async () => { await saveCfg("tickets", body()); await api("panel/tickets", { method: "POST" }); }, "Ticket-Button gepostet ✓");
    },

    // ---------- XP & Level ----------
    async xp(el) {
      const c = config.xp;
      const top = await api("xp");
      el.innerHTML = head("⭐", "XP & Level", "Mitglieder sammeln XP fürs Schreiben (1× pro Minute).", toggle("xOn", c.enabled, "Aktiv")) + warnIntents() + `<div class="two">` + card("Einstellungen", `
        ${field("Level-Up-Kanal", `<select id="xCh">${chOpts(c.channel, "– im selben Kanal –")}</select>`)}
        ${field("Level-Up-Nachricht", `<input id="xMsg" value="${esc(c.message)}">`, "{user} = Erwähnung, {level} = neues Level")}
        <div class="fld"><span>Level-Belohnungen</span><div id="xRewards">${c.rewards.map((r) => rewardRow(r)).join("")}</div><button class="ghost sm2" id="xAdd">＋ Belohnung</button></div>
        <div class="factions"><button class="white" id="xSave">Speichern</button></div>`) + card(`🏆 Rangliste <button class="ghost sm2" id="xReset" style="float:right">Zurücksetzen</button>`, top.length
        ? `<div class="lb">${top.map((u, i) => `<div class="lbr"><b>${i + 1}</b>${u.avatar ? `<img src="${esc(u.avatar)}">` : "<span class=av0></span>"}<div><span>${esc(u.name)}</span><div class="xpbar"><i style="width:${Math.min(100, Math.round((u.xp / u.next) * 100))}%"></i></div></div><small>Lvl ${u.level}<br>${u.xp} XP</small></div>`).join("")}</div>`
        : `<div class="empty">Noch keine XP gesammelt.</div>`) + `</div>`;
      $("xAdd").onclick = () => $("xRewards").insertAdjacentHTML("beforeend", rewardRow({ level: 5, role: "" }));
      $("xRewards").onclick = (e) => e.target.closest(".rmv") && e.target.closest(".rwd").remove();
      $("xSave").onclick = (e) => run(e.target, () => saveCfg("xp", {
        enabled: chk("xOn"), channel: val("xCh"), message: val("xMsg"),
        rewards: [...document.querySelectorAll(".rwd")].map((r) => ({ level: Number(r.querySelector("input").value), role: r.querySelector("select").value })).filter((r) => r.role),
      }), "Gespeichert ✓");
      $("xReset").onclick = (e) => confirm("Alle XP auf diesem Server löschen?") && run(e.target, async () => { await api("xp", { method: "DELETE" }); PAGES.xp(el); }, "Zurückgesetzt");
    },

    // ---------- Umfragen ----------
    async polls(el) {
      const list = await api("polls");
      el.innerHTML = head("📊", "Umfragen", "Erstelle eine Umfrage mit Buttons – jeder kann einmal abstimmen.") + warnBot() + `<div class="two">` + card("Neue Umfrage", `
        ${field("Kanal", `<select id="pCh">${chOpts("")}</select>`)}
        ${field("Frage", `<input id="pQ" placeholder="Was sollen wir als Nächstes spielen?">`)}
        <div class="fld"><span>Antworten (2–5)</span>${[1, 2, 3, 4, 5].map((n) => `<input class="pOpt" placeholder="Antwort ${n}${n > 2 ? " (optional)" : ""}">`).join("")}</div>
        <div class="factions"><button class="white" id="pGo">📤 Umfrage posten</button></div>`) + card("Letzte Umfragen", list.length ? list.map((p) => {
          const total = p.options.reduce((n, o) => n + o.votes.length, 0);
          return `<div class="item"><b>${esc(p.question)}</b> ${p.closed ? '<span class="tag">beendet</span>' : '<span class="tag live2">läuft</span>'}
            ${p.options.map((o) => { const pct = total ? Math.round((o.votes.length / total) * 100) : 0; return `<div class="pbar"><span>${esc(o.label)}</span><div><i style="width:${pct}%"></i></div><small>${pct}%</small></div>`; }).join("")}
            ${p.closed ? "" : `<button class="ghost sm2" data-close="${p.id}">Beenden</button>`}</div>`;
        }).join("") : `<div class="empty">Noch keine Umfragen.</div>`) + `</div>`;
      $("pGo").onclick = (e) => run(e.target, async () => {
        await api("polls", { method: "POST", body: { channel: val("pCh"), question: val("pQ"), options: [...document.querySelectorAll(".pOpt")].map((x) => x.value) } });
        PAGES.polls(el);
      }, "Umfrage gepostet ✓");
      el.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => run(b, async () => { await api(`polls/${b.dataset.close}/close`, { method: "POST" }); PAGES.polls(el); }, "Beendet")));
    },

    // ---------- Giveaways ----------
    async giveaways(el) {
      const list = await api("giveaways");
      el.innerHTML = head("🎁", "Giveaways", "Verlose Preise – der Bot zieht am Ende automatisch die Gewinner.") + warnBot() + `<div class="two">` + card("Neues Giveaway", `
        ${field("Kanal", `<select id="gCh">${chOpts("")}</select>`)}
        ${field("Preis", `<input id="gPrize" placeholder="z.B. Discord Nitro">`)}
        <div class="row2">${field("Dauer", `<select id="gMin"><option value="10">10 Minuten</option><option value="60" selected>1 Stunde</option><option value="360">6 Stunden</option><option value="1440">1 Tag</option><option value="4320">3 Tage</option><option value="10080">1 Woche</option></select>`)}
        ${field("Gewinner", `<input id="gWin" type="number" min="1" max="10" value="1">`)}</div>
        <div class="factions"><button class="white" id="gGo">🎉 Giveaway starten</button></div>`) + card("Giveaways", list.length ? list.map((g) => `<div class="item">
          <b>🎁 ${esc(g.prize)}</b> ${g.ended ? '<span class="tag">beendet</span>' : '<span class="tag live2">läuft</span>'}
          <small class="muted" style="display:block">${g.entries.length} Teilnehmer · ${g.ended ? (g.winners.length ? g.winners.length + " Gewinner gezogen" : "keine Gewinner") : "endet " + new Date(g.ends).toLocaleString("de-DE")}</small>
          ${g.ended ? "" : `<button class="ghost sm2" data-end="${g.id}">Jetzt beenden</button>`}</div>`).join("") : `<div class="empty">Noch keine Giveaways.</div>`) + `</div>`;
      $("gGo").onclick = (e) => run(e.target, async () => {
        await api("giveaways", { method: "POST", body: { channel: val("gCh"), prize: val("gPrize"), minutes: Number(val("gMin")), winners: Number(val("gWin")) } });
        PAGES.giveaways(el);
      }, "Giveaway gestartet ✓");
      el.querySelectorAll("[data-end]").forEach((b) => (b.onclick = () => run(b, async () => { await api(`giveaways/${b.dataset.end}/end`, { method: "POST" }); PAGES.giveaways(el); }, "Gewinner gezogen 🎉")));
    },

    // ---------- Auto-Moderation ----------
    async automod(el) {
      const c = config.automod;
      el.innerHTML = head("🛡", "Auto-Moderation", "Löscht unerwünschte Nachrichten automatisch. Mitglieder mit „Nachrichten verwalten“ sind ausgenommen.", toggle("mOn", c.enabled, "Aktiv")) + warnIntents() + card("Regeln", `
        ${toggle("mInv", c.invites, "Discord-Einladungen von anderen Servern blockieren")}
        ${toggle("mLinks", c.links, "Alle Links blockieren")}
        ${toggle("mCaps", c.caps, "Nachrichten nur in GROSSBUCHSTABEN blockieren")}
        ${field("Verbotene Wörter", `<textarea id="mWords" rows="3" placeholder="ein Wort pro Zeile">${esc(c.words.join("\n"))}</textarea>`)}
        ${field("Log-Kanal", `<select id="mLog">${chOpts(c.logChannel, "– kein Log –")}</select>`, "Hier landen alle gelöschten Nachrichten.")}`) + `
        <div class="factions"><button class="white" id="mSave">Speichern</button></div>`;
      $("mSave").onclick = (e) => run(e.target, () => saveCfg("automod", {
        enabled: chk("mOn"), invites: chk("mInv"), links: chk("mLinks"), caps: chk("mCaps"),
        words: val("mWords").split("\n").map((w) => w.trim()).filter(Boolean), logChannel: val("mLog"),
      }), "Gespeichert ✓");
    },

    // ---------- Backups ----------
    async backups(el) {
      const list = await api("backups");
      el.innerHTML = head("💾", "Backups", "Sichere Rollen und Kanäle deines Servers (max. 10 Backups).", `<button class="white" id="bNew">＋ Backup erstellen</button>`)
        + card("", list.length ? list.map((b) => `<div class="item flex"><div><b>${esc(b.name)}</b><small class="muted" style="display:block">${new Date(b.created).toLocaleString("de-DE")} · ${b.roles} Rollen · ${b.channels} Kanäle</small></div><span class="sp"></span>
            <button class="ghost sm2" data-restore="${b.id}">↺ Wiederherstellen</button><button class="ghost sm2" data-del="${b.id}">🗑</button></div>`).join("")
          : `<div class="empty">Noch keine Backups.</div>`)
        + `<div class="fnote">💡 „Wiederherstellen“ lädt das Backup als Plan in den AI Builder. Dort kannst du es prüfen und mit <b>Build</b> (optional „vorher alles löschen“) wiederherstellen.</div>`;
      $("bNew").onclick = (e) => run(e.target, async () => { await api("backups", { method: "POST", body: {} }); PAGES.backups(el); }, "Backup erstellt ✓");
      el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => confirm("Backup löschen?") && run(b, async () => { await api(`backups/${b.dataset.del}`, { method: "DELETE" }); PAGES.backups(el); }, "Gelöscht")));
      el.querySelectorAll("[data-restore]").forEach((b) => (b.onclick = () => run(b, async () => {
        window.setPlanFromOutside(await api(`backups/${b.dataset.restore}/plan`), "Backup wiederherstellen");
      })));
    },

    // ---------- Bot-Profil (V2) ----------
    async botprofile(el) {
      const b = await api("botprofile");
      let avatar, banner; // undefined = unverändert, "" = entfernen, data-URL = neu
      el.innerHTML = head("🤖", "Bot-Profil", "So sieht Guildsmith auf <b>diesem</b> Server aus. <span class='v2tag'>V2 PRE-ACCESS</span>") + `<div class="two">` + card("Profil", `
        ${field("Anzeigename auf diesem Server", `<input id="bNick" maxlength="32" placeholder="${esc(b.globalName)}" value="${esc(b.nick)}">`, "Leer lassen = normaler Name")}
        ${field("Über mich", `<textarea id="bBio" rows="3" maxlength="190" placeholder="z.B. Dein Helfer für Tickets & mehr">${esc(b.bio)}</textarea>`)}
        ${field("Avatar", `<input type="file" id="bAva" accept="image/png,image/jpeg,image/gif,image/webp"><button class="ghost sm2" id="bAvaDel" style="margin-top:6px">Avatar zurücksetzen</button>`)}
        ${field("Banner", `<input type="file" id="bBan" accept="image/png,image/jpeg,image/gif,image/webp"><button class="ghost sm2" id="bBanDel" style="margin-top:6px">Banner entfernen</button>`)}
        <div class="factions"><button class="white" id="bSave">Speichern</button></div>`) + card("Vorschau", `
        <div class="bpre"><div class="bban" id="pBan" style="${b.banner ? `background-image:url(${b.banner})` : ""}"></div>
          <img class="bava" id="pAva" src="${esc(b.avatar || "logo.png")}">
          <div class="bbody"><b id="pNick">${esc(b.nick || b.globalName)}</b> <span class="badge beta">APP</span><p id="pBio">${esc(b.bio || "Kein „Über mich“")}</p></div></div>`) + `</div>`;
      const read = (f) => new Promise((ok, no) => { if (f.size > 8e6) return no(new Error("Bild ist zu groß (max. 8 MB).")); const r = new FileReader(); r.onload = () => ok(r.result); r.readAsDataURL(f); });
      $("bNick").oninput = () => ($("pNick").textContent = val("bNick") || b.globalName);
      $("bBio").oninput = () => ($("pBio").textContent = val("bBio") || "Kein „Über mich“");
      $("bAva").onchange = async (e) => { try { avatar = await read(e.target.files[0]); $("pAva").src = avatar; } catch (x) { toast(x.message, true); } };
      $("bBan").onchange = async (e) => { try { banner = await read(e.target.files[0]); $("pBan").style.backgroundImage = `url(${banner})`; } catch (x) { toast(x.message, true); } };
      $("bAvaDel").onclick = () => { avatar = ""; $("pAva").src = "logo.png"; };
      $("bBanDel").onclick = () => { banner = ""; $("pBan").style.backgroundImage = ""; };
      $("bSave").onclick = (e) => run(e.target, async () => {
        const body = { nick: val("bNick"), bio: val("bBio") };
        if (avatar !== undefined) body.avatar = avatar;
        if (banner !== undefined) body.banner = banner;
        await api("botprofile", { method: "PATCH", body });
        avatar = banner = undefined;
      }, "Bot-Profil gespeichert ✓");
    },

    // ---------- Vorlagen ----------
    async templates(el) {
      el.innerHTML = head("🧩", "Vorlagen", "Fertige Server-Pläne – mit einem Klick in den AI Builder laden und anpassen.")
        + `<div class="tgrid">${TEMPLATES.map((t, i) => `<div class="tcard"><div class="temoji">${t.emoji}</div><b>${t.name}</b><p>${t.desc}</p>
          <small>${t.plan.roles.length} Rollen · ${t.plan.categories.reduce((n, c) => n + c.channels.length, 0)} Kanäle</small>
          <button class="white" data-tpl="${i}">Verwenden →</button></div>`).join("")}</div>`;
      el.querySelectorAll("[data-tpl]").forEach((b) => (b.onclick = () => window.setPlanFromOutside(structuredClone(TEMPLATES[b.dataset.tpl].plan), "Vorlage: " + TEMPLATES[b.dataset.tpl].name)));
    },
  };

  const rewardRow = (r) => `<div class="rwd">Ab Level <input type="number" min="1" value="${r.level}"> → <select>${roleOpts(r.role)}</select><button class="ghost sm2 rmv">✕</button></div>`;

  const T = (name, color, hoist, permissions = []) => ({ name, color, hoist, permissions });
  const C = (name, type = "text", extra = {}) => ({ name, type, ...extra });
  const TEMPLATES = [
    { emoji: "🎮", name: "Gaming-Community", desc: "Für Freundesgruppen und Gaming-Clans mit Clips, LFG und Voice.", plan: {
      summary: "Gaming-Community mit Info, Chat, Clips, LFG und Voice-Kanälen.",
      roles: [T("Owner", "#e74c3c", true, ["ADMINISTRATOR"]), T("Moderator", "#3498db", true, ["MANAGE_MESSAGES", "KICK_MEMBERS", "MODERATE_MEMBERS"]), T("Gamer", "#2ecc71", true), T("Member", "#95a5a6")],
      categories: [
        { name: "📢 Info", channels: [C("regeln", "text", { readonly: true }), C("ankündigungen", "text", { readonly: true })] },
        { name: "💬 Community", channels: [C("allgemein"), C("clips"), C("memes"), C("lfg", "text", { topic: "Mitspieler suchen" })] },
        { name: "🔊 Voice", channels: [C("Lobby", "voice"), C("Gaming 1", "voice"), C("Gaming 2", "voice"), C("AFK", "voice")] },
      ] } },
    { emoji: "⛏", name: "Minecraft SMP", desc: "Survival-Server mit Regeln, Bewerbungen, Support und Builds.", plan: {
      summary: "Minecraft SMP mit Infos, Community, Support und Voice.",
      roles: [T("Owner", "#e74c3c", true, ["ADMINISTRATOR"]), T("Admin", "#e67e22", true, ["ADMINISTRATOR"]), T("Mod", "#3498db", true, ["MANAGE_MESSAGES", "MODERATE_MEMBERS"]), T("VIP", "#f1c40f", true), T("Spieler", "#2ecc71")],
      categories: [
        { name: "📢 Server-Info", channels: [C("regeln", "text", { readonly: true }), C("ankündigungen", "text", { readonly: true }), C("server-ip", "text", { readonly: true })] },
        { name: "💬 Community", channels: [C("allgemein"), C("builds"), C("handel"), C("screenshots")] },
        { name: "🎫 Support", channels: [C("hilfe"), C("bewerbungen"), C("bug-reports")] },
        { name: "🔊 Voice", channels: [C("Talk", "voice"), C("Projekt", "voice")] },
      ] } },
    { emoji: "🚓", name: "Roleplay-Stadt", desc: "RP-Server mit Polizei, Rettungsdienst, Zivil und Fraktionen.", plan: {
      summary: "Roleplay-Server mit Fraktionen, Leitstelle und Funk.",
      roles: [T("Projektleitung", "#e74c3c", true, ["ADMINISTRATOR"]), T("Support", "#9b59b6", true, ["MANAGE_MESSAGES", "MODERATE_MEMBERS"]), T("Polizei", "#3498db", true), T("Rettungsdienst", "#e67e22", true), T("Zivilist", "#95a5a6", true)],
      categories: [
        { name: "📢 Info", channels: [C("regelwerk", "text", { readonly: true }), C("ankündigungen", "text", { readonly: true }), C("einreise")] },
        { name: "🚓 Polizei", private_to_roles: ["Polizei", "Projektleitung"], channels: [C("leitstelle"), C("einsatzberichte"), C("Funk Polizei", "voice")] },
        { name: "🚑 Rettungsdienst", private_to_roles: ["Rettungsdienst", "Projektleitung"], channels: [C("leitstelle-rd"), C("Funk RD", "voice")] },
        { name: "🏙 Stadt", channels: [C("ooc-chat"), C("marktplatz"), C("Wartebereich", "voice")] },
      ] } },
    { emoji: "📚", name: "Lern-Server", desc: "Für Klassen und Lerngruppen mit Fächern und Hausaufgaben.", plan: {
      summary: "Lernserver mit Fächern, Hausaufgaben und Lernräumen.",
      roles: [T("Lehrer", "#e74c3c", true, ["MANAGE_MESSAGES", "MODERATE_MEMBERS"]), T("Klassensprecher", "#f1c40f", true), T("Schüler", "#3498db")],
      categories: [
        { name: "📢 Info", channels: [C("ankündigungen", "text", { readonly: true }), C("stundenplan", "text", { readonly: true })] },
        { name: "📖 Fächer", channels: [C("mathe"), C("deutsch"), C("englisch"), C("bio-chemie-physik")] },
        { name: "📝 Hausaufgaben", channels: [C("aufgaben", "text", { readonly: true }), C("fragen")] },
        { name: "🔊 Lernräume", channels: [C("Lernraum 1", "voice"), C("Lernraum 2", "voice")] },
      ] } },
  ];

  window.renderFeature = async (key) => {
    const el = $("pFeature");
    el.innerHTML = `<div class="empty" style="margin-top:80px"><i class="spin" style="display:inline-block"></i></div>`;
    try {
      await loadMeta(true);
      await PAGES[key](el);
    } catch (e) {
      el.innerHTML = `<div class="empty" style="margin-top:80px;color:var(--red)">Fehler: ${esc(e.message)}</div>`;
    }
  };
  window.featureStatus = async () => { await loadMeta(true); return config; };
})();
