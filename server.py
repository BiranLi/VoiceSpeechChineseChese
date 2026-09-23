#!/usr/bin/env python3
"""
Chinese-Chess-AI 本地静态 Web 开发服务器

功能：
- 默认绑定 6324 端口（可通过 --port 自定义）。
- 支持多进程 / 多线程高并发加载 HTML、CSS、JS 与 .wasm 二进制资源。
- 自动补齐 WASM 的 MIME 类型与 Cross-Origin 隔离响应头 (COOP/COEP)，确保 WASM 和 Worker 正常运行。

使用方法：
    python3 server.py
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import json
import mimetypes
import os
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from socketserver import ForkingTCPServer

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 6324

# ============ 语音识别 (ASR) 配置 ============
# API Key 来源优先级：命令行 --asr-api-key > 环境变量 DASHSCOPE_API_KEY
# 默认模型 qwen-audio-3.1-asr-flash：2026-09-23 发布的 Qwen-Audio 3.1 系列
#   - ASR 全线降价 95%（官方）；新模型通常享有百炼新人免费额度（90 天，华北2北京）
#   - 实测：Base64 直传 + 同步返回，棋谱短句识别正确，适配本地无公网 URL 的代理场景
DEFAULT_ASR_MODEL = "qwen-audio-3.1-asr-flash"
DASHSCOPE_ENV_KEY = "DASHSCOPE_API_KEY"
# DashScope 原生同步端点（qwen-audio-3.1-asr-flash / fun-asr-flash 等）
DASHSCOPE_NATIVE_URL = "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"


class MultiProcessStaticHandler(SimpleHTTPRequestHandler):
    """静态文件处理器：补充 WASM MIME 类型并添加 Cross-Origin 隔离响应头，兼作 /api/asr 语音识别代理"""

    asr_api_key: str | None = None
    asr_model: str = DEFAULT_ASR_MODEL

    def end_headers(self) -> None:
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------------- ASR 语音识别代理 ----------------
    def do_POST(self) -> None:
        if self.path.split("?", 1)[0] != "/api/asr":
            self._send_json(404, {"ok": False, "error": "未知接口"})
            return

        if not self.asr_api_key:
            self._send_json(503, {
                "ok": False,
                "error": "服务器未配置 ASR API Key。请通过环境变量 DASHSCOPE_API_KEY 或启动参数 --asr-api-key 提供。",
            })
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length > 0 else b""
            payload = json.loads(raw.decode("utf-8") or "{}")
            audio_b64 = payload.get("audio_base64", "")
            mime = payload.get("mime", "audio/wav")
            if not audio_b64:
                self._send_json(400, {"ok": False, "error": "缺少 audio_base64 字段"})
                return

            text = self._transcribe(audio_b64, mime)
            self._send_json(200, {"ok": True, "text": text})
        except Exception as exc:  # noqa: BLE001 - 统一兜底返回可读错误
            self._send_json(500, {"ok": False, "error": f"语音识别失败: {exc}"})

    def _transcribe(self, audio_b64: str, mime: str) -> str:
        """转发音频到阿里云百炼，返回识别文本

        fun-asr-flash 系列走 DashScope 原生同步协议，实测正确的请求体：
          parameters.format = wav（不传会报 UNSUPPORTED_FORMAT）
        """
        data_url = f"data:{mime};base64,{audio_b64}"

        # DashScope 原生同步协议（fun-asr-flash / qwen-audio-3.0-asr-flash 等）
        body = {
            "model": self.asr_model,
            "input": {"messages": [{
                "role": "user",
                "content": [{"audio": data_url}],
            }]},
            "parameters": {"format": "wav"},
        }
        resp = self._post_json(DASHSCOPE_NATIVE_URL, body)
        try:
            # fun-asr-flash 返回 output.output.sentence.text
            return resp["output"]["output"]["sentence"]["text"].strip()
        except (KeyError, IndexError, TypeError):
            pass
        try:
            # 兼容 qwen-audio-3.0-asr-flash 的 output.choices[].message.content 结构
            c = resp["output"]["choices"][0]["message"]["content"]
            text = c[0]["text"] if isinstance(c, list) else c["text"]
            return str(text).strip()
        except (KeyError, IndexError, TypeError):
            raise RuntimeError(f"百炼返回格式异常: {json.dumps(resp, ensure_ascii=False)[:300]}") from None

    def _post_json(self, url: str, body: dict):
        """向百炼发起 JSON POST 请求并解析响应"""
        # 安全审计：仅允许 http/https，杜绝 file: 等自定义 scheme
        scheme = urllib.parse.urlparse(url).scheme.lower()
        if scheme not in ("http", "https"):
            raise RuntimeError(f"拒绝访问非 http(s) 地址: {url}")
        req = urllib.request.Request(
            url,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.asr_api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"百炼 HTTP {exc.code}: {detail[:300]}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"无法连接百炼: {exc.reason}") from exc

    def _send_json(self, status: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def port_is_free(host: str, port: int) -> bool:
    """检查指定端口是否处于可绑定闲置状态"""
    with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((host, port))
        except OSError:
            return False
        return True


def parse_args() -> argparse.Namespace:
    """解析命令行参数"""
    parser = argparse.ArgumentParser(description="Chinese-Chess-AI 开发服务器")
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"监听地址，默认 {DEFAULT_HOST}")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"指定端口，默认 {DEFAULT_PORT}")
    parser.add_argument("--mode", choices=["process", "thread"], default="process", help="并发模式：process (多进程) 或 thread (多线程)")
    parser.add_argument(
        "--asr-api-key",
        default=os.environ.get(DASHSCOPE_ENV_KEY, ""),
        help="阿里云百炼 API Key（语音识别用）。也可通过环境变量 DASHSCOPE_API_KEY 提供。",
    )
    parser.add_argument(
        "--asr-model",
        default=DEFAULT_ASR_MODEL,
        help=f"语音识别模型，默认 {DEFAULT_ASR_MODEL}（DashScope 同步，Base64 直传）。可选 qwen-audio-3.0-asr-flash 等。",
    )
    return parser.parse_args()


def main() -> None:
    """启动并发静态服务器"""
    mimetypes.add_type("application/wasm", ".wasm")
    mimetypes.add_type("text/javascript", ".js")

    args = parse_args()

    if not port_is_free(args.host, args.port):
        print(f"错误: 端口 {args.port} 已被占用，请先释放端口或指定其他端口。", file=sys.stderr)
        sys.exit(1)

    handler = functools.partial(MultiProcessStaticHandler, directory=os.fspath(PROJECT_ROOT))
    # 通过类属性注入 ASR 配置（partial.keywords 会被当作构造参数，不能用）
    MultiProcessStaticHandler.asr_api_key = args.asr_api_key or None
    MultiProcessStaticHandler.asr_model = args.asr_model or DEFAULT_ASR_MODEL

    if args.mode == "process":
        server_class = ForkingTCPServer
        mode_desc = "多进程并发 (Forking)"
    else:
        server_class = ThreadingHTTPServer
        mode_desc = "多线程并发 (Threading)"

    server = server_class((args.host, args.port), handler)

    url = f"http://{args.host}:{args.port}/"
    print(f"Chinese-Chess-AI 本地服务已启动 ({mode_desc})", flush=True)
    print(f"服务地址: {url}", flush=True)
    if args.asr_api_key:
        print(f"语音识别 ASR 已启用: 模型={args.asr_model or DEFAULT_ASR_MODEL}", flush=True)
    else:
        print(
            f"语音识别 ASR 未配置（缺少 API Key）。"
            f"可用环境变量 {DASHSCOPE_ENV_KEY} 或参数 --asr-api-key 开启。",
            flush=True,
        )
    print("按下 Ctrl+C 可停止服务。", flush=True)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已成功停止。", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
