/**
 * app.js - 主应用装配与 UI 交互控制器
 * 严格使用真实数据填充 AI 评分表，拒绝任何 Mock
 */

document.addEventListener('DOMContentLoaded', function () {
  let game = new Xiangqi();
  let board = null;
  let moveCount = 0;
  let playerSide = 'r'; // 'r' 执红先走，'b' 执黑后走
  let gameMode = 'pve';  // 'pve', 'pvp', 'eve'

  // 初始化 DOM 9x10 棋盘
  board = new XiangqiBoard('board-container', {
    onMove: function (from, to) {
      handleHumanMove(from, to);
    }
  });

  let worker = null;
  let latestInfo = null;
  let lastMove = null;
  let gamePaused = false; // 对局暂停标志：阻止走子与 AI 搜索，丢弃在算结果

  // 初始化 ElephantEye Worker 算力桥接
  try {
    worker = new Worker('./js/worker/eleeye.worker.js');
    worker.postMessage({ type: 'INIT' });

    worker.onmessage = function (e) {
      const data = e.data || {};
      if (data.type === 'INFO') {
        latestInfo = data.info;
        if (latestInfo) {
          updateAiCurrentStatus(`AI Alpha-Beta 剪枝搜寻中... (深度: ${latestInfo.depth || '-'})`);
        }
      } else if (data.type === 'BEST_MOVE') {
        handleAiBestMove(data.move, latestInfo);
        latestInfo = null;
      }
    };
  } catch (err) {
    console.warn('Worker 初始化提示:', err);
  }

  // 全局终局胜负判定
  function triggerGameOver(winnerText) {
    updateAiCurrentStatus(`对局结束！${winnerText}`);
    const summaryEl = document.getElementById('game-summary');
    const summaryText = document.getElementById('game-summary-text');
    if (summaryEl && summaryText) {
      summaryText.innerText = winnerText;
      summaryEl.classList.remove('hide');
    }
  }

  function checkGameOver() {
    if (!game) return false;

    // 1. 物理检查：判断棋盘上红帅 ('r') 与黑将 ('b') 是否被吃掉
    let hasRedKing = false;
    let hasBlackKing = false;
    for (let i = 0; i < 90; i++) {
      const p = game.board[i];
      if (p && p.type === 'k') {
        if (p.color === 'r') hasRedKing = true;
        if (p.color === 'b') hasBlackKing = true;
      }
    }

    if (!hasRedKing) {
      triggerGameOver('黑方胜！(红帅被吃)');
      return true;
    }
    if (!hasBlackKing) {
      triggerGameOver('红方胜！(黑将被吃)');
      return true;
    }

    // 2. 规则检测：判断当前行动方是否将死或困毙无子可走
    if (typeof game.in_checkmate === 'function' && game.in_checkmate()) {
      const winnerStr = (game.turn === 'r') ? '黑方胜！(红方被将死)' : '红方胜！(黑方被将死)';
      triggerGameOver(winnerStr);
      return true;
    }

    if (typeof game.in_stalemate === 'function' && game.in_stalemate()) {
      const winnerStr = (game.turn === 'r') ? '黑方胜！(红方困毙)' : '红方胜！(黑方困毙)';
      triggerGameOver(winnerStr);
      return true;
    }

    return false;
  }

  // 绑定再来一局按钮
  const restartBtn = document.getElementById('restartbtn');
  if (restartBtn) {
    restartBtn.addEventListener('click', function () {
      const summaryEl = document.getElementById('game-summary');
      if (summaryEl) summaryEl.classList.add('hide');
      if (window.onGameStart) {
        window.onGameStart(gameMode, playerSide);
      }
    });
  }

  // 处理 AI 最佳落子
  function handleAiBestMove(ucciMove, info) {
    if (gamePaused) return; // 暂停期间丢弃 AI 搜索结果

    const sq = game.ucciToSq(ucciMove);
    if (!sq) return;

    const moveResult = game.move(sq.from, sq.to);
    if (moveResult) {
      moveCount++;
      lastMove = { from: sq.from, to: sq.to };
      board.render(game, lastMove);
      appendMoveToTable('AI', moveResult, info);

      // 检测是否触发判赢/判输
      if (checkGameOver()) {
        return;
      }

      if (gameMode === 'eve') {
        updateAiCurrentStatus('AI 落子完成。准备进行下一步对决...');
        setTimeout(() => {
          triggerAiThink();
        }, 500);
      } else if (gameMode === 'pve') {
        updateAiCurrentStatus('AI 落子完成。轮到玩家思考落子...');
      }
    }
  }

  window.gameInstance = game;
  board.render(game);

  // 动态更新顶栏左右两侧球形徽章内的字符 (AI / 玩家)
  function updateRoleTags(mode, side) {
    const blackScore = document.getElementById('black-score');
    const redScore = document.getElementById('red-score');
    if (!blackScore || !redScore) return;

    if (mode === 'eve') {
      blackScore.textContent = 'AI';
      redScore.textContent = 'AI';
    } else if (mode === 'pvp') {
      blackScore.textContent = '玩家';
      redScore.textContent = '玩家';
    } else { // pve
      if (side === 'r') {
        blackScore.textContent = 'AI';
        redScore.textContent = '玩家';
      } else {
        blackScore.textContent = '玩家';
        redScore.textContent = 'AI';
      }
    }
  }

  // 全局开局处理函数
  window.onGameStart = function (mode, side) {
    gameMode = mode;
    playerSide = side || 'r';
    moveCount = 0;
    lastMove = null;
    gamePaused = false; // 新对局复位暂停状态

    game = new Xiangqi();
    window.gameInstance = game;
    board.render(game, lastMove);

    // 启用对局控制按钮（机机对战禁用悔棋）
    setControlsEnabled(true);
    updatePauseBtnLabel(false);

    // 更新顶栏角色身份
    updateRoleTags(gameMode, playerSide);

    // 清空侧边栏 AI 评估日志表格
    clearAiStatsTable();
    if (gameMode === 'eve') {
      updateAiCurrentStatus('机机对战启动。AI 正在思考红方第一步...');
      triggerAiThink();
    } else if (gameMode === 'pve' && playerSide === 'b') {
      updateAiCurrentStatus('电脑执红先走。AI 正在思考红方第一步...');
      triggerAiThink();
    } else {
      updateAiCurrentStatus('对局已开始。等待执红玩家落子...');
    }
  };

  // 处理人类玩家落子
  function handleHumanMove(from, to) {
    if (gamePaused) return; // 暂停期间禁止落子
    if (gameMode === 'eve') {
      // 机机对战模式下禁止人类手动操控
      return;
    }

    const piece = game.board[from];
    if (gameMode === 'pve' && piece && piece.color !== playerSide) {
      // 人机对战时只有轮到玩家阵营才能点击操控
      return;
    }

    const moveResult = game.move(from, to);
    if (moveResult) {
      moveCount++;
      lastMove = { from: from, to: to };
      board.render(game, lastMove);
      appendMoveToTable('玩家', moveResult, null);

      if (checkGameOver()) {
        return;
      }

      if (gameMode === 'pve') {
        updateAiCurrentStatus('玩家落子完成。AI 正在思考中...');
        triggerAiThink();
      }
    }
  }

  // 触发象眼 AI 思考
  function triggerAiThink() {
    if (gamePaused) return; // 暂停期间不发起新的搜索

    const currentFen = game.fen();
    if (worker) {
      worker.postMessage({
        type: 'SEARCH',
        fen: currentFen,
        movetime: 5000
      });
    }
  }

  // 动态向右侧侧边栏表格追加真实数据行 (绝不填充 Mock 数据)
  function appendMoveToTable(source, moveStr, info) {
    const tbody = document.getElementById('ai-stats-body');
    const emptyRow = document.getElementById('ai-stats-empty');
    if (emptyRow) emptyRow.remove();

    const tr = document.createElement('tr');
    const sideText = (game.turn === 'b') ? '红' : '黑'; // 刚走的这一步的棋子阵营
    const sourceClass = (source === 'AI') ? 'source-ai' : 'source-human';
    
    let nodesStr = '-';
    let npsStr = '-';
    let timeStr = '-';
    let scoreStr = '-';
    let scoreClass = 'score-neutral';

    if (info) {
      if (info.nodes !== undefined && info.nodes !== '-') nodesStr = (typeof info.nodes === 'number') ? info.nodes.toLocaleString() : info.nodes;
      if (info.nps !== undefined && info.nps !== '-') npsStr = (typeof info.nps === 'number') ? info.nps.toLocaleString() : info.nps;
      if (info.time !== undefined && info.time !== '-') timeStr = (typeof info.time === 'number') ? info.time + 'ms' : info.time;
      if (info.score !== undefined && info.score !== null) {
        scoreStr = (info.score > 0 ? '+' : '') + info.score;
        if (info.score > 0) scoreClass = 'score-positive';
        else if (info.score < 0) scoreClass = 'score-negative';
      }
    }

    // 使用 DOM API 构建行，避免 innerHTML 拼接（防 XSS）
    const cellData = [
      String(moveCount), sideText, source, moveStr,
      nodesStr, npsStr, timeStr, scoreStr
    ];
    cellData.forEach((text, idx) => {
      const td = document.createElement('td');
      td.textContent = text;
      if (idx === 2) td.className = sourceClass;
      if (idx === 7) td.className = scoreClass;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
    const wrap = document.getElementById('ai-table-wrap');
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  // 清空 AI 统计表
  function clearAiStatsTable() {
    const tbody = document.getElementById('ai-stats-body');
    if (tbody) {
      tbody.innerHTML = `
        <tr id="ai-stats-empty">
          <td colspan="9">等待对局开始。开局后显示实时搜索统计</td>
        </tr>
      `;
    }
  }

  // 更新侧边栏底端提示文本
  function updateAiCurrentStatus(msg) {
    const currentEl = document.getElementById('ai-current');
    if (currentEl) {
      currentEl.innerText = msg;
    }
  }

  // ============ 对局控制：语音 · 暂停/继续 · 悔棋 · 结束 ============

  const pauseBtn = document.getElementById('pausebtn');
  const undoBtn = document.getElementById('undobtn');
  const stopBtn = document.getElementById('stopbtn');
  const voiceBtn = document.getElementById('voicebtn');

  function setControlsEnabled(enabled) {
    if (pauseBtn) pauseBtn.disabled = !enabled;
    if (stopBtn) stopBtn.disabled = !enabled;
    if (voiceBtn) voiceBtn.disabled = !enabled;
    if (undoBtn) {
      undoBtn.disabled = !enabled || (gameMode === 'eve'); // 机机对战不支持悔棋
    }
  }

  function updatePauseBtnLabel(paused) {
    if (pauseBtn) pauseBtn.innerText = paused ? '继续' : '暂停';
  }

  // 暂停 / 继续
  function togglePause() {
    if (!game) return;
    gamePaused = !gamePaused;
    updatePauseBtnLabel(gamePaused);

    if (gamePaused) {
      updateAiCurrentStatus('对局已暂停。点击“继续”恢复对局。');
    } else {
      updateAiCurrentStatus('对局继续。');
      // 若暂停前轮到 AI 思考（机机对战 / 人机轮到 AI），恢复后重新触发搜索
      if (gameMode === 'eve') {
        triggerAiThink();
      } else if (gameMode === 'pve' && game.turn !== playerSide) {
        triggerAiThink();
      }
    }
  }

  // 悔棋：人机模式轮到玩家时撤两步（AI 一步 + 玩家一步），否则撤一步；双人模式撤一步
  function handleUndo() {
    if (!game || game.history.length === 0 || gameMode === 'eve') return;

    let steps = 1;
    if (gameMode === 'pve' && game.turn === playerSide && game.history.length >= 2) {
      steps = 2; // 轮到玩家时，把 AI 的上一步也一起撤回
    }

    for (let i = 0; i < steps; i++) {
      if (game.history.length > 0) {
        game.undo();
      }
    }

    moveCount = Math.max(0, moveCount - steps);
    lastMove = null;
    board.render(game, lastMove);
    removeAiStatsRows(steps);
    updateAiCurrentStatus(`已悔棋 ${steps} 步。请重新落子...`);
  }

  // 结束对局：重置棋局，返回主菜单
  function handleStop() {
    // 若正在录音，先取消
    if (chessVoice && isRecording) {
      isRecording = false;
      if (voiceBtn) voiceBtn.classList.remove('recording');
      chessVoice.cancel();
    }

    gamePaused = false;
    updatePauseBtnLabel(false);
    setControlsEnabled(false);

    const boardOptions = document.getElementById('board-options');
    if (boardOptions) boardOptions.classList.remove('hide');

    clearAiStatsTable();
    updateAiCurrentStatus('对局已结束，请选择模式重新开始。');
  }
  // 从 AI 统计表中移除最后 n 行（悔棋时同步回退）
  function removeAiStatsRows(n) {
    const tbody = document.getElementById('ai-stats-body');
    if (!tbody) return;
    for (let i = 0; i < n; i++) {
      const rows = tbody.querySelectorAll('tr');
      if (rows.length === 0 || rows[0].id === 'ai-stats-empty') break;
      tbody.removeChild(rows[rows.length - 1]);
    }
  }

  if (pauseBtn) pauseBtn.addEventListener('click', togglePause);
  if (undoBtn) undoBtn.addEventListener('click', handleUndo);
  if (stopBtn) stopBtn.addEventListener('click', handleStop);

  // ============ 语音控制下棋 ============

  let chessVoice = null;
  let isRecording = false;

  // 语音识别结果 → 记谱解析 → 落子
  function handleVoiceText(text) {
    if (!text) return;
    updateAiCurrentStatus(`🎙️ 识别: ${text}`);

    if (gamePaused) {
      updateAiCurrentStatus(`🎙️ 识别: ${text} —— 对局已暂停，请先点击“继续”`);
      return;
    }
    if (gameMode === 'eve') {
      updateAiCurrentStatus(`🎙️ 识别: ${text} —— 机机对战模式不支持语音操控`);
      return;
    }

    const result = parseChessNotation(game, text);
    if (result.error) {
      updateAiCurrentStatus(`🎙️ ${result.error}`);
      return;
    }

    // 人机对战时校验是否轮到玩家阵营
    const fromPiece = game.board[result.from];
    if (gameMode === 'pve' && fromPiece && fromPiece.color !== playerSide) {
      updateAiCurrentStatus(`🎙️ 识别: ${text} —— 现在轮到${playerSide === 'r' ? '黑方' : '红方'}，不能说己方之外的着法`);
      return;
    }

    // 复用人类落子入口（含 AI 应手、胜负判定、统计表）
    handleHumanMove(result.from, result.to);
    updateAiCurrentStatus(`🎙️ 已落子: ${result.notation}（${text}）`);
  }

  // 语音按钮：点击开始/停止录音
  if (voiceBtn) {
    voiceBtn.addEventListener('click', async function () {
      if (gamePaused) {
        updateAiCurrentStatus('对局已暂停，请先点击“继续”再使用语音');
        return;
      }

      if (!chessVoice) {
        chessVoice = new ChessVoice({
          onStatus: updateAiCurrentStatus,
          onResult: handleVoiceText,
          onError: function (msg) {
            updateAiCurrentStatus('🎙️ ' + msg);
            isRecording = false;
            if (voiceBtn) voiceBtn.classList.remove('recording');
          }
        });
      }

      if (!chessVoice.isSupported()) {
        updateAiCurrentStatus('🎙️ 当前浏览器不支持语音识别（需 Chrome/Edge 等）');
        return;
      }

      if (isRecording) {
        // 停止并识别
        isRecording = false;
        if (voiceBtn) voiceBtn.classList.remove('recording');
        await chessVoice.stop();
      } else {
        // 开始录音
        try {
          await chessVoice.start();
          isRecording = true;
          if (voiceBtn) voiceBtn.classList.add('recording');
        } catch (err) {
          updateAiCurrentStatus('🎙️ 无法访问麦克风: ' + (err && err.message ? err.message : err));
        }
      }
    });
  }
});
