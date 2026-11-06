# ⚒️ Guildsmith

Beschreib deinen Discord-Server im Chat – Guildsmith V1 plant Rollen, Kategorien und Kanäle und baut alles mit einem Klick.

## Einrichten
1. https://discord.com/developers/applications → deine App:
   - **Bot** → Token kopieren
   - **OAuth2** → Client Secret kopieren
   - **OAuth2 → Redirects** → diese zwei Adressen hinzufügen:
     - `http://localhost:3000/auth/callback`
     - `https://crystalsmp.github.io/guildsmith/callback.html`
2. Doppelklick auf `start.bat` → `.env` öffnet sich → Keys eintragen.

## Bats
- `start.bat` / `wartung-aus.bat` – Website + Tunnel starten (Fenster offen lassen)
- `wartung-an.bat` – Seite sperren
- `status-setzen.bat` – Wartung, KI pausiert, Hinweis-Banner oder normal
