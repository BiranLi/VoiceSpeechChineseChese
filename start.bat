@echo off
rem 切换到 UTF-8 代码页，确保中文提示正常显示（本文件以 UTF-8 无 BOM 保存）
chcp 65001 >nul
rem ===========================================================================
rem start.bat - 中国象棋语音版 · 一键启动脚本 (Windows)
rem
rem 功能：
rem   1. 检查 Python 3
rem   2. 检查 DASHSCOPE_API_KEY（未设置时提示如何配置，仍可无语音游玩）
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
echo   🎮 中国象棋语音版 · 一键启动 (Windows)
echo ============================================================================
echo.

rem ---------- 1. 检查 Python ----------
where python >nul 2>nul
if %errorlevel%==0 (
    set "PYTHON=python"
) else (
    where py >nul 2>nul
    if %errorlevel%==0 (
        set "PYTHON=py"
    ) else (
        echo [错误] 未找到 Python。请先安装 Python 3 并勾选 "Add to PATH":
        echo        https://www.python.org/downloads/
        pause
        exit /b 1
    )
)
for /f "tokens=*" %%v in ('%PYTHON% --version 2^>^&1') do echo [OK] Python: %%v

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
)

rem ---------- 3. 检查端口占用 ----------
netstat -ano | findstr ":%PORT% " | findstr "LISTENING" >nul 2>nul
if %errorlevel%==0 (
    echo [错误] 端口 %PORT% 已被占用。请先关闭占用程序，或使用: start.bat 8080
    pause
    exit /b 1
)

rem ---------- 4. 启动服务器 ----------
echo [OK] 启动服务器 (端口 %PORT%)...
start "Chinese-Chess-AI Server" /min %PYTHON% server.py --port %PORT%
if %errorlevel% neq 0 (
    echo [错误] 启动失败，请检查 Python 安装。
    pause
    exit /b 1
)

rem 等待端口就绪
set /a tries=0
:waitloop
set /a tries+=1
powershell -Command "try {$r=Invoke-WebRequest -Uri 'http://127.0.0.1:%PORT%/' -UseBasicParsing -TimeoutSec 1; exit 0} catch {exit 1}" >nul 2>nul
if %errorlevel%==0 goto ready
if %tries% geq 20 (
    echo [错误] 服务器启动超时。
    pause
    exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto waitloop

:ready
echo.
echo ============================================================================
echo   🎮 中国象棋语音版已启动
echo   地址: http://127.0.0.1:%PORT%/
if not "%DASHSCOPE_API_KEY%"=="" (
    echo   🎙️ 语音: 已启用 (qwen-audio-3.1-asr-flash)
) else (
    echo   🎙️ 语音: 未配置 Key，仅可玩人机/双人（无语音）
)
echo   停止: 在托盘图标上右键关闭，或 Ctrl+C
echo ============================================================================
echo.

rem ---------- 5. 打开浏览器 ----------
start "" "http://127.0.0.1:%PORT%/"

echo 服务器窗口已最小化运行。按任意键关闭本窗口（不影响服务器）...
pause >nul
