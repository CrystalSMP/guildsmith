@echo off
chcp 65001 >nul
title Guildsmith - Status setzen
cd /d "%~dp0"
echo ==================================================
echo   Guildsmith - Status / Modus der Website setzen
echo ==================================================
echo.
echo   [1]  Wartung        - Seite gesperrt, nur Wartungsseite
echo   [2]  KI pausiert    - Seite offen, Plaene erstellen geht NICHT
echo   [3]  Hinweis        - Seite offen, alles geht, nur ein Banner
echo   [4]  Alles normal   - Banner weg, KI an
echo.
set "WAHL="
set /p "WAHL=Auswahl (1-4): "

set "MODUS="
if "%WAHL%"=="1" set "MODUS=on"
if "%WAHL%"=="2" set "MODUS=ai-off"
if "%WAHL%"=="3" set "MODUS=notice"
if "%WAHL%"=="4" set "MODUS=normal"
if not defined MODUS (
  echo Ungueltige Auswahl.
  pause
  exit /b
)

set "TITEL="
set "NACHRICHT="
if not "%MODUS%"=="normal" (
  echo.
  echo Leer lassen = Standardtext.
  set /p "TITEL=Ueberschrift: "
  set /p "NACHRICHT=Nachricht: "
)
echo.
node maintenance.js %MODUS% "%NACHRICHT%" "%TITEL%"
echo.
echo Fertig! Lokal sofort sichtbar, auf GitHub Pages in ca. 1 Minute.
if "%MODUS%"=="on" echo Zurueck online: wartung-aus.bat oder start.bat
pause
