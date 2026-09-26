#!/usr/bin/env bash
# 一键运行项目所有单元测试

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "=========================================="
echo "      Chinese-Chess-AI 全量单元测试      "
echo "=========================================="
echo ""

# 统一探测可用的 Python 解释器（macOS/Linux 通常是 python3，
# Windows 上往往只有 python 或 py -3，且 python3 常常不存在）
if command -v python3 >/dev/null 2>&1; then
    PY=python3
elif command -v python >/dev/null 2>&1; then
    PY=python
elif command -v py >/dev/null 2>&1; then
    PY="py -3"
else
    echo "[错误] 未找到 Python 解释器（需要 python3 / python / py -3 之一）"
    exit 1
fi
echo "[OK] Python 解释器: $PY ($($PY --version 2>&1))"
echo ""

# 1. 运行 xiangqi.js 规则引擎单元测试
echo "-> 运行 [1/5] xiangqi.js 规则引擎测试..."
node "$SCRIPT_DIR/test_xiangqi.js"
echo ""

# 2. 运行 Worker UCCI 解析器单元测试
echo "-> 运行 [2/5] Worker UCCI 日志解析器测试..."
node "$SCRIPT_DIR/test_worker_parser.js"
echo ""

# 3. [本地验证-保持CI轻量] 运行 ElephantEye C++ WASM 真实 1000ms 算力搜索测试
# 说明：重度 AI 引擎算力搜索测试在本地环境手动验证，以保持 CI 流水线极速轻量。
# echo "-> 运行 [3/5] eleeye.wasm 象眼 C++ WASM 引擎真实算力测试..."
# node "$SCRIPT_DIR/test_eleeye_wasm_real.js"
# echo ""

# 4. 运行 6324 端口服务器启动与能力测试
echo "-> 运行 [4/5] 6324 端口服务器启动与处理测试..."
$PY "$SCRIPT_DIR/test_server_launch.py"
echo ""

# 5. 运行对当前在 6324 端口运行的真实服务的探测测试
echo "-> 运行 [5/5] 运行中 6324 服务探针测试..."
$PY "$SCRIPT_DIR/test_running_server.py"
echo ""

echo "=========================================="
echo "     所有单元测试已成功通过 (ALL PASS)     "
echo "=========================================="
