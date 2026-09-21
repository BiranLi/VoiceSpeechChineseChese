/**
 * xiangqiboard.js - 中国象棋 DOM 棋盘渲染与菜单交互器
 *
 * @author Chris Oakman & lengyanyu258
 * @license MIT License
 * @see https://github.com/lengyanyu258/xiangqiboardjs
 *
 * Copyright (c) 2017-2023 Chris Oakman & lengyanyu258
 * Released under the MIT license
 */

(function (global) {
  'use strict';

  // 棋子汉字映射表
  const PIECE_NAMES = {
    'k': { 'r': '帅', 'b': '将' },
    'a': { 'r': '仕', 'b': '士' },
    'b': { 'r': '相', 'b': '象' },
    'n': { 'r': '马', 'b': '馬' },
    'r': { 'r': '车', 'b': '車' },
    'c': { 'r': '炮', 'b': '砲' },
    'p': { 'r': '兵', 'b': '卒' }
  };

  function XiangqiBoard(containerId, options) {
    this.container = document.getElementById(containerId);
    this.options = options || {};
    this.selectedSq = null;
    this.onMoveCallback = this.options.onMove || null;
    
    this.initDOM();
    this.bindMenuEvents();
  }

  // 初始化 DOM 结构
  XiangqiBoard.prototype.initDOM = function () {
    if (!this.container) return;
    this.container.innerHTML = '';

    // 底层：标准中国象棋棋盘线 (SVG) —— 竖线楚河区断开、上下横线、九宫斜线、炮位/兵位十字标记、粗外框
    const linesLayer = document.createElement('div');
    linesLayer.className = 'xiangqi-lines-layer';
    linesLayer.style.cssText = 'position:absolute; inset:0; pointer-events:none; z-index:1;';
    linesLayer.appendChild(this.buildBoardLinesSVG());

    const boardGrid = document.createElement('div');
    boardGrid.className = 'xiangqi-board-grid';
    boardGrid.style.cssText = 'position:relative; width:100%; height:100%; display:grid; grid-template-columns: repeat(9, 1fr); grid-template-rows: repeat(10, 1fr); z-index:2;';

    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 9; c++) {
        const sqIndex = r * 9 + c;
        const cell = document.createElement('div');
        cell.className = 'xiangqi-cell';
        cell.dataset.sq = sqIndex;
        cell.style.cssText = 'position:relative; display:flex; align-items:center; justify-content:center; cursor:pointer; user-select:none;';
        
        cell.addEventListener('click', this.onCellClick.bind(this, sqIndex));
        boardGrid.appendChild(cell);
      }
    }
    
    this.container.appendChild(linesLayer);
    this.container.appendChild(boardGrid);

    // 渲染经典中国象棋“楚 河 漢 界”河界水墨大字（置于第 4/5 排之间的河界带）
    const riverLayer = document.createElement('div');
    riverLayer.className = 'xiangqi-river-layer';
    riverLayer.style.cssText = `
      position: absolute;
      top: 45%;
      left: 0;
      width: 100%;
      height: 10%;
      display: flex;
      align-items: center;
      justify-content: space-around;
      pointer-events: none;
      z-index: 3;
      font-family: "Kaiti SC", "STKaiti", "KaiTi", serif;
      font-size: 24px;
      font-weight: 900;
      color: rgba(100, 60, 20, 0.45);
      letter-spacing: 12px;
      user-select: none;
    `;

    const riverLeft = document.createElement('div');
    riverLeft.innerText = '楚 河';
    const riverRight = document.createElement('div');
    riverRight.innerText = '漢 界';

    riverLayer.appendChild(riverLeft);
    riverLayer.appendChild(riverRight);
    this.container.appendChild(riverLayer);
  };

  // 生成标准中国象棋棋盘线 SVG 元素（9 列 x 10 行，线穿过格子中心，棋子位于交叉点上）
  XiangqiBoard.prototype.buildBoardLinesSVG = function () {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const W = 600, H = 600;
    const colW = W / 9;   // 66.67
    const rowH = H / 10;  // 60
    const LINE = '#8b5a2b';
    const w = 1.6;

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'xiangqi-lines');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.cssText = 'width:100%; height:100%; display:block;';

    const addLine = function (x1, y1, x2, y2, strokeWidth) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', x1);
      line.setAttribute('y1', y1);
      line.setAttribute('x2', x2);
      line.setAttribute('y2', y2);
      line.setAttribute('stroke', LINE);
      line.setAttribute('stroke-width', strokeWidth);
      svg.appendChild(line);
    };

    // 粗外框
    const frame = document.createElementNS(SVG_NS, 'rect');
    frame.setAttribute('x', 3);
    frame.setAttribute('y', 3);
    frame.setAttribute('width', W - 6);
    frame.setAttribute('height', H - 6);
    frame.setAttribute('fill', 'none');
    frame.setAttribute('stroke', LINE);
    frame.setAttribute('stroke-width', 4);
    frame.setAttribute('rx', 2);
    svg.appendChild(frame);

    // 9 条竖线：楚河区 (y 270~330) 断开，形成河界
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * colW;
      addLine(x, 3, x, rowH * 4.5, w);
      addLine(x, rowH * 5.5, x, H - 3, w);
    }

    // 横线：上半 5 条 (y 30..270)，下半 5 条 (y 330..570)，河界区无横线
    for (let j = 0; j < 5; j++) {
      const yTop = (j + 0.5) * rowH;
      const yBot = (j + 5.5) * rowH;
      addLine(3, yTop, W - 3, yTop, w);
      addLine(3, yBot, W - 3, yBot, w);
    }

    // 九宫斜线：上九宫 (row0-2, col3-5)，下九宫 (row7-9, col3-5)
    const px1 = 3.5 * colW, px2 = 5.5 * colW;
    const pyTop1 = 0.5 * rowH, pyTop2 = 2.5 * rowH;
    const pyBot1 = 7.5 * rowH, pyBot2 = 9.5 * rowH;
    addLine(px1, pyTop1, px2, pyTop2, w);
    addLine(px2, pyTop1, px1, pyTop2, w);
    addLine(px1, pyBot1, px2, pyBot2, w);
    addLine(px2, pyBot1, px1, pyBot2, w);

    // 炮位十字标记：黑 (col1,row2)/(col7,row2)，红 (col1,row7)/(col7,row7)
    // 兵位十字标记：黑 (col0,2,4,6,8, row3)，红 (col0,2,4,6,8, row6)
    const addCross = function (x, y) {
      addLine(x - 6, y, x + 6, y, w);
      addLine(x, y - 6, x, y + 6, w);
    };

    [1, 7].forEach(ci => {
      addCross((ci + 0.5) * colW, 2.5 * rowH); // 黑炮
      addCross((ci + 0.5) * colW, 7.5 * rowH); // 红炮
    });
    [0, 2, 4, 6, 8].forEach(ci => {
      addCross((ci + 0.5) * colW, 3.5 * rowH); // 黑兵
      addCross((ci + 0.5) * colW, 6.5 * rowH); // 红兵
    });

    return svg;
  };

  // 根据 Xiangqi 实例数据更新渲染棋盘
  XiangqiBoard.prototype.render = function (game, lastMove) {
    if (!game || !this.container) return;
    if (lastMove !== undefined) this.lastMove = lastMove;

    const selectedPiece = (this.selectedSq !== null) ? game.board[this.selectedSq] : null;
    const isCurrentTurn = selectedPiece && (selectedPiece.color === game.turn);

    const cells = this.container.querySelectorAll('.xiangqi-cell');
    cells.forEach((cell, idx) => {
      cell.innerHTML = '';
      cell.classList.remove('selected', 'highlight', 'last-move');

      if (this.selectedSq === idx) {
        cell.classList.add('selected');
        if (isCurrentTurn) {
          cell.style.backgroundColor = 'rgba(39, 174, 96, 0.35)';
          cell.style.boxShadow = 'inset 0 0 8px #27ae60';
        } else {
          cell.style.backgroundColor = 'rgba(231, 76, 60, 0.35)';
          cell.style.boxShadow = 'inset 0 0 8px #e74c3c';
        }
      } else if (this.lastMove && (this.lastMove.from === idx || this.lastMove.to === idx)) {
        cell.classList.add('last-move');
        cell.style.backgroundColor = 'rgba(230, 126, 34, 0.38)';
        cell.style.boxShadow = 'inset 0 0 10px #e67e22';
      } else {
        cell.style.backgroundColor = 'transparent';
        cell.style.boxShadow = 'none';
      }

      // 如果当前有选中的起子，高亮合法落子目标格 (己方绿色，敌方红色)
      if (this.selectedSq !== null && window.gameInstance && window.gameInstance.isLegalMove) {
        if (window.gameInstance.isLegalMove(this.selectedSq, idx)) {
          const hintDot = document.createElement('div');
          hintDot.className = 'move-hint-dot';
          const dotColor = isCurrentTurn ? 'rgba(39, 174, 96, 0.8)' : 'rgba(231, 76, 60, 0.85)';
          const dotGlow = isCurrentTurn ? 'rgba(39, 174, 96, 0.9)' : 'rgba(231, 76, 60, 0.9)';
          hintDot.style.cssText = `width: 14px; height: 14px; border-radius: 50%; background: ${dotColor}; box-shadow: 0 0 6px ${dotGlow}; position: absolute; z-index: 5;`;
          cell.appendChild(hintDot);
        }
      }

      const piece = game.board[idx];
      if (piece) {
        const pieceEl = document.createElement('div');
        pieceEl.className = 'xiangqi-piece ' + (piece.color === 'r' ? 'piece-red' : 'piece-black');
        const name = PIECE_NAMES[piece.type] ? PIECE_NAMES[piece.type][piece.color] : piece.type;
        pieceEl.innerText = name;
        pieceEl.style.cssText = `
          width: 44px;
          height: 44px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          box-shadow: 0 3px 6px rgba(0,0,0,0.3);
          background: ${piece.color === 'r' ? '#fff0f0' : '#2b2b2b'};
          color: ${piece.color === 'r' ? '#c0392b' : '#ffffff'};
          border: 2px solid ${piece.color === 'r' ? '#c0392b' : '#111111'};
        `;
        cell.appendChild(pieceEl);
      }
    });
  };

  // 点击落子交互处理
  XiangqiBoard.prototype.onCellClick = function (sqIndex) {
    if (this.selectedSq === null) {
      if (window.gameInstance && window.gameInstance.board[sqIndex]) {
        this.selectedSq = sqIndex;
        this.render(window.gameInstance);
      }
    } else {
      if (this.selectedSq === sqIndex) {
        this.selectedSq = null;
        this.render(window.gameInstance);
      } else {
        const from = this.selectedSq;
        const to = sqIndex;
        this.selectedSq = null;
        
        if (this.onMoveCallback) {
          this.onMoveCallback(from, to);
        }
      }
    }
  };

  // 绑定多级开局遮罩菜单事件 (完全对应 ui_example 交互)
  XiangqiBoard.prototype.bindMenuEvents = function () {
    const menuMain = document.getElementById('menu');
    const menuMode = document.getElementById('menu-mode');
    const menuModePve = document.getElementById('menu-mode-pve');
    const boardOptions = document.getElementById('board-options');

    const startBtn = document.getElementById('startbtn');
    const returnToMain = document.getElementById('return-to-main');
    const returnToMode = document.getElementById('return-to-mode');
    const pveBtn = document.getElementById('pvebtn');
    const pvpBtn = document.getElementById('pvpbtn');
    const eveBtn = document.getElementById('evebtn');
    const pfBtn = document.getElementById('pfbtn');
    const efBtn = document.getElementById('efbtn');

    if (startBtn) {
      startBtn.addEventListener('click', function () {
        menuMain.classList.add('hide');
        menuMode.classList.remove('hide');
      });
    }

    const helpBtn = document.getElementById('helpbtn');
    if (helpBtn) {
      helpBtn.addEventListener('click', function () {
        alert(
          "【中国象棋对弈规则与系统说明】\n\n" +
          "1. 对局模式：\n" +
          "   - 本机双人：两位玩家在同一设备轮流落子对决。\n" +
          "   - 人机对战：玩家与 WebAssembly 引擎对弈（可选执红/执黑）。\n" +
          "   - 机机对决：自动开启 AI 对 AI 算法自我连贯演练。\n\n" +
          "2. 行棋规则：\n" +
          "   - 马走日（受别马腿阻断限制）。\n" +
          "   - 相/象走田（不可过河，受塞象眼限制）。\n" +
          "   - 车走直线无障碍；炮移动无障碍，吃子需隔一棋子。\n" +
          "   - 兵/卒未过河只能直走一格，过河后可横走，不可倒退。\n" +
          "   - 仕/士与帅/将限定在九宫格范围内移动。\n\n" +
          "3. 交互提示：\n" +
          "   - 选中己方棋子显示【绿色】落子点，选中敌方显示【警示红色】（只看不可动）。\n" +
          "   - 落子后起点与终点显示【橙金发光框】着法轨迹。"
        );
      });
    }

    if (returnToMain) {
      returnToMain.addEventListener('click', function () {
        menuMode.classList.add('hide');
        menuMain.classList.remove('hide');
      });
    }

    if (pveBtn) {
      pveBtn.addEventListener('click', function () {
        menuMode.classList.add('hide');
        menuModePve.classList.remove('hide');
      });
    }

    if (returnToMode) {
      returnToMode.addEventListener('click', function () {
        menuModePve.classList.add('hide');
        menuMode.classList.remove('hide');
      });
    }

    // 开始对局：隐藏遮罩层
    function startGameMode(mode, side) {
      if (boardOptions) boardOptions.classList.add('hide');
      if (window.onGameStart) {
        window.onGameStart(mode, side);
      }
    }

    if (pvpBtn) pvpBtn.addEventListener('click', function() { startGameMode('pvp', 'r'); });
    if (eveBtn) eveBtn.addEventListener('click', function() { startGameMode('eve', 'r'); });
    if (pfBtn) pfBtn.addEventListener('click', function() { startGameMode('pve', 'r'); });
    if (efBtn) efBtn.addEventListener('click', function() { startGameMode('pve', 'b'); });
  };

  global.XiangqiBoard = XiangqiBoard;
})(typeof window !== 'undefined' ? window : this);
