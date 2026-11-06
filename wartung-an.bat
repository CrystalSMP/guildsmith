@echo off
chcp 65001 >nul
title Guildsmith - Wartung an
cd /d "%~dp0"
node maintenance.js on
pause
