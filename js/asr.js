/**
 * asr.js - 语音识别模块（阿里云百炼 Qwen ASR，经本地 server.py /api/asr 代理）
 *
 * 支持两种模式：
 *   1. 自动模式（推荐）：startAuto() 后保持麦克风常开，内置 VAD（语音活动检测）——
 *      检测到人声自动开始录音，静音超时自动提交 ASR，全程无需按键。
 *      适合"AI 走完自动收音，玩家直接说棋步"的无手体验。
 *   2. 手动模式（兼容）：start()/stop() 手动控制录音窗口。
 *
 * 说明：API Key 只存在于服务器端（环境变量 DASHSCOPE_API_KEY 或 --asr-api-key），
 *       前端永不接触 Key，避免泄露。
 */

(function (global) {
  'use strict';

  const SAMPLE_RATE = 16000;

  // VAD（语音活动检测）参数
  const VAD = {
    energyThreshold: 0.02, // 单块 RMS 响度阈值，高于则视为"有人说话"
    silenceMs: 900,        // 说话后静音多久判定一句话结束（ms）
    minSpeechMs: 150,      // 最短有效语音时长（ms），太短视为噪声
    maxSpeechMs: 6000      // 单次最长语音时长（ms），防卡死
  };
  const CHUNK_SAMPLES = 2048;                       // 每块采样数（16kHz ≈ 128ms）
  const CHUNK_MS = (CHUNK_SAMPLES / SAMPLE_RATE) * 1000;

  function ChessVoice(options) {
    options = options || {};
    this.onStatus = options.onStatus || function () {};
    this.onResult = options.onResult || function () {};
    this.onError = options.onError || function () {};
    this.onStateChange = options.onStateChange || function () {};

    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processor = null;
    this.gainNode = null;

    this.mode = null;         // 'auto' | 'paused' | 'manual' | null
    this.samples = [];
    this.speechActive = false;
    this.silenceMs = 0;
    this.speechMs = 0;
  }

  // 浏览器是否支持录音
  ChessVoice.prototype.isSupported = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      !!(global.AudioContext || global.webkitAudioContext);
  };

  // 确保麦克风会话存在（只获取一次，自动模式下常驻复用）
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

  // ---------------- 自动模式（VAD） ----------------

  // 开始自动监听（获取会话 + 武装 VAD）
  ChessVoice.prototype.startAuto = async function () {
    await this._ensureSession();
    if (this.mode === 'auto') return;
    this._resetVad();
    this.mode = 'auto';
    this._attachVadHandler();
    this.onStateChange('listening');
    this.onStatus('🎙️ 语音已开启，请直接说棋步…');
  };

  // 暂停监听（保持会话，供 AI 思考等不需要收音的阶段使用）
  ChessVoice.prototype.pause = function () {
    if (this.mode !== 'auto') return;
    this.mode = 'paused';
    if (this.processor) this.processor.onaudioprocess = null;
    this._resetVad();
    this.onStateChange('paused');
  };

  // 恢复监听（重新武装 VAD）
  ChessVoice.prototype.resume = function () {
    if (!this.audioContext || this.mode === 'auto') return;
    this.mode = 'auto';
    this._resetVad();
    this._attachVadHandler();
    this.onStateChange('listening');
  };

  // 完全停止并释放会话（关闭麦克风）
  ChessVoice.prototype.stopAuto = function () {
    this._teardown();
  };

  // VAD 处理函数：挂到 processor.onaudioprocess
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
  };

  // 单块能量检测 + 状态推进
  ChessVoice.prototype._vadProcess = function (data) {
    if (!data || data.length === 0) return;
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      sum += data[i] * data[i];
    }
    const rms = Math.sqrt(sum / data.length);
    const isSpeech = rms >= VAD.energyThreshold;

    if (isSpeech) {
      if (!this.speechActive) {
        // 语音起始：重置窗口
        this.speechActive = true;
        this.speechMs = 0;
        this.silenceMs = 0;
        this.samples = [];
      }
      this.speechMs += CHUNK_MS;   // 只统计纯语音时长
      this.silenceMs = 0;
      this.samples.push.apply(this.samples, Array.prototype.slice.call(data));
    } else if (this.speechActive) {
      // 语音后的静音尾巴：保留采样但不再计入 speechMs
      this.silenceMs += CHUNK_MS;
      this.samples.push.apply(this.samples, Array.prototype.slice.call(data));
    }

    // 结束条件：语音后静音超时 或 单句超长
    if (this.speechActive &&
      (this.silenceMs >= VAD.silenceMs || this.speechMs >= VAD.maxSpeechMs)) {
      this._onUtteranceEnd();
    }
  };

  // 一句话结束：暂停 → 过滤过短噪声 → 编码 → ASR
  ChessVoice.prototype._onUtteranceEnd = async function () {
    // 先保存本句数据（pause 会 reset VAD 状态）
    const speechMs = this.speechMs;
    const samples = this.samples;

    this.pause(); // 先暂停，防止重入

    if (speechMs < VAD.minSpeechMs) {
      this.onStatus('🎙️ 声音太短，请再说一遍');
      this.resume();
      return;
    }

    this.onStatus('🔍 识别中…');
    try {
      const wavBase64 = this.encodeWav(samples, SAMPLE_RATE);
      const text = await this.transcribe(wavBase64);
      if (text) {
        this.onResult(text);
      } else {
        this.onError('未识别到有效语音');
      }
      // 是否重新监听（resume）由调用方决定：若玩家仍有行动权则 resume
    } catch (err) {
      this.onError((err && err.message) ? err.message : String(err));
    }
  };

  // 释放全部资源
  ChessVoice.prototype._teardown = function () {
    this.mode = null;
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
})(typeof window !== 'undefined' ? window : this);
