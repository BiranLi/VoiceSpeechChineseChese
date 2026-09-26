#!/usr/bin/env python3
"""
lint_bat.py - 静态检查 .bat 文件的 cmd.exe 解析陷阱

背景
----
cmd.exe 有两个会让批处理"莫名其妙执行错命令"的经典陷阱，两者都不是编码问题，
而是**括号块内出现未转义的半角括号**：

  陷阱 A：块内 `echo 文本 (xxx)` —— 行尾的 `)` 会被当作括号块的终止符。
          表现为 `) was unexpected at this time.` 或 if/else 两个分支同时执行。
          修法：`echo 文本 ^(xxx^)`

  陷阱 B：块内 `set /p VAR=提示(y/N)` —— 提示语里的 `)` 同样会终止括号块，
          导致后面的 else 分支被误执行（脚本静默走错路）。
          修法：提示语里避免使用半角括号，或写成 `^(`

用法
----
python test/lint_bat.py
退出码 0 = 通过；1 = 发现问题
"""

import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# 会开启括号块的语句（行尾以 `(` 结尾，或以 `) else (` 结尾）
BLOCK_OPEN = re.compile(r"\(\s*(else\s*)?$|^\s*(for|if|set|rem)\b.*\(\s*(do\s*)?$", re.IGNORECASE)


def find_bat_files():
    return sorted(PROJECT_ROOT.glob("*.bat")) + sorted(PROJECT_ROOT.glob("*/*.bat"))


def analyze(path: Path):
    """返回 (行号, 行内容, 问题描述) 列表"""
    problems = []
    raw = path.read_bytes()
    # .bat 以 GBK(936) 交付给 cmd.exe（见 .gitattributes 的 working-tree-encoding）
    try:
        text = raw.decode("gbk")
    except UnicodeDecodeError:
        text = raw.decode("utf-8", errors="replace")

    lines = text.split("\r\n")
    in_block = False
    for idx, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped:
            continue

        # 合法的块终止行：整行就是 ")" 或 ") else ("，不是问题
        if re.match(r"^\)(\s*else\s*\(\s*)?$", stripped, re.IGNORECASE):
            in_block = False
            continue
        # 纯开括号行（if xxx ( / for ... do ( ）单独成行
        if re.match(r"^(if|for|set)\b.*\(\s*$", stripped, re.IGNORECASE) and stripped.endswith("("):
            in_block = True
            continue

        opens = _count_unescaped(line, "(")
        closes = _count_unescaped(line, ")")

        if in_block:
            # 块内：echo / set / rem 行出现未转义半角括号即为高危
            body = re.sub(r"^\s*(rem|::)\s*", "", stripped, flags=re.IGNORECASE)
            is_echo = re.match(r"^\s*echo\b", body, re.IGNORECASE)
            is_set = re.match(r"^\s*set\s", body, re.IGNORECASE)
            if (is_echo or is_set) and _has_unescaped_paren(body):
                kind = "echo" if is_echo else "set"
                problems.append((idx, line, f"块内 {kind} 命令含未转义半角括号，可能被当作块终止符（需写成 ^( ^)）"))
        else:
            # 顶层：若本行开启了括号块，检查行内是否有裸括号
            if closes > opens and _has_unescaped_paren(line):
                problems.append((idx, line, "括号块起始行含未转义半角括号"))

        if opens > closes:
            in_block = True
        elif opens < closes:
            in_block = False

    return problems


def _count_unescaped(line: str, ch: str) -> int:
    """统计未被 ^ 转义、且不在引号内的半角括号数量"""
    cnt = 0
    in_quote = False
    i = 0
    while i < len(line):
        c = line[i]
        if c == "^":
            i += 2
            continue
        if c == '"':
            in_quote = not in_quote
            i += 1
            continue
        if c == ch and not in_quote:
            cnt += 1
        i += 1
    return cnt


def _has_unescaped_paren(body: str) -> bool:
    """在命令文本（已剥离命令名）中查找未转义且不在引号内的半角括号"""
    in_quote = False
    i = 0
    while i < len(body):
        c = body[i]
        if c == "^":
            i += 2
            continue
        if c == '"':
            in_quote = not in_quote
            i += 1
            continue
        if not in_quote and c in "()":
            return True
        i += 1
    return False


def main() -> int:
    files = find_bat_files()
    if not files:
        print("未找到 .bat 文件")
        return 0

    total = 0
    print("=" * 60)
    print("      .bat 解析陷阱静态检查 (lint_bat.py)")
    print("=" * 60)

    for f in files:
        rel = f.relative_to(PROJECT_ROOT)
        problems = analyze(f)
        if problems:
            print(f"\n[FAIL] {rel}")
            for idx, line, msg in problems:
                print(f"  行 {idx}: {msg}")
                print(f"        {line.strip()[:100]}")
            total += len(problems)
        else:
            print(f"[PASS] {rel}")

    print()
    print("=" * 60)
    if total:
        print(f"  发现 {total} 处潜在的 cmd 解析陷阱，请修正后重跑")
        print("=" * 60)
        return 1
    print("  未发现 cmd 解析陷阱 (ALL PASS)")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
