/**
 * asr.js - 语音识别模块（阿里云百炼 Qwen ASR，经本地 server.py /api/asr 代理）
 *
 * 交互模型：分回合 · 限时窗口 · 两段确认
 * ------------------------------------------------------------------
 * 为震颤 / 构音障碍 / 认知疲劳人群设计，核心取舍：
 *
 * 1. 【限时窗口取代"常开免按键"】
 *    免的是按键，不是持续收音。麦克风仅在"轮到玩家且处于聆听窗口"时开启，
 *    窗口有硬上限，超时自动关闭并回到休息态，避免玩家思考期全程收音导致的
 *    误触发（震颤、挪动身体、清嗓子）与隐私边界缺失。
 *
 * 2. 【两段确认】
 *    识别结果不直接落子，先进入 confirm 态等待确认。误识别从"不可逆"变成
 *    "按一下空格 / 说一个词"。确认键提供键盘与大按钮兜底 —— 对震颤患者，
 *    按空格远比对精准点击小按钮可靠。
 *
 * 3. 【噪声基线自适应 + 起始去抖】
 *    开启时先采样一段环境底噪，阈值取 max(绝对下限, 底噪 × 增益)；
 *    且要求连续 N 块超阈值才判定"起始人声"，滤除震颤与桌面撞击的瞬时尖峰。
 *
 * 4. 【静音门限自适应】
 *    构音障碍者的字与字之间常有停顿。基线静音门限放宽到 1600ms；
 *    单句超过 1500ms 后进一步放宽到 2600ms，避免把"炮……二……平……五"
 *    拦腰截断成半句话。
 *
 * 状态机：off → rest → listening → transcribing → (confirm ⇄ listening) → ...
 *
 * 说明：API Key 只存在于服务器端（环境变量 DASHSCOPE_API_KEY 或 --asr-api-key），
 *       前端永不接触 Key，避免泄露。
 */

