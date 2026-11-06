@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 20 或以上，然后再次打开。
  pause
  exit /b 1
)
echo 标注工坊即将启动。浏览器打开 http://localhost:4173/
echo 按 Ctrl+C 停止服务。
node server.mjs
pause
