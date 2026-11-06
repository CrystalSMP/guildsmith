@echo off
chcp 65001 >nul
title Guildsmith
cd /d "%~dp0"

where node >nul 2>nul || (echo Node.js fehlt: https://nodejs.org & pause & exit /b)

if not exist ".env" (
  copy .env.example .env >nul
  echo Bitte trag deinen GEMINI_API_KEY und DISCORD_BOT_TOKEN in die .env ein.
  notepad .env
)

if not exist "node_modules" (
  echo Installiere Pakete...
  call npm install --silent
)

echo.
echo  Guildsmith startet...  Lokal: http://localhost:3000
echo  (Fenster offen lassen. Beenden mit Strg+C)
echo.
start "" http://localhost:3000
node start.js
pause
