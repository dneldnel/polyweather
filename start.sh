#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

APP_NAME="Polyweather"

read_env_value() {
  local key="$1"
  local file

  if [[ -n "${!key:-}" ]]; then
    printf '%s\n' "${!key}"
    return
  fi

  for file in .env.local .env .env.example; do
    if [[ -f "$file" ]]; then
      local value
      value=$(grep -E "^${key}=" "$file" | tail -n 1 | cut -d= -f2- || true)
      if [[ -n "$value" ]]; then
        printf '%s\n' "$value"
        return
      fi
    fi
  done
}

print_header() {
  local port
  port="$(read_env_value PORT)"
  port="${port:-3000}"

  printf '\n%s 启动器\n' "$APP_NAME"
  printf '工作目录: %s\n' "$(pwd)"
  printf '预计访问: http://127.0.0.1:%s\n\n' "$port"
}

ensure_dependencies() {
  if [[ ! -d node_modules ]]; then
    printf '未找到 node_modules，先执行 npm install...\n'
    npm install
  fi
}

start_dev() {
  ensure_dependencies
  printf '启动开发模式: npm run dev\n'
  exec npm run dev
}

start_prod() {
  ensure_dependencies
  if [[ ! -f dist/server/server/index.js || ! -f dist/client/index.html ]]; then
    printf '未找到生产构建产物，先执行 npm run build...\n'
    npm run build
  fi

  printf '启动生产模式: npm start\n'
  exec npm start
}

build_then_start_prod() {
  ensure_dependencies
  printf '重新构建并启动生产模式: npm run build && npm start\n'
  npm run build
  exec npm start
}

choose_mode() {
  print_header
  cat <<'MENU'
请选择启动方式:
  1) 开发模式       npm run dev
  2) 生产模式       npm start（如缺少 dist 会先 build）
  3) 重新构建并生产 npm run build && npm start
  q) 退出
MENU

  printf '\n输入选项 [1-3/q]: '
  read -r choice
  case "$choice" in
    1) start_dev ;;
    2) start_prod ;;
    3) build_then_start_prod ;;
    q|Q) printf '已退出。\n' ;;
    *) printf '无效选项: %s\n' "$choice"; exit 1 ;;
  esac
}

case "${1:-}" in
  ""|menu) choose_mode ;;
  dev|development) print_header; start_dev ;;
  prod|production|start) print_header; start_prod ;;
  build-prod|rebuild|build-start) print_header; build_then_start_prod ;;
  -h|--help|help)
    cat <<'HELP'
用法:
  ./start.sh                 显示交互菜单
  ./start.sh dev             开发模式
  ./start.sh prod            生产模式，缺少 dist 时自动 build
  ./start.sh build-prod      重新 build 后生产启动
HELP
    ;;
  *) printf '未知参数: %s\n运行 ./start.sh --help 查看用法。\n' "$1"; exit 1 ;;
esac
