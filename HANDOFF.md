# 📋 HANDOFF 交接文档 — Voice Speech Chinese Chess（语音中国象棋）

> 本文档描述项目当前状态。开发主战场：**Windows**（原在 macOS 开发，已完成迁移）。
> 项目仓库：`git@github.com:BiranLi/VoiceSpeechChineseChese.git`（branch: `main`）

---

## 1. 项目一句话

**本地运行的中国象棋网页版**：WASM 象眼引擎（离线 AI 下棋）+ **语音控制下棋**（阿里云百炼 Qwen ASR），纯前端 + 一个轻量 Python 静态服务器，零第三方依赖。

语音交互**主要面向震颤 / 构音障碍 / 认知疲劳人群**（如帕金森患者），设计取舍见第 5 节。

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

**协议**：整个项目 **LGPL-2.1**。第三方：xiangqi.js=BSD-2、xiangqiboardjs=MIT。**改代码务必保留各文件头部版权注释。**

---

## 3. Windows 上如何运行

### 3.1 前置条件
- **Python 3.7+**，且 **必须能 `import ssl`**（见 3.6，这是最容易踩的坑）
- **Node.js LTS**（仅运行单元测试需要，游戏本身不需要）
- **Chrome 或 Edge** 浏览器（语音识别需要，Chrome 首选）

### 3.2 一键启动（推荐）
```bat
:: 项目根目录双击或执行
start.bat
:: 换端口：
start.bat 8080
```

### 3.3 ⚠️ 批处理文件编码要求（务必遵守）

**`start.bat` 与 `test/run_tests.bat` 必须以 `GBK(代码页 936)` + `CRLF` 保存，且【禁止】加 `chcp 65001`。**

原因：cmd.exe 解析批处理文件时按 OEM 代码页跟踪**字节偏移**，遇到多字节字符（如全角冒号 `：`）会产生累积漂移，把后续行的行首吞掉，表现为：

```
rem 功能：
1. 检查 Python 3
'1.' is not recognized as an internal or external command
```

`chcp 65001` **无法**规避这个问题（已实测确认）。若需修改这两个文件，请在编辑器中选择 GBK 编码保存，并保持**不要使用 emoji**（GBK 无法表示，会显示成 `???`）。

`.gitattributes` 已配置 `*.bat working-tree-encoding=GBK`：仓库内存 UTF-8，检出到工作区自动转 GBK。

另有一条 cmd.exe 陷阱与编码无关：**括号块内的 `echo` / `set /p` 命令行里不能出现未转义的半角括号**（`)` 会被当作块终止符，导致 `if/else` 两个分支同时执行或走错路）。需要时写成 `^(` `^)`，或干脆避免使用括号。`test/lint_bat.py` 会静态检查这一点。

### 3.4 手动启动
```bat
python server.py --port 6324
:: 浏览器打开 http://127.0.0.1:6324/
```
> 必须通过服务器访问（COOP/COEP 跨源隔离需要），**不要**直接双击 `index.html`。

### 3.5 配置语音识别 Key
```bat
setx DASHSCOPE_API_KEY "sk-你的百炼key"   :: 永久（需**重开终端**才生效）
```
- Key 获取：https://bailian.console.aliyun.com/ （华北2北京地域）
- 不配置 Key：游戏可正常玩（人机/双人/机机），仅语音按钮提示未配置

### 3.6 ⚠️ Anaconda 的 SSL 陷阱（本项目迁移时踩过的最大坑）

若 Python 来自 Anaconda / Miniconda，**未激活环境直接调用 `python.exe` 会因找不到 `Library\bin` 下的 OpenSSL DLL 而导致 `import ssl` 失败**。后果是语音功能 100% 不可用，且报错极具误导性：

```
urllib.error.URLError: <urlopen error unknown url type: https>
```

**修复**：把以下目录加入系统 PATH（Anaconda 安装器通常只加了 `Scripts`，没加这些）：

```
<conda根目录>
<conda根目录>\Library\bin
<conda根目录>\Library\mingw-w64\bin
```

验证：`python -c "import ssl; print(ssl.OPENSSL_VERSION)"`

`start.bat` 已内置 SSL 预检，检测到损坏会给出上述修复指引并提示"将启动无语音版本"。

### 3.7 常见 Windows 问题

| 问题 | 解决 |
|---|---|
| `python` 是微软商店的 0 字节占位程序 | `C:\Users\<你>\AppData\Local\Microsoft\WindowsApps\python.exe` 会抢占 `python`。把真 Python 目录插到 PATH 中 WindowsApps **之前**；`start.bat` 已改为实际执行一次来验证解释器，不受影响 |
| `python` 不是内部或外部命令 | 用 `py -3`（`start.bat` 会自动尝试 `py -3` → `python` → `python3`） |
| 端口被占用 | `start.bat 8080` 换端口 |
| 语音按钮点了没反应 | 确认用 Chrome/Edge；确认浏览器允许麦克风权限 |
| `unknown url type: https` | 见 3.6 SSL 陷阱 |
| 批处理输出乱码 / `'xxx' is not recognized` | 见 3.3 编码要求 |

