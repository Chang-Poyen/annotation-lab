#!/bin/zsh
cd -- "$(dirname -- "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo '请先安装 Node.js 20 或以上，然后再次打开。'
  read -k 1 '?按任意键退出'
  exit 1
fi
echo '标注工坊即将启动。浏览器打开 http://localhost:4173/'
echo '关闭本终端或按 Ctrl+C 停止服务。'
node server.mjs
