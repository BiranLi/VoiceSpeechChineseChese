# 📋 HANDOFF 交接文档 — Voice Speech Chinese Chess（语音中国象棋）

> 本交接文档供 **Windows 平台开发 agent** 无缝接续本项目的开发。
> 项目仓库：`git@github.com:BiranLi/VoiceSpeechChineseChese.git`（branch: `main`）

---

## 1. 项目一句话

**本地运行的中国象棋网页版**：WASM 象眼引擎（离线 AI 下棋）+ **语音控制下棋**（阿里云百炼 Qwen ASR，自动收音 + 本地 VAD 免按键），纯前端 + 一个轻量 Python 静态服务器，零第三方依赖。

---

## 2. 当前技术栈

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS（无框架） | 零构建步骤，浏览器直接加载 |
| 棋盘 | DOM + SVG（自绘标准棋盘线） | 竖线楚河断开、横线、九宫斜线、炮位/兵位标记 |
| 规则引擎 | `js/xiangqi.js`（BSD-2，fork 自 xiangqi.js） | FEN / 着法合法性 / 将军困毙 |
| AI 算力 | ElephantEye 象眼引擎编译为 WASM（LGPL-2.1） | 跑在 Web Worker，UCCI 协议，本地计算 |
| 语音识别 | 阿里云百炼 `qwen-audio-3.1-asr-flash` | 经本地 `server.py` 代理（Key 只在服务器端） |
| 本地服务器 | `server.py`（Python 标准库，零依赖） | 静态文件 + WASM MIME + COOP/COEP + `/api/asr` 代理 |

**协议**：整个项目 **LGPL-2.1**（与上游象眼引擎一致）。第三方：xiangqi.js=BSD-2、xiangqiboardjs=MIT。**改代码务必保留各文件头部版权注释。**

---

## 3. Windows 上如何运行（首要事项）

### 3.1 前置条件
- **Python 3.8+**（安装时勾选 "Add Python to PATH"）
- **Chrome 或 Edge 浏览器**（语音识别需要；Chrome 首选）

### 3.2 一键启动（推荐）
```bat
:: 在项目根目录双击或执行
start.bat
```
脚本会自动：检查 Python → 检查/提示 API Key → 检查端口 6324 → 启动服务器 → 打开浏览器。

> ⚠️ **start.bat 必须以 CRLF 行尾 + UTF-8 编码保存**（已处理）。若编辑后中文乱码，检查文件编码。

### 3.3 手动启动
```bat
python server.py --port 6324
:: 浏览器打开 http://127.0.0.1:6324/
```

### 3.4 配置语音识别 Key（可选，无 Key 也能下棋）
```bat
setx DASHSCOPE_API_KEY "sk-你的百炼key"   :: 永久（需重开终端）
:: 或临时：set DASHSCOPE_API_KEY=sk-xxx 再运行 start.bat
```
- Key 获取：https://bailian.console.aliyun.com/ （华北2北京地域）
- 模型：`qwen-audio-3.1-asr-flash`（2026-09-23 发布，ASR 降价 95%，享新人免费额度）
- 不配置 Key：游戏可正常玩（人机/双人/机机），仅语音按钮提示未配置

### 3.5 常见 Windows 问题
| 问题 | 解决 |
|---|---|
| `python` 不是内部或外部命令 | 重装 Python 勾选 Add to PATH，或改用 `py server.py` |
| 端口被占用 | `start.bat 8080` 换端口 |
| 语音按钮点了没反应 | 确认用的是 Chrome/Edge；确认浏览器允许麦克风权限 |
| 中文乱码 | start.bat 需 UTF-8 + CRLF（已处理，勿用记事本"另存为 ANSI"） |

---

## 4. 项目结构

