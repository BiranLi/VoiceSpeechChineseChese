<div align="center">

# 🎙️ Voice Speech Chinese Chess · 语音中国象棋

**基于 WebAssembly 引擎的本地离线中国象棋网页版，目标加入语音控制下棋玩法**

纯前端 · 零后端 · 本地运行 · WASM 引擎 · 语音控制（规划中）

</div>

---

## 📖 项目简介

本项目是开源项目 [billzi2016/Chinese-Chess-AI](https://github.com/billzi2016/Chinese-Chess-AI) 的衍生项目（Fork），在保留原项目全部能力的基础上：

- ✅ **修复棋盘渲染** —— 使用 SVG 绘制标准中国象棋棋盘（竖线楚河断开、横线、九宫斜线、炮位/兵位十字标记），彻底告别"表格化"棋盘格
- ✅ **新增对局控制条** —— 暂停/继续、悔棋、结束（返回主菜单）三枚按钮
- 🎯 **语音控制下棋（Roadmap）** —— 通过语音说出棋谱（如"炮二平五"）来落子，后续版本实现

引擎为编译为 **WebAssembly** 的 [ElephantEye（象眼）](https://github.com/xqbase/eleeye) C++ 中国象棋引擎，全部算力在**浏览器本地**完成，无需任何服务器，完全离线可用。

> **在线体验**（原项目 GitHub Pages）：https://billzi2016.github.io/Chinese-Chess-AI/

---

## ✨ 功能特性

| 功能 | 说明 |
|---|---|
| 🎮 **三种对弈模式** | 本机双人（PvP）· 人机对战（PvE）· 机机对战（EvE） |
| 🧠 **WASM 引擎算力** | 象眼引擎编译为 WebAssembly，本地 Alpha-Beta 搜索，击败业余选手 |
| ⚡ **Web Worker 线程解耦** | 引擎常驻独立线程，主界面保持 60fps 流畅响应 |
| 📊 **实时搜索评分面板** | 侧边栏实时展示深度、节点数、NPS、耗时与评估分，绝不伪造数据 |
| 🎨 **标准棋盘渲染** | SVG 绘制传统棋盘线：外框、竖线（河界断开）、横线、九宫斜线、炮位/兵位标记 |
| ⏯️ **对局控制条** | 暂停/继续（阻止走子与 AI 搜索、丢弃在算结果）· 悔棋（撤 1-2 步）· 结束（返回主菜单） |
| 📱 **响应式布局** | 桌面端双栏、小屏自动切换单列 |

---

## 🚀 快速开始

项目零依赖，只需 Python 3（macOS/Linux/Windows 均自带）：

```bash
# 1. 克隆项目
git clone https://github.com/BiranLi/VoiceSpeechChineseChese.git
cd VoiceSpeechChineseChese

# 2. 启动本地服务器（固定 6324 端口）
python3 server.py

# 3. 浏览器打开
open http://127.0.0.1:6324/
```

> ⚠️ **必须通过服务器访问**，不要直接双击 `index.html` 打开 —— WASM + Web Worker 需要
> `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` 隔离头与正确的 WASM MIME 类型，
> `file://` 协议下引擎无法加载。项目内置的 `server.py` 已自动处理这一切。

端口被占用时：`python3 server.py --port 8080`

---

## 🕹️ 操作说明

1. 点击 **「开始」** → 选择模式（本机双人 / 人机对战 / 机机对战）
2. 人机对战可选手 **玩家先走（执红）** 或 **电脑先走（执黑）**
3. 点击己方棋子查看可走位置（绿色可落子、红色可吃子），再点击目标格落子
4. 对局控制条（棋盘上方）：

| 按钮 | 功能 |
|---|---|
| ⏸️ **暂停 / 继续** | 暂停：禁止落子、停止 AI 搜索、丢弃在算结果；继续：按需自动恢复 AI 思考 |
| ↩️ **悔棋** | 人机模式轮到玩家时撤 2 步（AI 一步 + 玩家一步），其余情况撤 1 步 |
| ⏹️ **结束** | 重置棋局、清空统计、返回主菜单重新选模式 |

---

## 🏗️ 技术架构

三层解耦架构：**视图 UI → 规则裁判 → 算力引擎**

```text
+---------------------------------------------------------+
|                  Web UI (视图层)                         |
|  xiangqiboard.js (DOM 棋盘 / SVG 棋盘线 / 控制条)        |
+----------------------------+----------------------------+
                             | (事件: 尝试落子)
                             v
+---------------------------------------------------------+
|             xiangqi.js (规则裁判层)                      |
|  校验着法合法性 / 维护 FEN 状态 / 将军与困毙检测         |
+----------------------------+----------------------------+
                             | (PostMessage: FEN + 'go movetime 5000')
                             v
+---------------------------------------------------------+
|            Web Worker (后台算力桥接层)                   |
|  eleeye.js + eleeye.wasm (象眼引擎，限制 5s 思考)        |
+---------------------------------------------------------+
```

### 目录结构

```
├── index.html                 # 入口页面（含对局控制条）
├── server.py                  # 本地静态服务器（COOP/COEP 隔离头 + WASM MIME）
├── js/
│   ├── app.js                 # 主应用：对局流程、AI 桥接、暂停/悔棋/结束逻辑
│   ├── xiangqi.js             # 规则裁判（FEN / 着法合法性 / 将军困毙）
│   ├── xiangqiboard.js        # DOM 棋盘渲染 + SVG 标准棋盘线
│   └── worker/
│       ├── eleeye.worker.js   # WASM 引擎 Web Worker 桥接（UCCI 协议）
│       ├── eleeye.js          # Emscripten 胶水代码
│       └── eleeye.wasm        # 象眼引擎编译产物
├── styles/                    # CSS Design Tokens + 组件化样式
├── third-party/eleeye/        # 象眼引擎 C++ 源码
├── specs/                     # PRD / UI / 项目结构文档
└── test/                      # 单元测试（规则 / UCCI 解析 / WASM 算力 / 服务器）
```

---

## 🎯 路线图：语音控制下棋

> 本项目（VoiceSpeechChineseChese）的核心方向 —— 让玩家**用嘴下棋**。

### 规划能力

- **语音识别**：说出标准中国象棋记谱（"炮二平五"、"马八进七"、"前车进一"、"兵五进一"）即可落子
- **记谱解析器**：结合棋盘实时状态解析记谱文本 → 落子坐标（支持"前/后"消歧、红黑方数字视角差异）
- **语音反馈**：识别结果回显、无效着法提示、AI 应手播报
- **完全离线选项**：可选接入本地 WASM 语音识别模型（如 sherpa-onnx），识别也无需联网

### 技术选型（待定，欢迎讨论）

| 方案 | 识别 | 优点 | 缺点 |
|---|---|---|---|
| A. Web Speech API | 在线（浏览器内置） | 实现快、中文识别好 | 识别需联网，下棋仍离线 |
| B. 本地 WASM ASR | 完全离线 | 全链路离线 | 需集成模型文件，工程量大 |

---

## 🧪 测试

```bash
bash test/run_tests.sh
```

覆盖：规则引擎单测、Worker UCCI 解析、WASM 引擎真实算力搜索（本地验证）、服务器响应头探针。

---

## 📄 致谢与开源许可

本项目是 [billzi2016/Chinese-Chess-AI](https://github.com/billzi2016/Chinese-Chess-AI) 的衍生项目，整体遵循与其核心引擎一致的 **GNU Lesser General Public License v2.1 (LGPL v2.1)**。

### 上游与本项目引用的开源项目

| 项目 | 作者 | 协议 | 用途 |
|---|---|---|---|
| [Chinese-Chess-AI](https://github.com/billzi2016/Chinese-Chess-AI) | billzi2016 | LGPL-2.1 | 本项目上游，WASM 编译管线与三层架构 |
| [ElephantEye（象眼）](https://github.com/xqbase/eleeye) | 黄晨 (Morning Yellow) | LGPL-2.1 | UCCI 中国象棋引擎核心（`third-party/eleeye`） |
| [xiangqi.js](https://github.com/lengyanyu258/xiangqi.js) | Jeff Hlywa & lengyanyu258 | BSD 2-Clause | FEN 解析、着法合法性、将军/困毙检测 |
| [xiangqiboardjs](https://github.com/lengyanyu258/xiangqiboardjs) | Chris Oakman & lengyanyu258 | MIT | DOM 棋盘绘制与点击交互 |

> **合规说明**：所有第三方开源项目版权归原作者所有，各自遵循其原生许可（LGPL-2.1 / BSD-2-Clause / MIT）。
> 完整协议全文见 [LICENSE](LICENSE)。

---

## 🤝 贡献

欢迎 Issue / PR！如果你对语音识别方案（Web Speech API vs 本地 WASM ASR）有想法，欢迎在 Discussions 中讨论。
