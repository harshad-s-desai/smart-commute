@echo off
title Smart Commute Server
cd /d "%~dp0"
echo ========================================================
echo   Smart Commute - Full Stack (Frontend + Backend)
echo ========================================================
echo Connecting to PostgreSQL and starting server on port 3000...
echo.
start http://localhost:3000
npm start
pause