```
├── index.html              # 入口（菜单遮罩 / 棋盘 / 控制条 / 语音按钮）
├── server.py               # ⭐ 本地服务器 + /api/asr 语音代理（Key 注入点）
├── start.sh                # macOS/Linux 一键启动
├── start.bat               # ⭐ Windows 一键启动
├── js/
│   ├── app.js              # ⭐ 主控：对局流程 / AI 桥接 / 暂停·悔棋·结束 / 语音接线
│   ├── xiangqi.js          # 规则裁判（FEN / isLegalMove / move / undo）
│   ├── xiangqiboard.js     # DOM 棋盘渲染 + SVG 棋盘线 + 点击交互
│   ├── notation.js         # ⭐ 记谱解析器（棋谱文本 → 落子坐标）
│   ├── asr.js              # ⭐ 录音 + VAD 状态机 + 调 /api/asr
│   └── worker/
│       ├── eleeye.worker.js  # WASM 引擎桥接（UCCI 协议解析）
│       ├── eleeye.js         # Emscripten 胶水
│       └── eleeye.wasm       # 象眼引擎编译产物（勿改，重编译见 scripts/build_wasm.sh）
├── styles/                 # CSS Design Tokens + 组件样式
├── third-party/eleeye/     # 象眼 C++ 源码（LGPL-2.1）
├── specs/                  # 原项目 PRD / UI 文档
└── test/                   # ⭐ 测试套件（见第 6 节）
```

---

## 5. 核心链路与关键代码位置

### 5.1 语音控制完整流程
```text
[玩家说话] "炮二平五"
   ↓ js/asr.js: VAD 检测人声(能量阈值0.02) → 自动录音 → 静音0.9s自动提交
   ↓ POST /api/asr (audio_base64, mime)
server.py: 转发百炼 qwen-audio-3.1-asr-flash (parameters.format=wav)
   ↓ 返回文本 "炮二平五。"
js/notation.js: parseChessNotation(game, text) → {from, to} 坐标
   ↓ js/app.js: handleVoiceText → handleHumanMove(from, to)
现有逻辑: AI 应手(triggerAiThink) → 胜负判定 → 统计表 → AI 落子后 maybeAutoListen() 重新收音
```

### 5.2 关键函数索引

| 位置 | 函数/变量 | 说明 |
|---|---|---|
| `js/app.js` | `handleHumanMove(from, to)` | **人类落子唯一入口**（点击/语音都走这里） |
| `js/app.js` | `handleVoiceText(text)` | 语音识别结果 → 记谱解析 → 校验阵营 → 落子 |
| `js/app.js` | `maybeAutoListen()` | AI 落子后自动 resume 收音（语音模式开启时） |
| `js/app.js` | `handleStop()` | 结束对局：停收音、清统计、回主菜单 |
| `js/asr.js` | `ChessVoice` 类 | `startAuto/pause/resume/stopAuto`；VAD 参数在文件顶部 `VAD` 常量 |
| `js/notation.js` | `parseChessNotation(game, text)` | 记谱 → `{from,to}` 或 `{error}` |
| `server.py` | `MultiProcessStaticHandler.do_POST` | `/api/asr` 代理入口 |
| `server.py` | `MultiProcessStaticHandler._transcribe` | 构造百炼请求体、解析返回 |

### 5.3 记谱解析器支持能力（26 个单测覆盖）
- 全部 7 种棋子：帅将 / 仕士 / 相象 / 马 / 车 / 炮 / 兵卒
- 动作：平 / 进 / 退；车炮兵帅按**步数**、马相仕按**落点列号**
- 红黑双视角列号自动换算；汉字/阿拉伯数字均可
- 前/后消歧：带列号（`前炮二进一`）+ 省略列号（`前炮进一`，自动定位双子列）
- 非法拦截：被挡 / 无此子 / 乱文本 / 同列双子未注明前后

### 5.4 VAD 参数（`js/asr.js` 顶部，可按环境微调）
```js
const VAD = {
  energyThreshold: 0.02, // 响度阈值：环境噪音大→调高，说话太轻→调低
  silenceMs: 900,        // 静音多久判定一句话结束
  minSpeechMs: 150,      // 低于此视为噪声自动忽略重听
  maxSpeechMs: 6000      // 单句最长，防卡死
};
```

