@echo off
rem Enciende el tablero (si no está encendido) y lo abre en el navegador.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://localhost:3000/ -TimeoutSec 2 | Out-Null } catch { Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden -RedirectStandardOutput '%~dp0data\servidor.log' -RedirectStandardError '%~dp0data\servidor-errores.log'; Start-Sleep -Seconds 2 }"
start "" http://localhost:3000
