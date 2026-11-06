@echo off
chcp 65001 >nul
title Guildsmith
cd /d "%~dp0"
if not exist node_modules call npm install
echo Wartung wird beendet und die Website startet...
echo (Der Wartungsmodus geht automatisch aus, sobald die Seite online ist.)
echo.
echo  !!! DIESES FENSTER OFFEN LASSEN - sonst ist die Seite offline !!!
echo.
node start.js
pause
