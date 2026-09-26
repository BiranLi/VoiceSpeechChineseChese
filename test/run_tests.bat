@echo off
rem ===========================================================================
rem run_tests.bat - 全量单元测试 (Windows 原生入口)
rem
rem [重要] 编码要求：必须保存为 GBK(代码页 936) + CRLF，且【不要】加 chcp 65001。
rem   原因同 start.bat：cmd.exe 解析 UTF-8 批处理时字节偏移会漂移。
rem   emoji 在 GBK 中无法表示，故本文件一律使用纯文字标记。
rem
rem 与 test/run_tests.sh 等价，但不依赖 Git Bash。
rem 用法：
rem   test\run_tests.bat          运行全部测试
rem ===========================================================================
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"
set "PROJECT_ROOT=%SCRIPT_DIR%.."
pushd "%PROJECT_ROOT%"

set "FAILED=0"
set "STEP=0"
set "TOTAL=6"

echo ==========================================
echo       Chinese-Chess-AI 全量单元测试
echo ==========================================
echo.

rem ---------- 0. 探测可用的 Node.js ----------
rem 注意：两个分支都必须显式设置 HASNODE，否则"找到 node"时 HASNODE 从未定义，
rem       下方的 if defined HASNODE 会全部为假，JS 测试被静默跳过却仍报 ALL PASS。
set "HASNODE="
where node >nul 2>nul
if !errorlevel!==0 (
    for /f "tokens=*" %%v in ('node --version 2^>^&1') do echo [OK] Node.js: %%v
    set "HASNODE=1"
) else (
    echo [错误] 未找到 Node.js，无法运行 JS 单元测试 ^(规则引擎 / UCCI 解析 / 记谱解析 / 语音状态机^)。
    echo        请安装 Node.js LTS: https://nodejs.org/
    echo        winget install OpenJS.NodeJS.LTS
    echo.
    echo        若只想先跑 Python 测试 ^(服务器启动 + 运行中服务探针^)，请输入 y 继续。
    echo.
    set /p SKIPNODE=仅运行 Python 测试？输入 y 继续，直接回车退出 
    if /i not "!SKIPNODE!"=="y" (
        popd
        exit /b 1
    )
    set "HASNODE="
)

rem ---------- 0b. 探测可用的 Python ----------
rem 注意：Windows 上 "python" 可能命中微软商店的 0 字节占位程序，
rem       必须真正执行一次来验证解释器可用。
set "PY="
for %%C in ("py -3" "python" "python3") do (
    if not defined PY (
        %%~C -c "import sys" >nul 2>nul
        if !errorlevel!==0 set "PY=%%~C"
    )
)
if not defined PY (
    echo [错误] 未找到可用的 Python 解释器。
    popd
    exit /b 1
)
for /f "tokens=*" %%v in ('%PY% -c "import sys;print(sys.version.split()[0])" 2^>^&1') do echo [OK] Python: %%v  (%PY%)
echo.

rem ---------- 报告将要执行的测试项，避免"静默跳过却报 ALL PASS" ----------
if defined HASNODE (
    echo 本次将执行 6 项测试：规则引擎 / UCCI 解析 / 记谱解析 / 语音状态机 / 服务器启动 / 服务探针
) else (
    echo [提示] 未启用 Node.js，本次只执行 2 项 Python 测试 ^(服务器启动 / 服务探针^)。
)
echo.

call :run
goto :summary


rem 每个测试项前调用一次，递增步骤编号
:step
set /a STEP+=1
exit /b 0


:run
rem 1. 规则引擎
if defined HASNODE (
    call :step
    echo [!STEP!/!TOTAL!] xiangqi.js 规则引擎测试...
    node "test\test_xiangqi.js"
    if !errorlevel! neq 0 ( echo [FAIL] 规则引擎测试 ^(退出码 !errorlevel!^) & set "FAILED+=1" )
    echo.
)

rem 2. Worker UCCI 解析器
if defined HASNODE (
    call :step
    echo [!STEP!/!TOTAL!] Worker UCCI 日志解析器测试...
    node "test\test_worker_parser.js"
    if !errorlevel! neq 0 ( echo [FAIL] UCCI 解析器测试 ^(退出码 !errorlevel!^) & set "FAILED+=1" )
    echo.
)

rem 3. 记谱解析器
if defined HASNODE (
    call :step
    echo [!STEP!/!TOTAL!] notation.js 记谱解析器测试...
    node "test\test_notation.js"
    if !errorlevel! neq 0 ( echo [FAIL] 记谱解析器测试 ^(退出码 !errorlevel!^) & set "FAILED+=1" )
    echo.
)

rem 4. 语音状态机 / VAD
if defined HASNODE (
    call :step
    echo [!STEP!/!TOTAL!] asr.js 语音状态机与 VAD 测试...
    node "test\test_asr_vad.js"
    if !errorlevel! neq 0 ( echo [FAIL] 语音状态机测试 ^(退出码 !errorlevel!^) & set "FAILED+=1" )
    echo.
)

rem 5. 服务器启动 / COOP-COEP
call :step
echo [!STEP!/!TOTAL!] 6324 端口服务器启动与处理测试...
%PY% "test\test_server_launch.py"
if !errorlevel! neq 0 ( echo [FAIL] 服务器启动测试 ^(退出码 !errorlevel!^) & set "FAILED+=1" )
echo.

rem 6. 运行中服务探针（若 6324 未在跑会自动 skip）
call :step
echo [!STEP!/!TOTAL!] 运行中 6324 服务探针测试...
%PY% "test\test_running_server.py"
if !errorlevel! neq 0 (
    echo [WARN] 探针测试失败 ^(退出码 !errorlevel!^)。若 6324 端口没有服务在跑，此项会自动 skip。
    echo        可先执行 start.bat 6324 拉起服务后重试。
    set "FAILED+=1"
)
echo.

exit /b 0


:summary
echo ==========================================
if !FAILED! equ 0 (
    if defined HASNODE (
        echo    6 项测试全部通过 ^(ALL PASS^)
    ) else (
        echo    2 项 Python 测试通过 ^(ALL PASS^)。注意: 本次未运行 4 项 JS 测试 ^(缺少 Node.js^)。
    )
    echo ==========================================
    popd
    exit /b 0
) else (
    echo    有 !FAILED! 项测试未通过，请检查上方输出
    echo ==========================================
    popd
    exit /b 1
)
