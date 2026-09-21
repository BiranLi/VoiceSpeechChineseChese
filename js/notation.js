/**
 * notation.js - 中国象棋记谱解析器
 *
 * 把口述/文本形式的棋谱（如"炮二平五"、"马八进七"、"前车进一"、"兵五进一"）
 * 结合当前棋盘状态（game.board）解析为落子坐标 {from, to}。
 *
 * 记谱规则（红黑各自视角）：
 *   - 红方从自己视角，列号 1-9 从右往左数；黑方从自己视角，列号 1-9 从左往右数。
 *     本棋盘：col 0 在左侧（观众视角=红方视角），红方 digit → col = digit - 1；
 *             黑方视角与红方相反，黑方 digit → col = 9 - digit。
 *   - 动作：平 = 横向平移；进 = 向对方推进；退 = 向己方撤回。
 *   - 车/炮/兵：进/退 后跟"步数"；马/相/仕：进/退 后跟"落点列号"。
 *   - 同列有两枚同型子时，用"前/后"区分。
 */

(function (global) {
  'use strict';

  // 棋子汉字 → 类型码（红黑用字不同，统一映射）
  const PIECE_NAME_MAP = {
    '帅': 'k', '将': 'k',
    '仕': 'a', '士': 'a',
    '相': 'b', '象': 'b',
    '马': 'n', '馬': 'n',
    '车': 'r', '車': 'r',
    '炮': 'c', '砲': 'c',
    '兵': 'p', '卒': 'p'
  };

  const FILE_DIGITS = '一二三四五六七八九123456789';

  // 全角/汉字数字 → 阿拉伯数字 (1-9)
  function digitToNumber(ch) {
    const idx = '一二三四五六七八九'.indexOf(ch);
    if (idx >= 0) return idx + 1;
    const n = parseInt(ch, 10);
    if (n >= 1 && n <= 9) return n;
    return null;
  }

  // 行/列 → 一维索引 (0-89)
  function sqOf(row, col) {
    return row * 9 + col;
  }

  // 根据当前行动方，把记谱列号换算成棋盘 col
  function fileToCol(digit, turn) {
    return (turn === 'r') ? (digit - 1) : (9 - digit);
  }

  /**
   * 解析记谱文本为着法
   * @param {object} game  Xiangqi 实例（需有 board 与 isLegalMove）
   * @param {string} text  记谱文本，如 "炮二平五"
   * @returns {{from:number,to:number,notation:string}|{error:string}}
   */
  function parseChessNotation(game, text) {
    if (!game || !text) return { error: '空记谱' };

    // 1. 清理：去空白/标点，统一棋子用字
    let s = String(text).replace(/[\s，。、！？!?,.·：:]/g, '');
    if (!s) return { error: '空记谱' };

    // 2. 正则拆解： [前|后] 棋子 列号 动作 目标
    //    允许末位也用汉字/数字
    const m = s.match(/^(前|后)?([帅将士相象马车炮兵卒馬車砲])([一二三四五六七八九1-9])(平|进|退)([一二三四五六七八九1-9])$/);
    if (!m) {
      return { error: `无法解析记谱「${text}」（应为：棋子+列号+进/平/退+数字）` };
    }

    const front = m[1];                 // '前' | '后' | undefined
    const pieceName = m[2];
    const startDigit = digitToNumber(m[3]);
    const action = m[4];
    const targetDigit = digitToNumber(m[5]);
    const type = PIECE_NAME_MAP[pieceName];
    const turn = game.turn;             // 'r' | 'b'

    if (startDigit === null || targetDigit === null) {
      return { error: `记谱数字非法「${text}」` };
    }

    // 3. 定位起点列
    const fromCol = fileToCol(startDigit, turn);

    // 4. 找出该列上属于当前行动方的同型棋子
    const candidates = [];
    for (let row = 0; row < 10; row++) {
      const p = game.board[sqOf(row, fromCol)];
      if (p && p.color === turn && p.type === type) {
        candidates.push({ row: row, sq: sqOf(row, fromCol) });
      }
    }
    if (candidates.length === 0) {
      return { error: `${startDigit} 路没有可用的「${pieceName}」` };
    }

    // 5. 前/后 消歧：前 = 更靠近对方（红方行小、黑方行大）
    let fromSq;
    if (candidates.length === 1) {
      fromSq = candidates[0].sq;
    } else if (front === '前') {
      const pick = (turn === 'r')
        ? candidates.reduce((a, b) => (a.row < b.row ? a : b))
        : candidates.reduce((a, b) => (a.row > b.row ? a : b));
      fromSq = pick.sq;
    } else if (front === '后') {
      const pick = (turn === 'r')
        ? candidates.reduce((a, b) => (a.row > b.row ? a : b))
        : candidates.reduce((a, b) => (a.row < b.row ? a : b));
      fromSq = pick.sq;
    } else {
      return { error: `${startDigit} 路有多个「${pieceName}」，请说「前/后」区分（如前车进一）` };
    }

    const fromRow = Math.floor(fromSq / 9);

    // 6. 计算目标格
    let toSq = null;

    if (action === '平') {
      // 只有 车/炮/兵(过河) 能平
      if (type !== 'r' && type !== 'c' && type !== 'p') {
        return { error: `「${pieceName}」不能平走` };
      }
      const toCol = fileToCol(targetDigit, turn);
      toSq = sqOf(fromRow, toCol);
    } else {
      // 进/退
      const forward = (turn === 'r') ? -1 : 1; // 红方前进 = 行减，黑方前进 = 行加
      const dir = (action === '进') ? forward : -forward;

      if (type === 'r' || type === 'c' || type === 'p') {
        // 车/炮/兵：目标数字 = 步数
        const toRow = fromRow + dir * targetDigit;
        toSq = sqOf(toRow, fromCol);
      } else if (type === 'n' || type === 'b' || type === 'a') {
        // 马/相/仕：目标数字 = 落点列号；行差由列差与子力步型推算
        const toCol = fileToCol(targetDigit, turn);
        const colDelta = Math.abs(toCol - fromCol);
        let rowDelta = 0;
        if (type === 'n') {           // 马走日：(1,2) 或 (2,1)
          rowDelta = (colDelta === 1) ? 2 : 1;
        } else if (type === 'b') {    // 相/象走田
          rowDelta = 2;
        } else {                      // 仕/士走斜一格
          rowDelta = 1;
        }
        const toRow = fromRow + dir * rowDelta;
        toSq = sqOf(toRow, toCol);
      } else {
        return { error: `不支持的棋子「${pieceName}」` };
      }
    }

    // 7. 边界与合法性校验
    if (toSq === null || toSq < 0 || toSq >= 90) {
      return { error: `着法超出棋盘「${text}」` };
    }
    if (typeof game.isLegalMove !== 'function' || !game.isLegalMove(fromSq, toSq)) {
      return { error: `非法着法「${text}」` };
    }

    return { from: fromSq, to: toSq, notation: s };
  }

  global.parseChessNotation = parseChessNotation;
})(typeof window !== 'undefined' ? window : this);

