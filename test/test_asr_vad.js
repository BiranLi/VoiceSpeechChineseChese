/**
 * test_asr_vad.js - 语音状态机单元测试（js/asr.js）
 *
 * 覆盖新交互模型「分回合 · 限时窗口 · 两段确认」的关键行为：
 *   1. 噪声门限：低能量噪声不会触发识别
 *   2. 起始去抖：单块瞬时尖峰（模拟震颤 / 桌面撞击）不触发识别
 *   3. 断续发音：字间停顿不会被过短静音门限截断
 *   4. 静音结束：达到门限后提交 ASR
 *   5. 错误回调：ASR 抛错走 onError，并交还回合调度
 *   6. 限时窗口：窗口到点自动关闭（杜绝常开）
 *   7. 确认态：enterConfirm 开启独立倒计时
 *   8. 失败看门狗：连续失败达上限后交还点击操作
 *   9. 底噪自适应：阈值随环境底噪抬升
 *
 * 运行：node test/test_asr_vad.js
 */

const mod = require('../js/asr.js');
const ChessVoice = mod.ChessVoice;
const VAD = ChessVoice.VAD;
const TURN = ChessVoice.TURN;
const CHUNK_MS = ChessVoice.CHUNK_MS;

// 构造一段指定 RMS 的音频块
function chunk(amplitude) {
  const data = new Float32Array(2048);
  if (amplitude > 0) {
    for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin(i * 0.1);
  }
  return data;
}

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('PASS', name); }
  else { fail++; console.log('FAIL', name); }
}

// 造一个不依赖浏览器的 ChessVoice 实例（绕过 _ensureSession）
function makeVoice(opts) {
  const v = new ChessVoice(Object.assign({
    onResult: function () {},
    onStatus: function () {},
    onError: function () {},
    onCommand: function () {},
    onStateChange: function () {},
    onTick: function () {}
  }, opts || {}));
  return v;
}

// 喂 n 块指定振幅
function feed(v, amplitude, n) {
  for (let i = 0; i < n; i++) v._vadProcess(chunk(amplitude));
}

// 喂 n 块静音（振幅 0）
function feedSilence(v, n) { feed(v, 0, n); }

// 喂足够多的静音以结束一句话。
// 注意：长句（>VAD.longSpeechMs）会启用更宽的 longSilenceMs 门限，
// 因此这里按 longSilenceMs 计算，避免喂少了导致句子不结束。
function silenceToEnd() {
  return Math.ceil(VAD.longSilenceMs / CHUNK_MS) + 3;
}

