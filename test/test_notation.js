/**
 * test_notation.js - 记谱解析器单元测试（js/notation.js）
 *
 * 覆盖：
 *   - 全部 7 种棋子：帅将/仕士/相象/马/车/炮/兵卒
 *   - 红黑双视角列号换算
 *   - 平/进/退 三种动作（步数 vs 落点列号）
 *   - 前/后 消歧（带列号 + 省略列号两种标准形式）
 *   - 非法着法与异常文本拦截
 *
 * 运行：node test/test_notation.js
 */

const assert = require('assert');
const path = require('path');

const Xiangqi = require(path.join(__dirname, '../js/xiangqi.js')).Xiangqi;
const { parseChessNotation } = require(path.join(__dirname, '../js/notation.js'));

let passed = 0;
let total = 0;

function ok(name) {
  passed++;
  console.log(`  PASS  ${name}`);
}

function parse(game, text) {
  const r = parseChessNotation(game, text);
  assert.ok(r, `「${text}」应返回结果`);
  return r;
}

function expectMove(name, game, text, from, to) {
  total++;
  const r = parse(game, text);
  if (r.error) {
    console.log(`  FAIL  ${name}「${text}」-> ${r.error}`);
    return;
  }
  assert.strictEqual(r.from, from, `${name}: from 应为 ${from}，实得 ${r.from}`);
  assert.strictEqual(r.to, to, `${name}: to 应为 ${to}，实得 ${r.to}`);
  ok(`${name}「${text}」-> (${from},${to})`);
}

function expectError(name, game, text, keyword) {
  total++;
  const r = parse(game, text);
  assert.ok(r.error, `${name}: 应返回 error`);
  if (keyword) {
    assert.ok(r.error.includes(keyword), `${name}: 错误信息应包含「${keyword}」，实得「${r.error}」`);
  }
  ok(`${name}「${text}」-> 拦截: ${r.error}`);
}

console.log('== 单元测试开始: js/notation.js ==');

// ---------- 红方视角（开局） ----------
let g = new Xiangqi();
console.log('-- 红方视角 --');
expectMove('红炮平', g, '炮二平五', 64, 67);
expectMove('红马进', g, '马八进七', 88, 69);
expectMove('红兵进', g, '兵七进一', 60, 51);
expectMove('红车进', g, '车一进二', 81, 63); // 车一(81) 进2 → row7 col0(63)
expectMove('红相进', g, '相三进五', 83, 67); // 相三(83) 进 → row7 col4(67)
expectMove('红炮进', g, '炮二进三', 64, 37); // 炮二(64) 进3 → row4 col1(37)
expectMove('汉字数字', g, '炮二平五', 64, 67);
expectMove('阿拉伯数字', g, '炮2平5', 64, 67);

// 帅/将
expectMove('帅五进一', g, '帅五进一', 85, 76);

// 仕四进五
expectMove('仕四进五', g, '仕四进五', 84, 76);

// ---------- 黑方视角（turn=b） ----------
console.log('-- 黑方视角 --');
g = new Xiangqi();
g.turn = 'b';
expectMove('黑炮平', g, '炮2平5', 25, 22); // 黑炮 col7(2路) → col4(5路)
expectMove('黑马进', g, '马8进7', 1, 20);  // 黑马 col7(8路) → col6(7路)
expectMove('黑将进', g, '将5进1', 4, 13);

// ---------- 前/后 消歧 ----------
console.log('-- 前/后 消歧 --');
g = new Xiangqi();
g.board[5 * 9 + 1] = { type: 'c', color: 'r' }; // 红炮再加一枚 row5 col1
expectMove('前炮进一(带列号)', g, '前炮二进一', 46, 37); // 前=row5(更近黑方)
expectMove('后炮进一(带列号)', g, '后炮二进一', 64, 55); // 后=row7
g = new Xiangqi();
g.board[5 * 9 + 1] = { type: 'c', color: 'r' };
expectMove('前炮进一(省略列号)', g, '前炮进一', 46, 37);
expectMove('后炮进一(省略列号)', g, '后炮进一', 64, 55);
expectError('同列双子不带前/后', g, '炮二进一', '前/后');

// ---------- 非法/异常 ----------
console.log('-- 非法与异常 --');
g = new Xiangqi();
expectError('车被挡非法', g, '车一平二', '非法');
expectError('无此棋子', g, '马三进四', '没有');
expectError('无此棋子(炮五)', g, '炮五进四', '没有');
expectError('乱文本', g, '飞象过河', '无法解析');
expectError('空文本', g, '', '空');
expectError('将死帅乱走', g, '帅五平四', '非法'); // 帅不能横到 col3？col3 有仕挡，非法

// 马/相/仕 不能平
expectError('马不能平', g, '马二平三', '不能平');
expectError('相不能平', g, '相三平五', '不能平');

console.log(`\n记谱解析单元测试: ${passed}/${total} 通过`);
process.exit(passed === total ? 0 : 1);
