const mod = require('../js/asr.js');
const ChessVoice = mod.ChessVoice;

function chunk(amplitude) {
  const data = new Float32Array(2048);
  if (amplitude > 0) for (let i = 0; i < data.length; i++) data[i] = amplitude * Math.sin(i * 0.1);
  return data;
}

let pass = 0, fail = 0;
function check(name, cond) { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name); } }

(async () => {
  // 测试1: 纯静音不触发
  let triggered = false;
  let v = new ChessVoice({ onResult: () => {}, onStatus: () => {}, onError: () => {}, onStateChange: s => { if (s === 'paused') triggered = true; } });
  v.mode = 'auto'; v._resetVad();
  for (let i = 0; i < 50; i++) v._vadProcess(chunk(0));
  check('纯静音不触发识别', !triggered);

  // 测试2: 连续说话(20块≈2.5s) + 静音超时 → 识别
  let resultText = null;
  v = new ChessVoice({ onResult: t => resultText = t, onStatus: () => {}, onError: () => {}, onStateChange: () => {} });
  v.mode = 'auto'; v._resetVad();
  v.transcribe = async () => '炮二平五';
  for (let i = 0; i < 20; i++) v._vadProcess(chunk(0.1));
  for (let i = 0; i < 8; i++) v._vadProcess(chunk(0));
  await new Promise(r => setTimeout(r, 50));
  check('连续语音+静音超时触发识别', resultText === '炮二平五');

  // 测试3: 过短语音(1块=128ms<150ms) → 提示太短并重新监听
  let shortMsg = null; let state = null;
  v = new ChessVoice({ onResult: () => {}, onStatus: m => shortMsg = m, onError: () => {}, onStateChange: s => state = s });
  v.mode = 'auto'; v._resetVad();
  v.audioContext = {}; // mock 浏览器 AudioContext，供 resume 判断
  v._vadProcess(chunk(0.1));
  for (let i = 0; i < 8; i++) v._vadProcess(chunk(0));
  await new Promise(r => setTimeout(r, 50));
  check('过短语音提示再试', shortMsg && shortMsg.indexOf('太短') >= 0);
  check('过短语音后恢复监听', state === 'listening');

  // 测试4: 识别接口抛错 → onError 被调（配合 app 侧 onError 恢复收音，修复 V1）
  let errMsg = null;
  v = new ChessVoice({ onResult: () => {}, onStatus: () => {}, onError: m => errMsg = m, onStateChange: () => {} });
  v.mode = 'auto'; v._resetVad();
  v.transcribe = async () => { throw new Error('网络中断'); };
  for (let i = 0; i < 20; i++) v._vadProcess(chunk(0.1));
  for (let i = 0; i < 8; i++) v._vadProcess(chunk(0));
  await new Promise(r => setTimeout(r, 50));
  check('识别抛错回调 onError', errMsg === '网络中断');

  console.log(`\nVAD 测试: ${pass}/${pass+fail} 通过`);
  process.exit(fail ? 1 : 0);
})();
