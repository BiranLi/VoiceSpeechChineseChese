/**
 * asr.js - 语音识别模块（阿里云百炼 Qwen ASR，经本地 server.py /api/asr 代理）
 *
 * 职责：
 *   1. getUserMedia 采集麦克风音频
 *   2. AudioContext 下采样至 16kHz，编码为 WAV (16-bit PCM)
 *   3. POST /api/asr 交给本地代理转发百炼，返回识别文本
 *
 * 说明：API Key 只存在于服务器端（环境变量 DASHSCOPE_API_KEY 或 --asr-api-key），
 *       前端永不接触 Key，避免泄露。
 */

(function (global) {
  'use strict';

  const SAMPLE_RATE = 16000;

  function ChessVoice(options) {
    options = options || {};
    this.onStatus = options.onStatus || function () {};
    this.onResult = options.onResult || function () {};
    this.onError = options.onError || function () {};

    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.processor = null;
    this.samples = [];
    this.recording = false;
  }

  // 浏览器是否支持录音
  ChessVoice.prototype.isSupported = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) &&
      !!(global.AudioContext || global.webkitAudioContext);
  };

  // 开始录音
  ChessVoice.prototype.start = async function () {
    if (this.recording) return;

    const AC = global.AudioContext || global.webkitAudioContext;
    this.audioContext = new AC({ sampleRate: SAMPLE_RATE });
    this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.samples = [];

    const self = this;
    this.processor.onaudioprocess = function (e) {
      const data = e.inputBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        self.samples.push(data[i]);
      }
    };

    this.sourceNode.connect(this.processor);
    this.processor.connect(this.audioContext.destination); // 保持链路活跃
    this.recording = true;
    this.onStatus('🎙️ 正在聆听，请说出棋步…（如"炮二平五"）');
  };

  // 停止录音并识别
  ChessVoice.prototype.stop = async function () {
    if (!this.recording) return null;
    this.recording = false;

    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      this.audioContext.close().catch(function () {});
    }
    this.audioContext = null;

    if (this.samples.length < SAMPLE_RATE * 0.2) {
      // 录音太短（< 200ms），大概率是误触
      this.onError('录音太短，请重试');
      return null;
    }

    const wavBase64 = this.encodeWav(this.samples, SAMPLE_RATE);
    this.onStatus('🔍 识别中…');

    try {
      const text = await this.transcribe(wavBase64);
      if (text) {
        this.onResult(text);
        return text;
      }
      this.onError('未识别到有效语音');
      return null;
    } catch (err) {
      this.onError((err && err.message) ? err.message : String(err));
      return null;
    }
  };

  // 取消录音（不识别）
  ChessVoice.prototype.cancel = function () {
    if (!this.recording) return;
    this.recording = false;
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
    }
    if (this.sourceNode) this.sourceNode.disconnect();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(function (t) { t.stop(); });
    }
    if (this.audioContext && typeof this.audioContext.close === 'function') {
      this.audioContext.close().catch(function () {});
    }
    this.audioContext = null;
    this.samples = [];
    this.onStatus('已取消聆听');
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
    view.setUint32(16, 16, true);          // fmt chunk size
    view.setUint16(20, 1, true);           // PCM
    view.setUint16(22, 1, true);           // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);           // block align
    view.setUint16(34, 16, true);          // bits per sample
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