(function (global) {
  'use strict';

  const SAMPLE_RATE = 16000;
  const CHUNK_SAMPLES = 2048;                       // 每块采样数（16kHz ≈ 128ms）
  const CHUNK_MS = (CHUNK_SAMPLES / SAMPLE_RATE) * 1000;

  // ---------------- VAD 参数（可按环境微调） ----------------
  const VAD = {
    energyFloor: 0.02,      // 绝对阈值下限：环境噪音大→调高，说话太轻→调低
    noiseGain: 3.5,         // 自适应系数：实际阈值 = max(energyFloor, 底噪 × noiseGain)
    noiseCalibMs: 1000,     // 开启时采集多久环境底噪
    onsetBlocks: 3,         // 连续多少块超阈值才判定"起始人声"（抗震颤/撞击）
    silenceMs: 1600,        // 说话后静音多久判定一句话结束（基线，已为断续发音放宽）
    longSpeechMs: 1500,     // 单句超过此时长后，静音门限放宽到 longSilenceMs
    longSilenceMs: 2600,    // 长句放宽后的静音门限
    minSpeechMs: 300,       // 低于此视为噪声（较原值放宽，提高误触发门槛）
    maxSpeechMs: 12000      // 单次最长语音时长，防卡死
  };

  // ---------------- 回合窗口参数 ----------------
  const TURN = {
    restMs: 3000,           // 休息态时长：麦克风关闭，给玩家一个明确的"未收音"边界
    listenMs: 10000,        // 聆听窗口硬上限：到点自动关闭，杜绝常开
    confirmMs: 8000,        // 确认态超时：到点自动放弃候选并重新开窗
    tickMs: 200,            // 倒计时回调粒度
    maxFailures: 3          // 连续识别失败上限，达到后停止循环并交还点击操作
  };

  function ChessVoice(options) {
    options = options || {};
    this.onStatus = options.onStatus || function () {};
    this.onResult = options.onResult || function () {};
    this.onCommand = options.onCommand || function () {};
    this.onError = options.onError || function () {};
    this.onStateChange = options.onStateChange || function () {};
    this.onTick = options.onTick || function () {};

    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processor = null;
    this.gainNode = null;

    // 状态机：'off' | 'rest' | 'listening' | 'transcribing' | 'confirm' | 'calibrating'
    this.mode = 'off';
    this.enabled = false;

    this.samples = [];
    this.speechActive = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.onsetRun = 0;        // 连续超阈值块数（起始去抖）
    this.offRun = 0;          // 连续低于阈值块数（结束去抖）

    this.noiseFloor = 0;      // 实测环境底噪 RMS
    this.effectiveThreshold = VAD.energyFloor;

    this._windowTimer = null; // 窗口倒计时
    this._tickTimer = null;   // 倒计时回调
    this._turnTimer = null;   // 休息 → 聆听 的调度
    this._windowDeadline = 0;
    this._windowTotal = 0;

    this.failureCount = 0;    // 连续失败计数（看门狗）
  }

  // 浏览器是否支持录音
  ChessVoice.prototype.isSupported = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      !!(global.AudioContext || global.webkitAudioContext);
  };

  // 确保麦克风会话存在（只获取一次，各状态复用）
  ChessVoice.prototype._ensureSession = async function () {
    if (this.audioContext) return;

    const AC = global.AudioContext || global.webkitAudioContext;
    this.audioContext = new AC({ sampleRate: SAMPLE_RATE });
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(CHUNK_SAMPLES, 1, 1);
    // 用零增益节点接目的地：保证 processor 持续被调用，又不把麦克风回放到扬声器
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0;
    this.sourceNode.connect(this.processor);
    this.processor.connect(this.gainNode);
    this.gainNode.connect(this.audioContext.destination);
  };

  // ---------------- 底噪校准 ----------------

  // 采样一段环境底噪，取中位数（对偶发大音量稳健）作为自适应阈值基准
  ChessVoice.prototype.calibrate = async function () {
    await this._ensureSession();
    this.mode = 'calibrating';
    this.onStateChange('calibrating');

    const self = this;
    const levels = [];
    return new Promise(function (resolve) {
      const startedAt = Date.now();
      self.processor.onaudioprocess = function (e) {
        const rms = self._rms(e.inputBuffer.getChannelData(0));
        levels.push(rms);
        const elapsed = Date.now() - startedAt;
        if (elapsed >= VAD.noiseCalibMs) {
          self.processor.onaudioprocess = null;
          // 中位数：即使校准期间有几次突发声响也不至于把门限抬得过高
          levels.sort(function (a, b) { return a - b; });
          self.noiseFloor = levels.length ? levels[Math.floor(levels.length / 2)] : 0;
          self.effectiveThreshold = Math.max(VAD.energyFloor, self.noiseFloor * VAD.noiseGain);
          self.onStatus(`🎙️ 麦克风已就绪（环境底噪 ${self.noiseFloor.toFixed(4)}，阈值 ${self.effectiveThreshold.toFixed(4)}）`);
          resolve();
        }
      };
    });
  };

  ChessVoice.prototype._rms = function (data) {
    if (!data || data.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    return Math.sqrt(sum / data.length);
  };

  // ---------------- 窗口调度 ----------------

  ChessVoice.prototype._clearTimers = function () {
    if (this._turnTimer) { clearTimeout(this._turnTimer); this._turnTimer = null; }
    if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }
  };

  // 开启窗口：麦克风开始收音，并在 durationMs 后自动关闭
  ChessVoice.prototype._openWindow = function (durationMs) {
    const self = this;
    this._clearTimers();
    this._resetVad();
    this.mode = 'listening';
    this._attachVadHandler();
    this.onStateChange('listening');
    this.onStatus('🎙️ 该你了，请说棋步…（空格可重开收音窗口）');

    this._windowTotal = durationMs;
    this._windowDeadline = Date.now() + durationMs;
    this._windowTimer = setTimeout(function () { self._onWindowExpired(); }, durationMs);
    this._tickTimer = setInterval(function () {
      const left = Math.max(0, self._windowDeadline - Date.now());
      self.onTick(left, self._windowTotal);
    }, TURN.tickMs);
    this.onTick(durationMs, durationMs);
  };

  // 关闭窗口：麦克风保持连接但不收音，等价于"不打扰"的静息。
  // 注意必须把 mode 落回 'rest'，否则后续 armTurn() 会误判"已在窗口中"而提前返回，
  // 造成窗口到期后麦克风永久死锁。
  ChessVoice.prototype._closeWindow = function () {
    if (this.processor) this.processor.onaudioprocess = null;
    this._resetVad();
    this.mode = 'rest';
  };

  // 窗口到点：聆听态 -> 提示后重开；确认态 -> 放弃候选并重开
  ChessVoice.prototype._onWindowExpired = function () {
    if (this.mode === 'listening') {
      this._closeWindow();
      this.onStatus('🎙️ 本轮没听到，请准备好后再说…');
      this.armTurn();
    } else if (this.mode === 'confirm') {
      this._closeWindow();
      this.onCommand('confirm-timeout');
    }
  };

  // ---------------- 回合调度 ----------------

  // 热键触发：立即开启一个完整长度的收音窗口（跳过剩余休息时间）。
  // 若窗口已开着，则重置为完整窗口并把界面切回聆听态。
  // 用户主动表明"我准备好了"，因此重置失败计数，避免刚被看门狗停掉就再无机会。
  ChessVoice.prototype.openNow = function (durationMs) {
    if (!this.enabled) return;
    if (this.mode === 'confirm') return;   // 确认态下不抢占：让玩家先处理候选
    this.failureCount = 0;
    this._openWindow(durationMs || TURN.listenMs);
  };

  // 开启语音模式：获取会话 + 校准底噪，进入休息态等待回合
  ChessVoice.prototype.startAuto = async function () {
    if (this.enabled) return;
    this.enabled = true;
    try {
      await this.calibrate();
    } catch (err) {
      this.enabled = false;
      this.mode = 'off';
      throw err;
    }
    this.failureCount = 0;
    this.armTurn();
  };

  // 回合调度：休息 restMs -> 开启 listenMs 窗口。失败过多则交还点击操作。
  ChessVoice.prototype.armTurn = function () {
    const self = this;
    if (!this.enabled) return;
    if (this.mode === 'listening' || this.mode === 'confirm') return; // 已在窗口中
    if (this.failureCount >= TURN.maxFailures) {
      this._closeWindow();
      this.mode = 'off';
      this.onStateChange('off');
      this.onCommand('give-up');
      return;
    }

    this._clearTimers();
    this._closeWindow();
    this.mode = 'rest';
    this.onStateChange('rest');
    this.onStatus('🎙️ 稍后轮到你…');
    this._turnTimer = setTimeout(function () {
      self._turnTimer = null;
      if (self.enabled && self.mode === 'rest') {
        self._openWindow(TURN.listenMs);
      }
    }, TURN.restMs);
  };

  // ---------------- 确认态 ----------------

  // 进入确认态：麦克风保持开启（可语音确认/取消），但有独立倒计时
  ChessVoice.prototype.enterConfirm = function () {
    const self = this;
    if (!this.enabled) return;
    this._clearTimers();
    this._resetVad();
    this.mode = 'confirm';
    this._attachVadHandler();
    this.onStateChange('confirm');
    this.onStatus('🎙️ 请确认这一步（空格=走，Esc=取消）');

    this._windowTotal = TURN.confirmMs;
    this._windowDeadline = Date.now() + TURN.confirmMs;
    this._windowTimer = setTimeout(function () { self._onWindowExpired(); }, TURN.confirmMs);
    this._tickTimer = setInterval(function () {
      const left = Math.max(0, self._windowDeadline - Date.now());
      self.onTick(left, self._windowTotal);
    }, TURN.tickMs);
    this.onTick(TURN.confirmMs, TURN.confirmMs);
  };

  // 放弃候选，重新进入本回合的聆听窗口
  ChessVoice.prototype.cancelConfirm = function () {
    if (this.mode !== 'confirm') return;
    this._closeWindow();
    this.armTurn();
  };

  // 确认成功：结束本回合，交给 AI（由 app.js 触发）
  ChessVoice.prototype.acceptConfirmed = function () {
    this._clearTimers();
    this._closeWindow();
    this.failureCount = 0;
    this.mode = 'rest';
    this.onStateChange('rest');
  };

  // 记录一次识别失败（看门狗）
  ChessVoice.prototype.noteFailure = function () {
    this.failureCount += 1;
  };

  ChessVoice.prototype.resetFailures = function () {
    this.failureCount = 0;
  };

  // 暂停监听（保持会话）—— 供"非玩家回合"或对局暂停时使用
  ChessVoice.prototype.pause = function () {
    if (this.mode === 'off' || this.mode === 'rest') return;
    this._clearTimers();
    this._closeWindow();
    this.mode = 'rest';
    this.onStateChange('rest');
  };

  // 恢复监听（重新走一轮回合调度）
  ChessVoice.prototype.resume = function () {
    if (!this.enabled) return;
    this.armTurn();
  };

  // 完全停止并释放会话（关闭麦克风）
  ChessVoice.prototype.stopAuto = function () {
    this.enabled = false;
    this._teardown();
  };

  ChessVoice.prototype._attachVadHandler = function () {
    if (!this.processor) return;
    const self = this;
    this.processor.onaudioprocess = function (e) {
      self._vadProcess(e.inputBuffer.getChannelData(0));
    };
  };

  ChessVoice.prototype._resetVad = function () {
    this.samples = [];
    this.speechActive = false;
    this.silenceMs = 0;
    this.speechMs = 0;
    this.onsetRun = 0;
    this.offRun = 0;
  };

  // 单块能量检测 + 状态推进（仅在 listening / confirm 态生效）
  ChessVoice.prototype._vadProcess = function (data) {
    if (this.mode !== 'listening' && this.mode !== 'confirm') return;
    if (!data || data.length === 0) return;

    const rms = this._rms(data);
    const isLoud = rms >= this.effectiveThreshold;

    if (isLoud) {
      this.onsetRun += 1;
      this.offRun = 0;
    } else {
      this.offRun += 1;
      this.onsetRun = 0;
    }

    // 起始去抖：必须连续 onsetBlocks 块超阈值才认定为"开始说话"
    if (!this.speechActive && isLoud && this.onsetRun >= VAD.onsetBlocks) {
      this.speechActive = true;
      this.speechMs = 0;
      this.silenceMs = 0;
      this.samples = [];
    }

    if (this.speechActive) {
      this.samples.push.apply(this.samples, Array.prototype.slice.call(data));

      if (isLoud) {
        this.speechMs += CHUNK_MS;
        this.silenceMs = 0;
      } else {
        this.silenceMs += CHUNK_MS;
      }

      // 结束门限自适应：长句给更宽的静音容忍度
      const needSilence = this.speechMs >= VAD.longSpeechMs ? VAD.longSilenceMs : VAD.silenceMs;
      if (this.silenceMs >= needSilence || this.speechMs >= VAD.maxSpeechMs) {
        this._onUtteranceEnd();
      }
    }
  };

  // 一句话结束：先收窗口，再判长短，然后送 ASR
  ChessVoice.prototype._onUtteranceEnd = async function () {
    const speechMs = this.speechMs;
    const samples = this.samples;
    const fromConfirm = (this.mode === 'confirm');

    // 冻结本句：停止 VAD 处理，防止重入
    this.speechActive = false;
    this.samples = [];
    this.silenceMs = 0;
    this.speechMs = 0;
    this.onsetRun = 0;
    this.offRun = 0;
    // 落回 rest：本句已切走，窗口不再活跃，由调用方决定 armTurn() 还是 enterConfirm()
    this.mode = 'rest';
    // 暂停窗口倒计时（识别期间不因超时被切断），识别结束后由调用方决定下一步
    if (this._windowTimer) { clearTimeout(this._windowTimer); this._windowTimer = null; }
    if (this._tickTimer) { clearInterval(this._tickTimer); this._tickTimer = null; }

    if (speechMs < VAD.minSpeechMs) {
      this.onStatus('🎙️ 声音太短，请再说一遍');
      if (fromConfirm) this.enterConfirm();
      else this._openWindow(TURN.listenMs);
      return;
    }

    this.onStatus('🔍 识别中…');
    let text = '';
    try {
      text = await this.transcribe(this.encodeWav(samples, SAMPLE_RATE));
    } catch (err) {
      this.onError((err && err.message) ? err.message : String(err));
      if (fromConfirm) this.enterConfirm();
      else this.armTurn();
      return;
    }

    if (!text) {
      this.onError('未识别到有效语音');
      if (fromConfirm) this.enterConfirm();
      else this.armTurn();
      return;
    }

    if (fromConfirm) {
      // 确认态：结果交给调用方按命令词/新候选解读
      this.onCommand(text);
    } else {
      // 聆听态：先给调用方一次"命令词"机会（取消/重说/暂停），再当棋步处理
      this.onResult(text);
    }
  };

  // 释放全部资源
  ChessVoice.prototype._teardown = function () {
    this._clearTimers();
    this.mode = 'off';
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.gainNode) this.gainNode.disconnect();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      this.audioContext.close().catch(function () {});
    }
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processor = null;
    this.gainNode = null;
    this._resetVad();
    this.failureCount = 0;
    this.onStateChange('off');
  };

  // ---------------- 手动模式（兼容，按需使用） ----------------

  ChessVoice.prototype.start = async function () {
    await this._ensureSession();
    if (this.mode === 'manual') return;
    this.mode = 'manual';
    this.samples = [];
    const self = this;
    this.processor.onaudioprocess = function (e) {
      const data = e.inputBuffer.getChannelData(0);
      self.samples.push.apply(self.samples, Array.prototype.slice.call(data));
    };
    this.onStateChange('recording');
    this.onStatus('🎙️ 正在聆听，请说出棋步…');
  };

  ChessVoice.prototype.stop = async function () {
    if (this.mode !== 'manual') return null;
    this.mode = null;
    if (this.processor) this.processor.onaudioprocess = null;
    this.onStatus('🔍 识别中…');
    try {
      const wavBase64 = this.encodeWav(this.samples, SAMPLE_RATE);
      const text = await this.transcribe(wavBase64);
      if (text) this.onResult(text);
      return text;
    } catch (err) {
      this.onError((err && err.message) ? err.message : String(err));
      return null;
    }
  };

  // 调用本地代理 /api/asr
  ChessVoice.prototype.transcribe = async function (audioBase64) {
    const resp = await fetch('/api/asr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_base64: audioBase64, mime: 'audio/wav' })
    });
    const data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || !data.ok) {
      throw new Error((data && data.error) || ('语音识别失败 (HTTP ' + resp.status + ')'));
    }
    return data.text;
  };

  // Float32 采样 → WAV (16-bit PCM mono) → Base64
  ChessVoice.prototype.encodeWav = function (samples, sampleRate) {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);

    const writeStr = function (offset, str) {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, numSamples * 2, true);

    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }

    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  };

  global.ChessVoice = ChessVoice;
  // 暴露常量供单元测试断言
  global.ChessVoice.VAD = VAD;
  global.ChessVoice.TURN = TURN;
  global.ChessVoice.CHUNK_MS = CHUNK_MS;
})(typeof window !== 'undefined' ? window : this);
