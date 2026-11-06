// Seiten: Self-Roles, Temp-Voice, Mod-Log, Embed-Builder
(() => {
  const G = window.GS;
  const { api, toast, run, field, toggle, head, card, warnIntents, warnBot, chOpts, catOpts, val, chk, saveCfg, PAGES } = G;

  // ---------- Self-Roles ----------
  PAGES.selfroles = async (el) => {
    const meta = G.meta();
    const list = await api("selfroles");
    const roleSel = (v) => `<select class="srRole"><option value="">– Rolle –</option>${meta.roles.map((r) => `<option value="${r.id}" ${r.id === v ? "selected" : ""}>@ ${esc(r.name)}</option>`).join("")}</select>`;
    const row = (r = {}) => `<div class="srrow">${roleSel(r.role)}<input class="srEmoji" placeholder="🎮" value="${esc(r.emoji || "")}" maxlength="8"><input class="srLabel" placeholder="Anzeigename" value="${esc(r.label || "")}"><input class="srDesc" placeholder="Beschreibung (optional)" value="${esc(r.desc || "")}"><button class="ghost sm2 srDel">✕</button></div>`;
    let mode = "buttons";
    el.innerHTML = head("🎭", "Self-Roles", "Mitglieder geben sich Rollen selbst – per Button oder Dropdown.") + warnBot() + `<div class="two">` + card("Neues Rollen-Menü", `
      ${field("Kanal", `<select id="srCh">${chOpts("")}</select>`)}
      ${field("Titel", `<input id="srTitle" value="Wähle deine Rollen">`)}
      ${field("Text", `<textarea id="srText" rows="2">Klicke unten, um dir Rollen zu geben oder wieder zu nehmen.</textarea>`)}
      <div class="fld"><span>Art</span><div class="seg" id="srMode"><button class="on" data-m="buttons">🔘 Buttons</button><button data-m="menu">📋 Dropdown</button></div></div>
      ${toggle("srSingle", false, "Nur eine Rolle gleichzeitig (z.B. Farben, Alter)")}
      <div class="fld"><span>Rollen</span><div id="srRows">${row()}${row()}</div><button class="ghost sm2" id="srAdd">＋ Rolle</button></div>
      <small class="muted">Die Rolle von Guildsmith muss in Discord über diesen Rollen stehen.</small>
      <div class="factions"><button class="white" id="srGo">📤 Posten</button></div>`)
      + card(`Aktive Menüs <span class="tag">${list.length}</span>`, list.length ? list.map((p) => `<div class="item flex"><div><b>${esc(p.title)}</b>
          <small class="muted" style="display:block">${p.mode === "menu" ? "📋 Dropdown" : "🔘 Buttons"} · #${esc(meta.text.find((c) => c.id === p.channel)?.name || "?")} · ${p.roles.map((r) => `${r.emoji || ""}${esc(r.label)}`).join(", ")}</small></div><span class="sp"></span>
          <button class="ghost sm2" data-del="${p.id}">🗑</button></div>`).join("") : `<div class="empty">Noch keine Menüs.</div>`) + `</div>`;
    $("srMode").onclick = (e) => { const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m; $("srMode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b)); };
    $("srAdd").onclick = () => $("srRows").insertAdjacentHTML("beforeend", row());
    $("srRows").onclick = (e) => e.target.closest(".srDel") && e.target.closest(".srrow").remove();
    $("srGo").onclick = (e) => run(e.target, async () => {
      const roles = [...document.querySelectorAll(".srrow")].map((r) => ({ role: r.querySelector(".srRole").value, emoji: r.querySelector(".srEmoji").value.trim(), label: r.querySelector(".srLabel").value.trim(), desc: r.querySelector(".srDesc").value.trim() }));
      await api("selfroles", { method: "POST", body: { channel: val("srCh"), title: val("srTitle"), text: val("srText"), mode, single: chk("srSingle"), roles } });
      PAGES.selfroles(el);
    }, "Rollen-Menü gepostet ✓");
    el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => confirm("Menü löschen? Die Nachricht in Discord wird auch gelöscht.") && run(b, async () => { await api(`selfroles/${b.dataset.del}`, { method: "DELETE" }); PAGES.selfroles(el); }, "Gelöscht")));
  };

  // ---------- Temp-Voice ----------
  PAGES.tempvoice = async (el) => {
    const meta = G.meta(), c = G.config().tempvoice;
    const voiceOpts = `<option value="">– Sprachkanal wählen –</option>` + (meta.voice || []).map((v) => `<option value="${v.id}" ${v.id === c.hub ? "selected" : ""}>🔊 ${esc(v.name)}</option>`).join("");
    el.innerHTML = head("🔊", "Temp-Voice", "„Join to create“: Wer den Hub-Kanal betritt, bekommt einen eigenen Sprachkanal. Ist er leer, verschwindet er.", toggle("tvOn", c.enabled, "Aktiv")) + warnBot() + card("", `
      ${field("Hub-Kanal (hier rein = neuer Kanal)", `<select id="tvHub">${voiceOpts}</select>`, "Tipp: Erstell einen Sprachkanal wie „➕ Kanal erstellen“.")}
      ${field("Kategorie für neue Kanäle", `<select id="tvCat">${catOpts(c.category)}</select>`, "Leer = gleiche Kategorie wie der Hub.")}
      ${field("Name", `<input id="tvName" value="${esc(c.name)}" maxlength="90">`, "{name} = Anzeigename des Mitglieds")}
      ${field("Nutzer-Limit", `<input id="tvLimit" type="number" min="0" max="99" value="${c.limit || 0}">`, "0 = unbegrenzt. Der Besitzer kann seinen Kanal selbst umbenennen und Leute verschieben.")}
      <div class="factions"><button class="white" id="tvSave">Speichern</button></div>`);
    $("tvSave").onclick = (e) => run(e.target, () => saveCfg("tempvoice", { enabled: chk("tvOn"), hub: val("tvHub"), category: val("tvCat"), name: val("tvName"), limit: Number(val("tvLimit")) }), "Gespeichert ✓");
  };

  // ---------- Mod-Log ----------
  PAGES.modlog = async (el) => {
    const c = G.config().modlog;
    const ev = [["msgDelete", "🗑 Gelöschte Nachrichten (mit Inhalt)"], ["msgEdit", "✏ Bearbeitete Nachrichten (vorher/nachher)"], ["join", "📥 Beitritte (mit Account-Alter)"], ["leave", "📤 Austritte (mit Rollen)"], ["ban", "🔨 Bans & Entbannungen (mit Grund)"], ["roles", "🏷 Rollen-Änderungen"], ["nick", "✏ Nickname-Änderungen"]];
    el.innerHTML = head("📜", "Mod-Log", "Protokolliert alles Wichtige in einen Kanal – nur fürs Team.", toggle("mlOn", c.enabled, "Aktiv")) + warnIntents() + card("", `
      ${field("Log-Kanal", `<select id="mlCh">${chOpts(c.channel)}</select>`, "Am besten ein privater Kanal, den nur das Team sieht.")}
      <div class="fld"><span>Was soll protokolliert werden?</span>${ev.map(([k, l]) => toggle("ml_" + k, c[k], l)).join("")}</div>
      <div class="factions"><button class="white" id="mlSave">Speichern</button></div>`);
    $("mlSave").onclick = (e) => run(e.target, () => saveCfg("modlog", { enabled: chk("mlOn"), channel: val("mlCh"), ...Object.fromEntries(ev.map(([k]) => [k, chk("ml_" + k)])) }), "Gespeichert ✓");
  };

  // ---------- Embed-Builder ----------
  PAGES.embed = async (el) => {
    const saved = await api("embeds");
    const fieldRow = (f = {}) => `<div class="efield"><input class="efN" placeholder="Feld-Titel" value="${esc(f.name || "")}"><input class="efV" placeholder="Feld-Text" value="${esc(f.value || "")}"><label><input type="checkbox" class="efI" ${f.inline ? "checked" : ""}>nebeneinander</label><button class="ghost sm2 efDel">✕</button></div>`;
    el.innerHTML = head("🖼", "Embed-Builder", "Bau schöne Nachrichten mit Live-Vorschau und poste sie als Guildsmith.") + warnBot() + `<div class="two">` + card("Inhalt", `
      ${field("Nachricht über dem Embed (optional)", `<input id="eContent" placeholder="z.B. @everyone Neues Update!">`)}
      ${field("Autor (optional)", `<input id="eAuthor" placeholder="Guildsmith Team">`)}
      ${field("Titel", `<input id="eTitle" placeholder="📢 Neues Update" maxlength="256">`)}
      ${field("Titel-Link (optional)", `<input id="eUrl" placeholder="https://…">`)}
      ${field("Text", `<textarea id="eDesc" rows="5" placeholder="**fett**, *kursiv*, Zeilenumbrüche…"></textarea>`)}
      <div class="fld"><span>Farbe</span><div class="colorin"><input type="color" id="eColor" value="#7c6cff"><input id="eColorHex" value="#7c6cff" style="width:110px"></div></div>
      <div class="fld"><span>Felder</span><div id="eFields"></div><button class="ghost sm2" id="eAddF">＋ Feld</button></div>
      ${field("Großes Bild (Link)", `<input id="eImage" placeholder="https://…png">`)}
      ${field("Kleines Bild rechts (Link)", `<input id="eThumb" placeholder="https://…png">`)}
      ${field("Fußzeile", `<input id="eFooter" placeholder="Guildsmith">`)}
      ${toggle("eTime", false, "Zeitstempel anzeigen")}`)
      + `<div>` + card("Vorschau", `<div class="dpre"><div class="dmsg"><img src="logo.png"><div style="flex:1;min-width:0"><div class="dname">Guildsmith <span class="badge">APP</span><small>Heute</small></div><div id="pContent"></div><div id="pEmbed"></div></div></div></div>`)
      + card("Senden", `
        <div class="fld"><span>Modus</span><div class="seg" id="eMode"><button class="on" data-m="send">📤 Neu senden</button><button data-m="edit">✏ Bearbeiten</button></div></div>
        <div id="eSendBox">${field("Kanal", `<select id="eCh">${chOpts("")}</select>`)}</div>
        <div id="eEditBox" style="display:none">${field("Link zur Bot-Nachricht", `<input id="eEdit" placeholder="https://discord.com/channels/…">`, "In Discord: Rechtsklick auf die Nachricht → Nachrichtenlink kopieren.")}</div>
        <div class="factions"><button class="white" id="eGo">📤 Senden</button></div>`)
      + card("Zuletzt gesendet", saved.length ? saved.map((x, i) => `<div class="item flex"><div><b>${esc(x.title)}</b><small class="muted" style="display:block">${new Date(x.at).toLocaleString("de-DE")}</small></div><span class="sp"></span><button class="ghost sm2" data-load="${i}">Laden</button><a class="ghost sm2" href="${esc(x.url)}" target="_blank" style="text-decoration:none">↗</a></div>`).join("") : `<div class="empty">Noch nichts gesendet.</div>`)
      + `</div></div>`;

    let mode = "send";
    const ids = ["eContent", "eAuthor", "eTitle", "eUrl", "eDesc", "eImage", "eThumb", "eFooter"];
    const data = () => ({
      content: val("eContent"),
      embed: { author: val("eAuthor"), title: val("eTitle"), url: val("eUrl"), description: val("eDesc"), color: val("eColorHex"), image: val("eImage"), thumbnail: val("eThumb"), footer: val("eFooter"), timestamp: chk("eTime"),
        fields: [...document.querySelectorAll(".efield")].map((f) => ({ name: f.querySelector(".efN").value, value: f.querySelector(".efV").value, inline: f.querySelector(".efI").checked })) },
    });
    // Discord-Markdown (vereinfacht) für die Vorschau
    const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>").replace(/__(.+?)__/g, "<u>$1</u>").replace(/`(.+?)`/g, "<code>$1</code>");
    const okUrl = (u) => /^https?:\/\/\S+$/i.test(u || "");
    const preview = () => {
      const { content, embed: e } = data();
      $("pContent").innerHTML = content ? `<div style="margin-top:2px">${md(content)}</div>` : "";
      const has = e.title || e.description || e.author || okUrl(e.image) || e.fields.some((f) => f.name || f.value);
      $("pEmbed").innerHTML = has ? `<div class="demb" style="--ec:${esc(e.color)}">
          <div>${e.author ? `<div class="dauth">${esc(e.author)}</div>` : ""}${e.title ? `<div class="dtitle ${okUrl(e.url) ? "link" : ""}">${md(e.title)}</div>` : ""}${e.description ? `<div class="ddesc">${md(e.description)}</div>` : ""}</div>
          ${okUrl(e.thumbnail) ? `<img class="dthumb" src="${esc(e.thumbnail)}">` : ""}
          ${e.fields.some((f) => f.name || f.value) ? `<div class="dfields">${e.fields.filter((f) => f.name || f.value).map((f) => `<div class="${f.inline ? "in" : ""}"><b>${md(f.name)}</b><span>${md(f.value)}</span></div>`).join("")}</div>` : ""}
          ${okUrl(e.image) ? `<img class="dimg" src="${esc(e.image)}">` : ""}
          ${e.footer || e.timestamp ? `<div class="dfoot">${esc(e.footer)}${e.footer && e.timestamp ? " • " : ""}${e.timestamp ? "Heute um " + new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) : ""}</div>` : ""}
        </div>` : "";
    };
    el.addEventListener("input", preview);
    el.addEventListener("change", preview);
    $("eColor").oninput = () => { $("eColorHex").value = $("eColor").value; preview(); };
    $("eColorHex").oninput = () => { if (/^#[0-9a-f]{6}$/i.test(val("eColorHex"))) $("eColor").value = val("eColorHex"); preview(); };
    $("eAddF").onclick = () => { $("eFields").insertAdjacentHTML("beforeend", fieldRow()); preview(); };
    $("eFields").onclick = (e) => { if (e.target.closest(".efDel")) { e.target.closest(".efield").remove(); preview(); } };
    $("eMode").onclick = (e) => {
      const b = e.target.closest("[data-m]"); if (!b) return; mode = b.dataset.m;
      $("eMode").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      $("eSendBox").style.display = mode === "send" ? "" : "none"; $("eEditBox").style.display = mode === "edit" ? "" : "none";
      $("eGo").textContent = mode === "send" ? "📤 Senden" : "✏ Speichern";
    };
    el.querySelectorAll("[data-load]").forEach((b) => (b.onclick = () => {
      const x = saved[b.dataset.load], e = x.embed || {};
      $("eContent").value = x.content || ""; $("eAuthor").value = e.author || ""; $("eTitle").value = e.title || ""; $("eUrl").value = e.url || "";
      $("eDesc").value = e.description || ""; $("eImage").value = e.image || ""; $("eThumb").value = e.thumbnail || ""; $("eFooter").value = e.footer || "";
      $("eColorHex").value = e.color || "#7c6cff"; $("eColor").value = e.color || "#7c6cff"; $("eTime").checked = !!e.timestamp;
      $("eFields").innerHTML = (e.fields || []).map(fieldRow).join("");
      $("eEdit").value = x.url; $("eMode").querySelector('[data-m="edit"]').click();
      preview(); toast("Geladen – du kannst sie jetzt bearbeiten");
    }));
    $("eGo").onclick = (e) => run(e.target, async () => {
      const r = await api("embed", { method: "POST", body: { ...data(), ...(mode === "edit" ? { edit: val("eEdit") } : { channel: val("eCh") }) } });
      if (mode === "send") PAGES.embed(el);
    }, mode === "send" ? "Gesendet ✓" : "Gespeichert ✓");
    $("eTitle").value = "📢 Neues Update"; $("eDesc").value = "Hier steht dein Text. **Fett**, *kursiv* und Zeilenumbrüche gehen auch.";
    preview();
  };
})();