// ---- Node.js 单元测试（node js/notation.js 直接运行） ----
if (typeof module !== 'undefined' && module.exports) {
  // 上方 IIFE 在 CommonJS 下已把 parseChessNotation 挂到 module.exports
  if (!module.exports.parseChessNotation) {
    module.exports.parseChessNotation = global.parseChessNotation;
  }

  // 仅在直接执行时跑冒烟测试
  const isMain = require.main === module;
  if (isMain) {
    // 复用项目的 xiangqi.js 规则引擎做合法性校验（CommonJS 下挂载于 module.exports）
    const Xiangqi = require('./xiangqi.js').Xiangqi;
    const game = new Xiangqi();

    const cases = [
      // 开局红方：炮二平五（col1 炮 → col4，红方视角 digit2→col1, digit5→col4）
      { text: '炮二平五', expect: { from: 7 * 9 + 1, to: 7 * 9 + 4 } },
      // 马八进七（col7 马 → col6，进2行：row9→row7）红方 digit8→col7, digit7→col6
      { text: '马八进七', expect: { from: 9 * 9 + 7, to: 7 * 9 + 6 } },
      // 兵七进一
      { text: '兵七进一', expect: { from: 6 * 9 + 6, to: 5 * 9 + 6 } },
      // 非法：开局车一平二（中间有炮挡住）
      { text: '车一平二', expect: 'error' },
      // 非法文本
      { text: '飞象过河', expect: 'error' },
    ];

    let pass = 0;
    const parse = module.exports.parseChessNotation;
    cases.forEach(function (c) {
      const r = parse(game, c.text);
      if (c.expect === 'error') {
        if (r.error) { console.log(`PASS  非法/${c.text}`); pass++; }
        else { console.log(`FAIL  应非法: ${c.text} -> ${JSON.stringify(r)}`); }
      } else if (r.error) {
        console.log(`FAIL  ${c.text} -> ${r.error}`);
      } else if (r.from === c.expect.from && r.to === c.expect.to) {
        console.log(`PASS  ${c.text} -> (${r.from},${r.to})`); pass++;
      } else {
        console.log(`FAIL  ${c.text} -> got (${r.from},${r.to}) expect (${c.expect.from},${c.expect.to})`);
      }
    });

    console.log(`\n记谱解析冒烟测试: ${pass}/${cases.length} 通过`);
    process.exit(pass === cases.length ? 0 : 1);
  }
}