---

## 4. 项目结构

```
├── index.html              # 入口（菜单 / 棋盘 / 控制条 / 语音面板）
├── server.py               # ⭐ 本地服务器 + /api/asr 语音代理（Key 注入点）
├── start.sh                # macOS/Linux 一键启动
├── start.bat               # ⭐ Windows 一键启动（GBK+CRLF）
├── .gitattributes          # ⭐ 行尾 / 编码策略（跨 macOS↔Windows 必读）
├── js/
│   ├── app.js              # ⭐ 主控：对局流程 / AI 桥接 / 语音接线与确认流程
│   ├── xiangqi.js          # 规则裁判
│   ├── xiangqiboard.js     # DOM 棋盘渲染
│   ├── notation.js         # 记谱解析器
│   ├── asr.js              # ⭐ 语音状态机（限时窗口 / 噪声自适应 / 确认态）
│   └── worker/             # WASM 引擎桥接
├── styles/
│   └── components/voice.css  # ⭐ 语音面板样式（大字 / 倒计时 / 状态配色）
├── third-party/eleeye/     # 象眼 C++ 源码（LGPL-2.1）
├── specs/                  # 原项目 PRD / UI 文档
└── test/                   # ⭐ 测试套件（见第 6 节）
```

---

## 5. 语音交互模型（核心设计，修改前务必读）

### 5.1 为什么不用"AI 走完自动常开"

面向震颤/构音障碍人群时，"麦克风常开"是有害设计：

1. **震颤 → 持续误触发**：静息性震颤、挪动身体、清嗓子都易越过固定阈值。旧代码在每个错误分支无条件重开收音，形成"误触发 → 报错 → 立刻重开"正反馈循环，无退避无上限。
2. **错误提示被自己的下一句冲掉**：`识别失败…` 紧接着被 `请说棋步…` 覆盖，患者还没看清就消失了。
3. **900ms 静音门限会截断续发音**：`炮……二……平……五` 字间停顿超过门限就被拦腰截断送半句话去识别。**患者越需要慢速清晰发音，越容易失败。**
4. **识别即刻落子不可逆**：误识别后 AI 已应手，唯一补救是点"悔棋"——而这对手抖患者恰恰是最难精准点击的小按钮。**手抖 → 误识别 → 需要手抖才能补救**，是死结。
5. **麦克风常开 = 没有静息边界**，持续消耗注意力。

### 5.2 当前模型：分回合 · 限时窗口 · 两段确认

每个玩家回合的时序：

```
[AI 落子完成]
   ↓
[休息态 REST 3s]   麦克风关闭，玩家有明确的"现在不收音"边界
   ↓  （或玩家按空格立即跳过等待）
[聆听态 LISTENING 10s]  绿色 + 呼吸动画 + 大字提示 + 可见倒计时
   ├─ 空/噪声        → 静默忽略，窗口继续（不报错）
   ├─ 识别到命令词    → 取消 / 悔棋 / 关闭语音
   ├─ 窗口到点        → 回休息态，重新开窗
   └─ 识别成功        ↓
[确认态 CONFIRM 8s]  琥珀色 + 大卡片「炮二平五」+ 棋盘高亮起点→终点
   ├─ 空格 / 回车 / 点「走这步 ✓」/ 说「走」→ 落子，进入 AI 回合
   ├─ Esc / 点「不对 ✗」/ 说「不对 / 重说」→ 放弃候选，重新开窗
   └─ 超时            → 放弃候选，重新开窗
```

**关键点**

| 设计 | 解决什么 |
|---|---|
| 限时窗口取代常开 | 误触发、隐私边界、注意力提示 |
| **两段确认** | 误识别从"不可逆"变成"按一下空格"。震颤患者按空格 ≫ 精准点小按钮 |
| 噪声基线自适应 | 开启时采样 1s 环境底噪，阈值 = max(绝对下限, 底噪 × 3.5) |
| 起始去抖（连续 3 块超阈值） | 滤除震颤与桌面撞击的瞬时尖峰 |
| 静音门限自适应（1600ms → 长句 2600ms） | 构音障碍者的断续发音不被截断 |
| 失败看门狗（连续 3 次） | 停止循环并引导改用点击，避免困在坏状态 |
| 常驻浮层（大字 + 倒计时 + 颜色） | 反馈不被瞬时小字覆盖；一眼可辨麦克风状态 |
| 语音面板放在**右侧栏**（与棋盘并排） | 窄屏下若纵向堆叠会把棋盘顶出视口，而震颤患者滚动本身困难 |