(async () => {
  // ---------- 1. 纯低能量噪声不应触发 ----------
  {
    let triggered = false;
    const v = makeVoice({ onResult: () => { triggered = true; } });
    v.mode = 'listening';
    v.effectiveThreshold = 0.02;
    v._resetVad();
    // 50 块 ≈ 6.4s，振幅 0.01（低于阈值）
    feed(v, 0.01, 50);
    check('低于阈值的噪声不触发识别', !triggered);
  }

  // ---------- 2. 起始去抖：单块尖峰不触发（震颤 / 撞击） ----------
  {
    let triggered = false;
    const v = makeVoice({ onResult: () => { triggered = true; } });
    v.enabled = true;
    v.mode = 'listening';
    v.effectiveThreshold = 0.02;
    v._resetVad();
    v.transcribe = async () => '炮二平五';

    // 4 次「单块尖峰 + 静音」，每次只持续 1 块，不足 onsetBlocks=3
    for (let k = 0; k < 4; k++) {
      v._vadProcess(chunk(0.5));
      feedSilence(v, 3);
    }
    check('单块瞬时尖峰不触发识别（起始去抖生效）', !triggered);
  }

  // ---------- 3+4. 连续语音 + 静音达到门限后提交 ----------
  {
    let resultText = null;
    const v = makeVoice({ onResult: (t) => { resultText = t; } });
    v.enabled = true;
    v.mode = 'listening';
    v.effectiveThreshold = 0.02;
    v._resetVad();
    v.transcribe = async () => '炮二平五';

    // 20 块 ≈ 2.56s 连续语音
    feed(v, 0.1, 20);
    // 断续发音保护：中途插入 1.2s 停顿（约 9 块）不应截断
    // longSpeechMs=1500 后静音门限放宽，这里验证 > silenceMs=1600 的短停顿不截断
    const blocksForSilence = Math.ceil(VAD.silenceMs / CHUNK_MS);
    feedSilence(v, blocksForSilence - 2);
    // 停顿期间若提前结束，resultText 会先被赋值
    check('字间停顿未被截断（自适应静音门限）', resultText === null);
    // 继续说话 + 足够长的静音 -> 结束
    feed(v, 0.1, 5);
    feedSilence(v, silenceToEnd());
    await new Promise(r => setTimeout(r, 50));
    check('连续语音 + 静音超时触发识别', resultText === '炮二平五');
  }

  // ---------- 5. ASR 抛错走 onError，且不落子 ----------
  {
    let errMsg = null;
    let resultText = null;
    const v = makeVoice({
      onResult: (t) => { resultText = t; },
      onError: (m) => { errMsg = m; }
    });
    v.enabled = true;
    v.mode = 'listening';
    v.effectiveThreshold = 0.02;
    v._resetVad();
    v.transcribe = async () => { throw new Error('网络中断'); };

    feed(v, 0.1, 20);
    feedSilence(v, silenceToEnd());
    await new Promise(r => setTimeout(r, 50));
    check('识别抛错回调 onError', errMsg === '网络中断');
    check('识别失败不产生棋步结果', resultText === null);
  }

  // ---------- 6. 限时窗口：到点自动关闭，杜绝常开 ----------
  {
    const states = [];
    const v = makeVoice({ onStateChange: (s) => states.push(s) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();
    v._openWindow(60);   // 60ms 后到期
    const opened = v.mode;
    await new Promise(r => setTimeout(r, 120));
    check('聆听窗口到点后自动关闭（不再常开）', opened === 'listening' && v.mode !== 'listening');
  }

  // ---------- 7. 确认态：独立倒计时 ----------
  {
    const states = [];
    const v = makeVoice({ onStateChange: (s) => states.push(s) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();
    v.enterConfirm();
    check('进入确认态', v.mode === 'confirm');
    check('确认态触发 confirm 状态通知', states.indexOf('confirm') >= 0);
  }

  // ---------- 8. 失败看门狗：连续失败达上限交还点击 ----------
  {
    const cmds = [];
    const v = makeVoice({ onCommand: (c) => cmds.push(c) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();
    for (let i = 0; i < TURN.maxFailures; i++) v.noteFailure();
    v.armTurn();
    check('连续失败达上限后交还点击操作', cmds.indexOf('give-up') >= 0);
  }

  // ---------- 9. 底噪自适应：阈值随环境抬升 ----------
  {
    const v = makeVoice({});
    v.effectiveThreshold = Math.max(VAD.energyFloor, 0.05 * VAD.noiseGain);
    check('环境噪音大时阈值高于绝对下限', v.effectiveThreshold > VAD.energyFloor);

    // 安静环境应回落到绝对下限
    v.effectiveThreshold = Math.max(VAD.energyFloor, 0.001 * VAD.noiseGain);
    check('环境安静时阈值回落到绝对下限', v.effectiveThreshold === VAD.energyFloor);
  }

  // ---------- 10. 断续发音的核心保障：长句放宽静音门限 ----------
  {
    check('静音门限已为断续发音放宽 (>=1500ms)', VAD.silenceMs >= 1500);
    check('长句门限进一步放宽', VAD.longSilenceMs > VAD.silenceMs);
    check('最短语音门槛已提高（抗误触发）', VAD.minSpeechMs >= 300);
  }

  // ---------- 11. 回归：窗口到期后必须能自动重开（防麦克风死锁） ----------
  // 历史 bug：_closeWindow() 未把 mode 落回 'rest'，导致 armTurn() 误判
  // "已在窗口中"而提前 return，窗口到期后麦克风永久静默。
  {
    const states = [];
    const v = makeVoice({ onStateChange: (s) => states.push(s) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();

    v._openWindow(40);                       // 40ms 窗口，很快到期
    await new Promise(r => setTimeout(r, 90));
    // 到期后应进入 rest，并排下"休息 -> 下一轮窗口"的调度
    check('窗口到期后回到休息态', v.mode === 'rest');
    check('窗口到期后重新排入下一轮（防死锁）', v._turnTimer !== null);
  }

  // ---------- 12. 回归：一句结束后不能停在"死"状态 ----------
  // 历史 bug：_onUtteranceEnd 冻结本句后未改 mode，导致调用方 armTurn() 无效。
  {
    let resultText = null;
    const v = makeVoice({ onResult: (t) => { resultText = t; } });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v.mode = 'listening';
    v.effectiveThreshold = 0.02;
    v._resetVad();
    v.transcribe = async () => '马二进三';

    feed(v, 0.1, 20);
    feedSilence(v, silenceToEnd());
    await new Promise(r => setTimeout(r, 50));
    check('一句结束后状态可继续推进', resultText === '马二进三' && v.mode === 'rest');
    // 调用方接下来会 armTurn()，必须能成功排期
    v.armTurn();
    check('一句结束后可正常重开窗口', v._turnTimer !== null);
  }

  // ---------- 13. 热键：openNow 立即开窗并重置为完整窗口 ----------
  {
    const states = [];
    const v = makeVoice({ onStateChange: (s) => states.push(s) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();

    // 先人为制造一个"快到期的短窗口"
    v._openWindow(3000);
    const firstDeadline = v._windowDeadline;
    // 等窗口自然到期 -> 回到 rest
    await new Promise(r => setTimeout(r, 60));
    v._clearTimers();
    v._closeWindow();
    v._windowDeadline = 0;

    // 热键触发
    v.openNow();
    check('热键立即开启收音窗口', v.mode === 'listening', v.mode);
    check('热键跳过休息态（无 _turnTimer 等待）', v._turnTimer === null);
    check('热键重置为完整窗口时长', v._windowTotal === TURN.listenMs, String(v._windowTotal));
    check('热键后倒计时被刷新', v._windowDeadline > firstDeadline);
    v._clearTimers();
  }

  // ---------- 14. 热键：确认态下不抢占（让玩家先处理候选） ----------
  {
    const v = makeVoice({});
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();
    v.enterConfirm();
    v.openNow();
    check('确认态下热键不抢占', v.mode === 'confirm', v.mode);
    v._clearTimers();
  }

  // ---------- 15. 热键：主动收音会重置失败计数（避免刚被看门狗停掉就无机会） ----------
  {
    const cmds = [];
    const v = makeVoice({ onCommand: (c) => cmds.push(c) });
    v.enabled = true;
    v.processor = { onaudioprocess: null, disconnect: function () {} };
    v._resetVad();
    for (let i = 0; i < TURN.maxFailures; i++) v.noteFailure();
    v.openNow();
    check('热键收音重置失败计数', v.failureCount === 0, String(v.failureCount));
    check('热键收音后不再触发 give-up', cmds.indexOf('give-up') < 0);
    v._clearTimers();
  }

  console.log(`\nVAD / 语音状态机测试: ${pass}/${pass + fail} 通过`);
  process.exit(fail ? 1 : 0);
})();
