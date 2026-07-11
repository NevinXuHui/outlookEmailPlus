#!/bin/sh
set -eu

# 固定监听端口（与 .env PORT / 文档一致）
: "${APP_PORT:=5000}"
: "${GUNICORN_WORKERS:=1}"
: "${GUNICORN_THREADS:=8}"
: "${GUNICORN_TIMEOUT:=120}"
: "${GUNICORN_BIND:=0.0.0.0:${APP_PORT}}"
: "${GUNICORN_ACCESS_LOGFILE:=-}"

require_positive_int() {
  name="$1"
  value="$2"
  case "$value" in
    ''|*[!0-9]*)
      echo "$name must be a positive integer, got: $value" >&2
      exit 1
      ;;
  esac
  if [ "$value" -lt 1 ]; then
    echo "$name must be a positive integer, got: $value" >&2
    exit 1
  fi
}

# 从 bind 地址解析端口（默认 5000）
port_from_bind() {
  bind="$1"
  # 取最后一个冒号后的数字
  echo "$bind" | sed -n 's/.*:\([0-9][0-9]*\)$/\1/p'
}

# 启动前清理占用目标端口的旧进程（开发残留 / 重复实例）
clear_stale_port() {
  port="$1"
  if [ -z "$port" ]; then
    return 0
  fi

  pids=""
  if command -v lsof >/dev/null 2>&1; then
    pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [ -z "$pids" ] && command -v fuser >/dev/null 2>&1; then
    # fuser 输出形如 "5000/tcp:  1234"
    pids="$(fuser "${port}/tcp" 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$' || true)"
  fi
  if [ -z "$pids" ] && command -v ss >/dev/null 2>&1; then
    pids="$(ss -lptn "sport = :${port}" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u || true)"
  fi

  if [ -z "$pids" ]; then
    return 0
  fi

  echo "[start-gunicorn] port ${port} in use by: $(echo "$pids" | tr '\n' ' ')"
  echo "[start-gunicorn] killing stale listeners..."
  # 先 SIGTERM，再 SIGKILL
  # shellcheck disable=SC2086
  kill $pids 2>/dev/null || true
  sleep 1
  still=""
  if command -v lsof >/dev/null 2>&1; then
    still="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  fi
  if [ -n "$still" ]; then
    # shellcheck disable=SC2086
    kill -9 $still 2>/dev/null || true
    sleep 1
  fi

  if command -v lsof >/dev/null 2>&1; then
    left="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "$left" ]; then
      echo "[start-gunicorn] ERROR: port ${port} still held by: $left" >&2
      exit 1
    fi
  fi
  echo "[start-gunicorn] port ${port} cleared"
}

require_positive_int GUNICORN_WORKERS "$GUNICORN_WORKERS"
require_positive_int GUNICORN_THREADS "$GUNICORN_THREADS"
require_positive_int GUNICORN_TIMEOUT "$GUNICORN_TIMEOUT"

# 强制固定到 5000：忽略外部把 bind 改成其他端口
GUNICORN_BIND="0.0.0.0:5000"
LISTEN_PORT="$(port_from_bind "$GUNICORN_BIND")"
: "${LISTEN_PORT:=5000}"

clear_stale_port "$LISTEN_PORT"

# Keep the default to one worker so the in-process scheduler is not duplicated.
# Threads let sync endpoints such as wait-message share the worker instead of
# blocking the entire site while waiting on upstream mail providers.
exec gunicorn \
  -w "$GUNICORN_WORKERS" \
  --threads "$GUNICORN_THREADS" \
  -b "$GUNICORN_BIND" \
  --timeout "$GUNICORN_TIMEOUT" \
  --access-logfile "$GUNICORN_ACCESS_LOGFILE" \
  web_outlook_app:app