### 5.3 键盘快捷键

| 键 | 行为 |
|---|---|
| `空格` / `回车` | **上下文复用**：有待确认候选 → 确认落子；无候选 → 立即开启收音窗口（窗口已开则重置为完整 10s） |
| `Esc` | 取消候选，重新说一次 |

### 5.4 语音命令词

| 类别 | 词 |
|---|---|
| 确认 | 走 / 确认 / 对 / 好 / 可以 / 行 / 是 / 没错 |
| 取消 | 不 / 不是 / 不对 / 取消 / 重说 / 再说 / 重来 / 换 / 算了 / 错 |
| 悔棋 | 悔棋 / 退回 / 反悔 / 撤销 / 撤回 |
| 关闭语音 | 停 / 安静 / 别听了 / 关闭语音 |

### 5.5 关键函数索引

| 位置 | 函数 | 说明 |
|---|---|---|
| `js/asr.js` | `armTurn()` | 回合调度：休息 → 限时窗口 |
| `js/asr.js` | `openNow()` | 热键强制开窗（跳过休息，重置为完整窗口） |
| `js/asr.js` | `enterConfirm()` / `cancelConfirm()` / `acceptConfirmed()` | 确认态生命周期 |
| `js/asr.js` | `calibrate()` | 环境底噪采样，取中位数 |
| `js/asr.js` | `_vadProcess()` | 单块能量检测 + 起始去抖 + 自适应结束门限 |
| `js/app.js` | `armVoiceTurn()` | 唯一合法的"排一轮收音"入口 |
| `js/app.js` | `handleVoiceCommand()` | 语音回合唯一裁决入口（命令词 vs 新棋步） |
| `js/app.js` | `proposeFromText()` | 解析 + 校验 + 进确认态（**不落子**） |
| `js/app.js` | `acceptPendingMove()` / `rejectPendingMove()` | 确认 / 取消 |
| `js/app.js` | `stopVoiceMode()` | 释放麦克风 + 清候选 + 隐藏浮层 |
| `js/app.js` | `onVoicePauseChanged()` | 对局暂停/恢复时同步语音状态 |
| `server.py` | `_transcribe()` | 构造百炼请求体、解析返回 |

### 5.6 VAD 参数（`js/asr.js` 顶部，可按环境微调）

```js
const VAD = {
  energyFloor: 0.02,    // 绝对阈值下限
  noiseGain: 3.5,       // 实际阈值 = max(energyFloor, 底噪 × noiseGain)
  noiseCalibMs: 1000,   // 底噪采样时长
  onsetBlocks: 3,       // 连续多少块超阈值才算"开始说话"（抗震颤）
  silenceMs: 1600,      // 静音多久结束一句（已为断续发音放宽）
  longSpeechMs: 1500,   // 单句超过此时长后静音门限放宽
  longSilenceMs: 2600,  // 放宽后的门限
  minSpeechMs: 300,     // 太短视为噪声
  maxSpeechMs: 12000
};
const TURN = {
  restMs: 3000,         // 休息态时长
  listenMs: 10000,      // 聆听窗口硬上限
  confirmMs: 8000,      // 确认态超时
  maxFailures: 3        // 连续失败上限
};
```

---

## 6. 测试

```bat
:: Windows（推荐，不依赖 Git Bash）
test\run_tests.bat

:: 或手动
node test\test_xiangqi.js        :: 规则引擎 7 例
node test\test_worker_parser.js  :: UCCI 解析 3 例
node test\test_notation.js       :: 记谱解析 26 例
node test\test_asr_vad.js        :: 语音状态机 / VAD 26 例
python test\test_server_launch.py :: 服务器启动 + COOP/COEP 2 例
python test\test_running_server.py :: 运行中服务探针 2 例（未起服务时自动 skip）
python test\lint_bat.py          :: .bat 解析陷阱静态检查

:: macOS/Linux
bash test/run_tests.sh
```

> `test/test_eleeye_wasm_real.js` 是 WASM 引擎 6 层真实算力测试（本地验证用，CI 默认跳过）。

---

## 7. 已知限制 & 后续方向