---

## 6. 测试（接续开发前必跑）

```bat
:: Windows（PowerShell 或 cmd）
python test\test_server_launch.py     :: 服务器启动/COOP-COEP 头
node test\test_xiangqi.js            :: 规则引擎 7 用例
node test\test_worker_parser.js      :: UCCI 解析 3 用例
node test\test_notation.js           :: 记谱解析 26 用例
node test\test_asr_vad.js            :: VAD 状态机 4 用例
:: 或一键：
bash test\run_tests.sh               :: 需 Git Bash（含 WASM 实算+服务器探针）
```

> `test/test_eleeye_wasm_real.js` 是 WASM 引擎 6 层真实算力测试（本地验证用，CI 默认跳过）。

---

## 7. 当前已知限制 & 后续方向

### 已知限制
1. **语音识别需联网**（走百炼 API）；下棋本身完全离线（WASM 本地）。
2. **记谱解析容错有限**：语音识别错字（如"炮"↔"砲"、"五"↔"无"）会直接报"无法解析"，无模糊纠错。
3. VAD 用 `ScriptProcessorNode`（已弃用但全浏览器兼容），后续可升级 AudioWorklet。
4. 无对局持久化：刷新页面即重置，无棋谱保存/回放。
5. 人机模式仅支持"语音控制玩家方"；机机对战（EvE）禁用语音。
6. 免费额度：百炼新人 90 天免费，华北2北京地域；超期后按量计费（约 0.00001 元/秒级）。

### 建议的后续方向（未实施，供接续者选择）
- **A. 语音容错**：同音字/近音字纠错（棋谱词汇表白名单 + Levenshtein 距离），提升"说错也能猜对"
- **B. 对局回放**：history 已有（含 ucci/捕获），可做棋谱导出（XQF/自定义 JSON）+ 复盘 UI
- **C. 离线 ASR**：接入 sherpa-onnx WASM（全链路离线，识别也在本地）
- **D. 升级 VAD**：ScriptProcessor → AudioWorklet（更低延迟、更省资源）
- **E. 热词增强**：百炼支持 vocabulary 热词列表（炮/马/车/进/平/退…），可显著提升棋谱识别率

---

## 8. 接续开发的规范提醒

1. **协议合规**：整体 LGPL-2.1。新增文件请加版权头；不要删除 third-party 目录的 LICENSE 归属。
2. **零依赖原则**：服务器端只用 Python 标准库（勿引入 Flask 等）；前端零构建（勿引入打包器）。加依赖需在 README 明示理由。
3. **Key 安全**：API Key 只允许出现在服务器环境变量/启动参数，**严禁写进前端 JS 或提交到 git**。
4. **测试先行**：改规则/记谱/VAD 逻辑时同步更新 `test/` 下对应测试。
5. **提交规范**：中文 commit message，`feat:/fix:/docs:/chore:` 前缀；提交身份已配置为 GitHub 匿名邮箱（勿改，推送会被 GitHub 拦截）。
6. **运行前**：`python server.py` 必须通过服务器访问（COOP/COEP 需要），**不要**直接双击 index.html。

---

## 9. 最近一次验证状态（交接时）

| 项目 | 状态 |
|---|---|
| 本地服务 (6324) | ✅ 运行中，HTTP 200 |
| 语音 ASR 端到端 | ✅ 真实中文棋谱 3/3 识别正确 |
| 记谱解析 | ✅ 26/26 单测通过 |
| VAD | ✅ 4/4 单测通过 |
| 规则引擎 / UCCI / WASM | ✅ 全部通过 |
| 远程仓库 | ✅ `main` 最新 `fa4d636`（与本地同步） |

**上手第一步建议**：`start.bat` 跑起来 → 走一遍"开始→人机对战→语音模式→说'炮二平五'" → 跑第 6 节全部测试 → 再开始改代码。
