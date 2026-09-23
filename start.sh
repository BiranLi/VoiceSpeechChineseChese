#!/usr/bin/env bash
# =============================================================================
# start.sh - 中国象棋语音版 · 一键启动脚本 (macOS / Linux)
#
# 功能：
#   1. 自动加载 DASHSCOPE_API_KEY（优先当前 shell，其次 ~/.bash_profile、~/.zshrc）
#   2. 检查 Python 3 与端口占用
#   3. 启动本地服务器 (server.py, 默认端口 6324)
#   4. 自动打开浏览器
#
# 用法：
#   ./start.sh                 # 正常启动（Key 从环境变量/bash_profile 读取）
#   ./start.sh --port 8080     # 指定端口
#   DASHSCOPE_API_KEY=sk-xxx ./start.sh   # 临时指定 Key
#   ./start.sh --no-browser    # 不自动打开浏览器
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

PORT=6324
OPEN_BROWSER=1

# ---------- 解析参数 ----------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port)
      PORT="${2:?--port 需要端口号}"
      shift 2
      ;;
    --no-browser)
      OPEN_BROWSER=0
      shift
      ;;
    -h|--help)
      # 只输出文件头部的帮助注释（#!/usr/bin/env bash 到第一个空行）
      awk 'NR==1{next} /^[^#]/{exit} {print substr($0, 3)}' "$0"
      exit 0
      ;;
    *)
      echo "未知参数: $1（可用 --port 指定端口、--no-browser 不开浏览器）" >&2
      exit 1
      ;;
  esac
done

# ---------- 1. 加载 DASHSCOPE_API_KEY ----------
if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
  for RC in "$HOME/.bash_profile" "$HOME/.profile" "$HOME/.zshrc"; do
    if [[ -f "$RC" ]] && grep -q "DASHSCOPE_API_KEY" "$RC" 2>/dev/null; then
      # shellcheck disable=SC1090
      source "$RC" 2>/dev/null || true
      break
    fi
  done
fi

if [[ -z "${DASHSCOPE_API_KEY:-}" ]]; then
  echo "╔══════════════════════════════════════════════════════════════╗"
  echo "║  ⚠️  未检测到 DASHSCOPE_API_KEY                               ║"
  echo "║                                                              ║"
  echo "║  语音控制需要阿里云百炼 API Key（下棋功能不受影响）：          ║"
  echo "║    https://bailian.console.aliyun.com/                       ║"
  echo "║                                                              ║"
  echo "║  方式一：export DASHSCOPE_API_KEY=\"sk-xxx\" 后重新运行        ║"
  echo "║  方式二：echo 'export DASHSCOPE_API_KEY=\"sk-xxx\"' >> ~/.bash_profile ║"
  echo "╚══════════════════════════════════════════════════════════════╝"
  # 不退出：允许不带语音游玩
fi

# ---------- 2. 检查 Python 3 ----------
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ 未找到 python3，请先安装 Python 3：https://www.python.org/downloads/" >&2
  exit 1
fi
PYTHON="$(command -v python3)"
echo "✅ Python: $($PYTHON --version 2>&1)"

# ---------- 3. 检查端口占用 ----------
if lsof -i :"$PORT" >/dev/null 2>&1; then
  echo "⚠️  端口 $PORT 已被占用："
  lsof -i :"$PORT" 2>/dev/null | head -3
  echo "   可选：./start.sh --port 8080 换端口，或先关掉占用进程" >&2
  exit 1
fi

# ---------- 4. 启动服务器 ----------
echo "🚀 启动服务器 (端口 $PORT)..."
DASHSCOPE_API_KEY="${DASHSCOPE_API_KEY:-}" "$PYTHON" server.py --port "$PORT" &
SERVER_PID=$!

# 等待端口就绪（最多 10 秒）
for _ in $(seq 1 20); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null; then
    break
  fi
  sleep 0.5
done

URL="http://127.0.0.1:$PORT/"
echo ""
echo "═══════════════════════════════════════════════"
echo "  🎮 中国象棋语音版已启动"
echo "  地址: $URL"
if [[ -n "${DASHSCOPE_API_KEY:-}" ]]; then
  echo "  🎙️ 语音: 已启用 (qwen-audio-3.1-asr-flash)"
else
  echo "  🎙️ 语音: 未配置 Key，仅可玩人机/双人（无语音）"
fi
echo "  停止: Ctrl+C"
echo "═══════════════════════════════════════════════"

# ---------- 5. 打开浏览器 ----------
if [[ "$OPEN_BROWSER" -eq 1 ]]; then
  sleep 1
  if command -v open >/dev/null 2>&1; then        # macOS
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then  # Linux
    xdg-open "$URL"
  fi
fi

# 前台等待，Ctrl+C 时连带杀掉子进程
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT INT TERM
wait "$SERVER_PID"
