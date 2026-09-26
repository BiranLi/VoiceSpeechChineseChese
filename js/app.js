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
        armVoiceTurn(); // 轮到玩家：进入"休息 -> 限时聆听窗口"调度，而非常开麦克风
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
      onVoicePauseChanged(true);
    } else {
      updateAiCurrentStatus('对局继续。');
      onVoicePauseChanged(false);
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
    // 彻底关闭语音：释放麦克风、清空候选、隐藏浮层
    stopVoiceMode();

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

  // ==========================================================================
  // 语音控制下棋 —— 分回合 · 限时窗口 · 两段确认
  // --------------------------------------------------------------------------
  // 为震颤 / 构音障碍 / 认知疲劳人群设计，与旧版"AI 走完常开免按键"的差别：
  //   1) 麦克风不再常开：只在"轮到玩家"时按 休息 -> 限时聆听窗口 调度，
  //      窗口到点自动关闭，杜绝思考期全程收音造成的误触发。
  //   2) 识别结果不直接落子：先进确认卡片（棋盘高亮起点->终点），
  //      玩家用 空格 / 大按钮 / 说"走" 才真正提交。误识别可零成本反悔。
  //   3) 错误路径不再无条件重开收音，改由回合调度统一接管，并带失败看门狗。
  //   4) 反馈走常驻浮层（大字 + 倒计时 + 颜色状态），不再被下一句瞬时覆盖。
  // ==========================================================================

  const TURN = window.ChessVoice.TURN;   // restMs / listenMs / confirmMs / maxFailures

  // ---- 命令词（语音可达所有关键操作，键盘与大按钮为兜底） ----
  const CMD = {
    accept: ['走', '确认', '对', '好', '可以', '行', '是', '没错', 'ok', 'go'],
    cancel: ['不', '不是', '不对', '取消', '重说', '再说', '重来', '换', '算了', '错', 'no'],
    undo:   ['悔棋', '悔一步', '退回', '反悔', '撤销', '撤回'],
    mute:   ['停', '安静', '别听了', '关闭语音', '停止']
  };

  // 归一化 ASR 文本：去标点、空白，便于命令词前缀匹配
  function normalizeSpeech(text) {
    return String(text || '')
      .replace(/[\s\u3000。，、,.!?！？；;：:~·"'""''（）()]/g, '')
      .toLowerCase();
  }

  // 判断文本是否命中某个命令词集合
  function matchCommand(text, words) {
    const s = normalizeSpeech(text);
    if (!s) return false;
    for (let i = 0; i < words.length; i++) {
      if (s === words[i] || s.indexOf(words[i]) === 0 || s.indexOf(words[i]) >= 0) return true;
    }
    return false;
  }

  // 棋盘格子 -> 人类可读坐标（红方视角：列 a-i，行 1-10）
  const FILES = 'abcdefghi';
  function sqLabel(sq) {
    if (typeof sq !== 'number' || sq < 0 || sq > 89) return '?';
    const row = Math.floor(sq / 9);
    const col = sq % 9;
    return FILES[col] + (10 - row);
  }

  // ---- 浮层 DOM ----
  const voiceOverlay = document.getElementById('voice-overlay');
  const voiceStateText = document.getElementById('voice-state-text');
  const voiceCountdown = document.getElementById('voice-countdown');
  const voiceCountdownNum = document.getElementById('voice-countdown-num');
  const voiceProgressFill = document.getElementById('voice-progress-fill');
  const voiceConfirmCard = document.getElementById('voice-confirm-card');
  const voiceConfirmNotation = document.getElementById('voice-confirm-notation');
  const voiceConfirmSquares = document.getElementById('voice-confirm-squares');
  const voiceAcceptBtn = document.getElementById('voice-accept');
  const voiceRejectBtn = document.getElementById('voice-reject');

  let chessVoice = null;
  let voiceEnabled = false;      // 语音模式是否开启
  let pendingMove = null;        // 待确认的候选棋步 { from, to, notation, raw }

  // 更新浮层视觉状态
  function setVoiceState(state, text) {
    if (voiceOverlay) {
      voiceOverlay.classList.remove('hide');
      voiceOverlay.setAttribute('data-state', state);
    }
    if (voiceStateText) voiceStateText.innerText = text || '';
    if (voiceBtn) voiceBtn.classList.toggle('recording', state === 'listening');
  }

  function hideVoiceOverlay() {
    if (voiceOverlay) {
      voiceOverlay.classList.add('hide');
      voiceOverlay.removeAttribute('data-state');
    }
    if (voiceCountdown) voiceCountdown.classList.add('hide');
    if (voiceConfirmCard) voiceConfirmCard.classList.add('hide');
    if (voiceBtn) voiceBtn.classList.remove('recording');
  }

  // 倒计时回调：进度条 + 剩余秒数；低于 30% 转红提示"快结束了"
  function handleVoiceTick(remainingMs, totalMs) {
    if (voiceCountdown && voiceCountdownNum) {
      voiceCountdown.classList.remove('hide');
      voiceCountdownNum.innerText = (remainingMs / 1000).toFixed(1);
    }
    if (voiceProgressFill) {
      const ratio = totalMs > 0 ? Math.max(0, Math.min(1, remainingMs / totalMs)) : 0;
      voiceProgressFill.style.width = (ratio * 100).toFixed(1) + '%';
      voiceProgressFill.setAttribute('data-urgent', ratio < 0.3 ? '1' : '0');
    }
  }

  // ---------------- 回合调度 ----------------

  // 只有"语音开启 + 人机模式 + 轮到玩家 + 未暂停"才排一次回合。
  // 取代旧版在每个错误分支里无条件调用 maybeAutoListen() 的做法。
  function armVoiceTurn() {
    if (!voiceEnabled || !chessVoice) return;
    if (gameMode !== 'pve') return;
    if (gamePaused) return;
    if (game.turn !== playerSide) return;  // 轮到 AI，不收音
    chessVoice.armTurn();
  }

  // 语音回合的唯一裁决入口：可能是棋步，也可能是命令词
  function handleVoiceCommand(text) {
    if (!text) return;

    // 1) 先判命令词（聆听态下玩家可能想取消/悔棋/闭嘴）
    if (matchCommand(text, CMD.mute)) {
      stopVoiceMode();
      updateAiCurrentStatus('🎙️ 语音已关闭。随时可以点“语音”重新开启。');
      return;
    }
    if (matchCommand(text, CMD.undo)) {
      clearPendingMove();
      chessVoice.armTurn();
      handleUndo();
      return;
    }
    if (matchCommand(text, CMD.cancel)) {
      clearPendingMove();
      if (chessVoice.mode === 'confirm') chessVoice.cancelConfirm();
      else chessVoice.armTurn();
      updateAiCurrentStatus('🎙️ 好的，请再说一次…');
      return;
    }
    if (matchCommand(text, CMD.accept)) {
      if (pendingMove) {
        acceptPendingMove();
        return;
      }
      // 没有待确认的候选时，"走/好"理解为放弃本轮并重开窗口
      chessVoice.armTurn();
      return;
    }

    // 2) 不是命令词 -> 当作新棋步候选，重新解析并更新确认卡片
    proposeFromText(text);
  }

  // 解析棋谱并进入确认态（不落子）
  function proposeFromText(text) {
    if (gamePaused) {
      setVoiceState('error', '对局已暂停，请先点“继续”');
      updateAiCurrentStatus('🎙️ 对局已暂停，请先点击“继续”再使用语音');
      chessVoice.noteFailure();
      return;
    }
    if (gameMode === 'eve') {
      setVoiceState('error', '机机对战不支持语音');
      updateAiCurrentStatus('🎙️ 机机对战模式不支持语音操控');
      return;
    }

    const result = parseChessNotation(game, text);
    if (result.error) {
      // 解析失败：不落子、不开新一轮窗口，只把错误显示出来并重开本轮窗口
      setVoiceState('error', '没听清，请再说一次');
      updateAiCurrentStatus(`🎙️ ${result.error}`);
      chessVoice.noteFailure();
      clearPendingMove();
      board.render(game, lastMove);
      chessVoice.armTurn();
      return;
    }

    // 人机模式校验阵营
    const fromPiece = game.board[result.from];
    if (gameMode === 'pve' && fromPiece && fromPiece.color !== playerSide) {
      const sideName = playerSide === 'r' ? '红方' : '黑方';
      setVoiceState('error', `现在是${sideName}走`);
      updateAiCurrentStatus(`🎙️ 识别: ${text} —— 现在轮到${sideName}，不能说己方之外的着法`);
      chessVoice.noteFailure();
      clearPendingMove();
      chessVoice.armTurn();
      return;
    }

    // 合法性兜底（记谱解析通过但仍需引擎裁决）
    if (game.isLegalMove && !game.isLegalMove(result.from, result.to)) {
      setVoiceState('error', '这一步走不了');
      updateAiCurrentStatus(`🎙️ 识别: ${text} —— ${result.notation} 不符合规则，请换一步`);
      chessVoice.noteFailure();
      clearPendingMove();
      chessVoice.armTurn();
      return;
    }

    pendingMove = {
      from: result.from,
      to: result.to,
      notation: result.notation,
      raw: text
    };

    // 确认卡片 + 棋盘起点->终点高亮
    if (voiceConfirmNotation) voiceConfirmNotation.innerText = result.notation;
    if (voiceConfirmSquares) {
      voiceConfirmSquares.innerText = `起点 ${sqLabel(result.from)} → 落点 ${sqLabel(result.to)}`;
    }
    if (voiceConfirmCard) voiceConfirmCard.classList.remove('hide');
    setVoiceState('confirm', '确认这一步？');
    // 棋盘上高亮候选（复用 lastMove 渲染通路）
    board.render(game, { from: result.from, to: result.to });
    updateAiCurrentStatus(`🎙️ 听到: ${text} → 候选 ${result.notation}，按空格确认`);

    // 进入确认态：麦克风保持开启以支持语音"走/不"，并有独立倒计时
    chessVoice.enterConfirm();
  }

  // 确认：真正落子
  function acceptPendingMove() {
    if (!pendingMove) return;
    const mv = pendingMove;
    pendingMove = null;
    if (voiceConfirmCard) voiceConfirmCard.classList.add('hide');

    // 结束本回合，收起浮层麦克风状态
    chessVoice.acceptConfirmed();
    if (voiceOverlay) voiceOverlay.setAttribute('data-state', 'rest');
    chessVoice.resetFailures();

    updateAiCurrentStatus(`🎙️ 已落子: ${mv.notation}`);
    // 复用人类落子唯一入口（含 AI 应手、胜负判定、统计表）
    handleHumanMove(mv.from, mv.to);
    // AI 落子后由 handleAiBestMove 再次调用 armVoiceTurn()
  }

  // 取消：清候选、棋盘恢复原状、重开本轮窗口
  function rejectPendingMove() {
    if (!pendingMove) return;
    pendingMove = null;
    if (voiceConfirmCard) voiceConfirmCard.classList.add('hide');
    board.render(game, lastMove);
    setVoiceState('listening', '好的，请再说一次…');
    updateAiCurrentStatus('🎙️ 已取消，请再说一次…');
    if (chessVoice) chessVoice.cancelConfirm();
  }

  function clearPendingMove() {
    pendingMove = null;
    if (voiceConfirmCard) voiceConfirmCard.classList.add('hide');
  }

  // 关闭语音模式：释放麦克风 + 清空候选 + 隐藏浮层
  function stopVoiceMode() {
    clearPendingMove();
    if (chessVoice) chessVoice.stopAuto();
    voiceEnabled = false;
    if (voiceBtn) voiceBtn.classList.remove('recording', 'voice-on');
    hideVoiceOverlay();
  }

  // ---------------- 语音按钮 / 键盘 / 大按钮 ----------------

  if (voiceBtn) {
    voiceBtn.addEventListener('click', async function () {
      if (gamePaused) {
        updateAiCurrentStatus('对局已暂停，请先点击“继续”再使用语音');
        return;
      }
      if (gameMode === 'eve') {
        updateAiCurrentStatus('机机对战模式不支持语音控制');
        return;
      }

      if (voiceEnabled) {
        stopVoiceMode();
        updateAiCurrentStatus('语音控制已关闭');
        return;
      }

      if (!chessVoice) {
        chessVoice = new ChessVoice({
          onStatus: function (msg) { updateAiCurrentStatus(msg); },
          onResult: handleVoiceCommand,
          onCommand: function (text) {
            // 确认态的识别结果与内部超时信号都走这里
            if (text === 'confirm-timeout') {
              clearPendingMove();
              board.render(game, lastMove);
              updateAiCurrentStatus('🎙️ 确认超时，请再说一次…');
              chessVoice.armTurn();
              return;
            }
            if (text === 'give-up') {
              setVoiceState('error', '语音已停止，请手动点选');
              updateAiCurrentStatus('🎙️ 连续多次没听清，语音已暂停。请点击棋盘手动落子，或再点“语音”重试。');
              voiceEnabled = false;
              if (voiceBtn) voiceBtn.classList.remove('recording', 'voice-on');
              if (chessVoice) chessVoice.pause();
              return;
            }
            handleVoiceCommand(text);
          },
          onError: function (msg) {
            updateAiCurrentStatus('🎙️ ' + msg);
            setVoiceState('error', msg);
            if (chessVoice) {
              chessVoice.noteFailure();
              chessVoice.armTurn();
            }
          },
          onStateChange: function (state) {
            // 视觉必须与麦克风真实状态一致：患者只能靠这个判断"现在能不能说话"。
            // 'confirm' 由 proposeFromText 自行渲染候选文案，此处不覆盖。
            if (state === 'rest') setVoiceState('rest', '稍后轮到你…');
            else if (state === 'calibrating') setVoiceState('calibrating', '正在校准麦克风…');
            else if (state === 'listening') setVoiceState('listening', '该你了，请说棋步…');
          },
          onTick: handleVoiceTick
        });
      }

      if (!chessVoice.isSupported()) {
        updateAiCurrentStatus('🎙️ 当前浏览器不支持语音识别（需 Chrome/Edge 等）');
        return;
      }

      voiceEnabled = true;
      if (voiceBtn) voiceBtn.classList.add('voice-on');
      setVoiceState('calibrating', '正在校准麦克风…');
      try {
        await chessVoice.startAuto();
        if (game.turn !== playerSide) {
          // 当前轮到 AI：先静默，等 AI 落子后再由 armVoiceTurn 排窗口
          chessVoice.pause();
          setVoiceState('rest', 'AI 正在思考…');
          updateAiCurrentStatus('🎙️ 语音已开启。等 AI 走完后会提示你，请先不要说话。');
        } else {
          setVoiceState('rest', '稍后轮到你…');
        }
      } catch (err) {
        voiceEnabled = false;
        if (voiceBtn) voiceBtn.classList.remove('voice-on');
        hideVoiceOverlay();
        updateAiCurrentStatus('🎙️ 无法访问麦克风: ' + (err && err.message ? err.message : err));
      }
    });
  }

  if (voiceAcceptBtn) voiceAcceptBtn.addEventListener('click', acceptPendingMove);
  if (voiceRejectBtn) voiceRejectBtn.addEventListener('click', rejectPendingMove);

  // 键盘快捷键 —— 震颤患者点不准小按钮时，键盘是可靠输入通道
  //   空格 / 回车 : 上下文复用
  //                · 有待确认候选时 = 确认落子
  //                · 无候选时       = 立即开启收音窗口（跳过剩余休息时间；
  //                                  窗口已开则重置为完整窗口）
  //   Esc         : 取消候选，重新说一次
  document.addEventListener('keydown', function (e) {
    if (!voiceEnabled) return;
    if (gameMode !== 'pve') return;

    if (e.key === 'Escape') {
      if (pendingMove) {
        e.preventDefault();
        rejectPendingMove();
      }
      return;
    }

    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();   // 避免空格滚动页面 / 回车二次触发聚焦按钮
      if (pendingMove) {
        acceptPendingMove();
      } else if (chessVoice) {
        // 立即收音：不必等休息态走完，玩家自己掌握节奏
        clearPendingMove();
        chessVoice.openNow(TURN.listenMs);
        updateAiCurrentStatus('🎙️ 正在收音，请说棋步…');
      }
    }
  });

  // 对局暂停/恢复时同步语音状态（由 togglePause 调用）
  function onVoicePauseChanged(paused) {
    if (!voiceEnabled || !chessVoice) return;
    if (paused) {
      clearPendingMove();
      board.render(game, lastMove);
      chessVoice.pause();
      setVoiceState('rest', '对局已暂停');
    } else {
      setVoiceState('rest', '稍后轮到你…');
      armVoiceTurn();
    }
  }
});
