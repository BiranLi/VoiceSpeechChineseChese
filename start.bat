@echo off
rem ===========================================================================
rem start.bat - 中国象棋语音版 · 一键启动脚本 (Windows)
rem
rem [重要] 编码要求：必须保存为 GBK(代码页 936) + CRLF，且【不要】加 chcp 65001。
rem   原因：cmd.exe 解析 UTF-8 批处理文件时按 OEM 代码页跟踪字节偏移，
rem   遇到多字节字符（如全角冒号"："）会产生累积漂移，导致后续行开头被吞掉，
rem   表现为 'xxx' is not recognized。chcp 65001 无法规避这个问题。
rem   emoji 在 GBK 中无法表示，会显示为 ???，故本文件一律使用纯文字标记。
rem
rem 功能：
rem   1. 定位可用的 Python 解释器（实际执行验证，排除微软商店占位程序）
rem   2. 检查 DASHSCOPE_API_KEY 与 Python SSL 组件是否可用
rem   3. 检查端口占用并启动本地服务器 (server.py, 默认端口 6324)
rem   4. 自动打开浏览器
rem
rem 用法：
rem   start.bat                正常启动
rem   start.bat 8080           指定端口
rem ===========================================================================
setlocal enabledelayedexpansion

set "PORT=6324"
if not "%~1"=="" set "PORT=%~1"

echo ============================================================================
echo   中国象棋语音版 · 一键启动 (Windows)
echo ============================================================================
echo.

rem ---------- 1. 定位 Python 解释器 ----------
rem 注意：Windows 上 "python" 可能命中 Microsoft Store 的 0 字节占位程序
rem       （%LOCALAPPDATA%\Microsoft\WindowsApps\python.exe），它会静默失败。
rem       因此不能只看 where 的结果，必须真正执行一次来验证解释器可用。
rem 优先顺序：py -3  >  python  >  python3
set "PYTHON="
for %%C in ("py -3" "python" "python3") do (
    if not defined PYTHON (
        %%~C -c "import sys" >nul 2>nul
        if !errorlevel!==0 set "PYTHON=%%~C"
    )
)
if not defined PYTHON (
    echo [错误] 未找到可用的 Python 解释器。请先安装 Python 3.7+ 并勾选 "Add to PATH":
    echo        https://www.python.org/downloads/
    echo.
    echo        若已安装但仍报此错，多半是 PATH 里的 python 指向了微软商店占位程序，
    echo        可改用:  start.bat 后在命令行里执行  py -3 server.py --port 6324
    pause
    exit /b 1
)
set "PYVER="
for /f "tokens=*" %%v in ('%PYTHON% -c "import sys;print(sys.version.split()[0])" 2^>^&1') do set "PYVER=%%v"
echo [OK] Python: %PYVER%   (解释器: %PYTHON%)

rem ---------- 2. 检查 DASHSCOPE_API_KEY ----------
if "%DASHSCOPE_API_KEY%"=="" (
    echo.
    echo [警告] 未检测到 DASHSCOPE_API_KEY 环境变量。
    echo        语音控制需要阿里云百炼 API Key（下棋功能不受影响）:
    echo          https://bailian.console.aliyun.com/
    echo.
    echo        配置方法（二选一）:
    echo          1. 永久配置:  setx DASHSCOPE_API_KEY "sk-xxx"   然后重新打开终端
    echo          2. 本次配置:  set DASHSCOPE_API_KEY=sk-xxx 然后运行 start.bat
    echo.
    echo        按任意键继续（将启动无语音版本）...
    pause >nul
) else (
    rem 语音依赖 HTTPS 通道。某些 Python 安装（如未正确激活的 Anaconda）缺少 SSL 组件，
    rem 会让 /api/asr 代理以 "unknown url type: https" 失败 —— 这里提前拦截并给出可执行修复。
    %PYTHON% -c "import ssl" >nul 2>nul
    if !errorlevel! neq 0 (
        echo.
        echo [错误] 当前 Python 解释器缺少 SSL 组件，语音功能将无法工作。
        echo        现象: 调用 /api/asr 报 "unknown url type: https"
        echo.
        echo        常见原因与修复（Anaconda / Miniconda）:
        echo          把以下目录加入系统 PATH 后重开终端:
        echo            %%CONDA_PREFIX%%
        echo            %%CONDA_PREFIX%%\Library\bin
        echo            %%CONDA_PREFIX%%\Library\mingw-w64\bin
        echo.
        echo        或改用官方 python.org 安装包自带的完整 CPython。
        echo.
        echo        按任意键继续（将启动无语音版本，仅下棋功能可用）...
        pause >nul
    )
)

rem ---------- 3. 检查端口占用 ----------
rem 注意：Windows 的 SO_REUSEADDR 允许重复绑定已占用端口，因此必须用 netstat 判断，
rem       server.py 内部的 port_is_free() 在 Windows 上已改用 SO_EXCLUSIVEADDRUSE。
netstat -ano -p tcp | findstr /R /C:":%PORT% .*LISTENING" >nul 2>nul
if !errorlevel!==0 (
    echo [错误] 端口 %PORT% 已被占用。请先关闭占用程序，或使用: start.bat 8080
    pause
    exit /b 1
)

rem ---------- 4. 启动服务器 ----------
echo [OK] 启动服务器 (端口 %PORT%)...
rem start 的 errorlevel 不可靠（子进程失败时它仍可能返回 0），
rem 因此不在此处判断成败，改由下面的端口就绪探测给出结论。
start "Chinese-Chess-AI Server" /min %PYTHON% server.py --port %PORT%

rem 等待端口就绪
set /a tries=0
:waitloop
set /a tries+=1
powershell -Command "try {$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 1; exit 0} catch {exit 1}" >nul 2>nul
if !errorlevel!==0 goto ready
if !tries! geq 20 (
    echo [错误] 服务器启动超时（40 秒内 6324 端口无响应）。
    echo        排查建议: 关闭本窗口后手动运行  %PYTHON% server.py --port %PORT%  查看报错信息
    pause
    exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto waitloop

:ready
echo.
echo ============================================================================
echo   中国象棋语音版已启动
echo   地址: http://127.0.0.1:%PORT%/
if not "%DASHSCOPE_API_KEY%"=="" (
    echo   语音: 已启用 ^(qwen-audio-3.1-asr-flash^)
) else (
    echo   语音: 未配置 Key，仅可玩人机/双人（无语音）
)
echo   停止: 关闭最小化的 "Chinese-Chess-AI Server" 控制台窗口，或在其中按 Ctrl+C
echo ============================================================================
echo.

rem ---------- 5. 打开浏览器 ----------
start "" "http://127.0.0.1:%PORT%/"

echo 服务器窗口已最小化运行。按任意键关闭本窗口（不影响服务器）...
pause >nul