### 已知限制
1. **语音识别需联网**（走百炼 API）；下棋本身完全离线（WASM 本地）。
2. **记谱解析容错有限**：识别错字（"炮"↔"砲"、"五"↔"无"）会直接报"无法解析"，**无模糊纠错**。对构音障碍用户这是下一个最该补的能力。
3. VAD 用 `ScriptProcessorNode`（已弃用但全浏览器兼容），后续可升级 AudioWorklet。
4. 无对局持久化：刷新页面即重置。
5. 人机模式仅支持"语音控制玩家方"；机机对战（EvE）禁用语音。
6. **无 TTS 语音播报**（有意为之：避免播报声被自己的 VAD 听到形成自激循环）。纯视觉通道。
7. **无"辅助等级"设置**：静音门限、窗口时长、是否总是确认等目前写死在 `js/asr.js` 顶部常量里，照护者无法在界面上调。

### 建议的后续方向
- **A. 模糊纠错 + 候选列表**（优先级最高）：棋谱词表 + 编辑距离/混淆集；有歧义时给 2–3 个候选让用户选，而不是报错。新增 `js/fuzzy.js`，保持零依赖。
- **B. 辅助等级设置**：给照护者一个界面，一键放宽门限/窗口时长/确认策略。
- **C. 离线 ASR**：接入 sherpa-onnx WASM，全链路离线。
- **D. 升级 VAD**：ScriptProcessor → AudioWorklet。
- **E. 热词增强**：百炼支持 vocabulary 热词列表，可显著提升棋谱识别率。
- **F. 对局回放**：history 已有（含 ucci/捕获），可做棋谱导出 + 复盘 UI。

---

## 8. 开发规范提醒

1. **协议合规**：整体 LGPL-2.1。新增文件请加版权头；不要删除 third-party 目录的 LICENSE 归属。
2. **零依赖原则**：服务器端只用 Python 标准库；前端零构建。加依赖需在 README 明示理由。
3. **Key 安全**：API Key 只允许出现在服务器环境变量/启动参数，**严禁写进前端 JS 或提交到 git**。
4. **测试先行**：改规则/记谱/语音状态机时同步更新 `test/` 下对应测试。语音状态机的任何改动都必须跑 `test_asr_vad.js`。
5. **批处理改动**：遵守第 3.3 节的 GBK 编码要求，改完跑 `python test\lint_bat.py`。
6. **提交规范**：中文 commit message，`feat:/fix:/docs:/chore:` 前缀；提交身份为 GitHub 匿名邮箱（`BiranLi@users.noreply.github.com`），**勿改**。
7. **行尾**：仓库统一存 LF，`.gitattributes` 已配 `* text=auto eol=lf`，`*.bat` 例外为 CRLF+GBK。本仓库 `core.autocrlf=false`。

---

## 9. 当前验证状态

| 项目 | 状态 |
|---|---|
| 本地服务 (6324) | ✅ HTTP 200，COOP/COEP 头正确 |
| `start.bat` 一键启动 | ✅ 无 cmd 解析错误，正确识别解释器 / Key / SSL |
| 语音 ASR 端到端（真实中文语音） | ✅ 合成"炮二平五"经 `/api/asr` 识别完全正确 |
| 记谱解析 | ✅ 26/26 |
| 规则引擎 / UCCI | ✅ 7/7、3/3 |
| 语音状态机 / VAD | ✅ 26/26 |
| 两段确认流程（浏览器内真实驱动） | ✅ 14/14：识别后不落子、空格确认落子、Esc/「不对」取消不落子、乱文本被拒 |
| 快捷键（浏览器内真实驱动） | ✅ 9/9：空格立即开窗、窗口中重置为满窗、候选期确认、Esc 取消 |
| `.bat` 解析陷阱静态检查 | ✅ 无问题 |
| Node.js | ✅ v24.19.0（CI 用 Node 20；本项目测试只用 CommonJS，版本无差异） |
| Python | ✅ 3.8.8（Anaconda，SSL 已修复） |

**上手第一步**：`start.bat` → 开始 → 人机对战 → 开启语音 → 按空格 → 说"炮二平五" → 空格确认 → 再跑一遍 `test\run_tests.bat`。

### 已修复的历史坑（勿重犯）

| 坑 | 说明 |
|---|---|
| `socketserver.ForkingTCPServer` 不存在 | 标准库无此名字，原代码 `import` 直接失败，服务器在任何平台都起不来。已改为能力探测 + Windows 回退多线程 |
| `port_is_free()` 在 Windows 误判 | Windows 的 `SO_REUSEADDR` 允许重复绑定已占用端口，会抢占。已改用 `SO_EXCLUSIVEADDRUSE` 探测 |
| 窗口到期后麦克风死锁 | `_closeWindow()` 未把 `mode` 落回 `rest`，`armTurn()` 提前 return。已修 + 加了 2 条回归测试 |
| 视觉状态与麦克风状态不同步 | `onStateChange` 漏处理 `listening`，导致麦克风已开但界面显示"休息"。患者无法判断能否说话。已修 |
| 批处理 UTF-8 导致 cmd 解析崩溃 | 见第 3.3 节 |
