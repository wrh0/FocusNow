// 生成钉钉风格的提示音(清脆的双音"叮咚"电子铃声):
//   work-end.mp3  专注结束 —— 上行双音,明快收尾
//   break-end.mp3 休息结束 —— 下行双音,回到专注
// 纯数值合成(基频+泛音+指数衰减包络),用 lamejs 编码成 MP3,无外部音频依赖。
// 运行:npm install --no-save lamejs && node scripts/generate-sounds.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// lamejs 1.2.1 的已知 bug:部分源文件引用了未导入的全局符号(MPEGMode/Lame/BitStream),
// 在构造 Mp3Encoder 前先把它们挂到全局
const require = createRequire(import.meta.url);
globalThis.MPEGMode = require('lamejs/src/js/MPEGMode.js');
globalThis.Lame = require('lamejs/src/js/Lame.js');
globalThis.BitStream = require('lamejs/src/js/BitStream.js');
const lamejs = require('lamejs');

const SAMPLE_RATE = 44100;

// 渲染一声"叮"到缓冲区:叠加基频与二/三次泛音模拟铃声音色,
// 8ms 线性起音防止爆音,之后按时间常数 tau 指数衰减
function renderTone(buffer, freq, startSec, durSec, amp) {
  const start = Math.floor(startSec * SAMPLE_RATE);
  const length = Math.floor(durSec * SAMPLE_RATE);
  const attack = Math.floor(0.008 * SAMPLE_RATE);
  const tau = 0.22;
  for (let i = 0; i < length; i++) {
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t / tau) * (i < attack ? i / attack : 1);
    const wave =
      Math.sin(2 * Math.PI * freq * t) * 1.0 + // 基频
      Math.sin(2 * Math.PI * freq * 2 * t) * 0.4 + // 二次泛音
      Math.sin(2 * Math.PI * freq * 3 * t) * 0.15; // 三次泛音
    const idx = start + i;
    if (idx < buffer.length) buffer[idx] += wave * envelope * amp;
  }
}

// 双音"叮-咚":第二音在第一音衰减中途进入,尾音自然衔接
function renderDingDong(freqA, freqB, totalSec) {
  const buffer = new Float64Array(Math.ceil(totalSec * SAMPLE_RATE));
  renderTone(buffer, freqA, 0, 0.6, 0.5);
  renderTone(buffer, freqB, 0.22, totalSec - 0.22, 0.55);
  // 末尾 30ms 淡出,避免截断杂音
  const fade = Math.floor(0.03 * SAMPLE_RATE);
  for (let i = 0; i < fade; i++) {
    buffer[buffer.length - 1 - i] *= i / fade;
  }
  return buffer;
}

// 浮点采样裁剪到 [-1,1] 后转 16-bit PCM,分块喂给 lamejs 编码
function encodeMp3(floatBuffer) {
  const encoder = new lamejs.Mp3Encoder(1, SAMPLE_RATE, 128);
  const pcm = new Int16Array(floatBuffer.length);
  for (let i = 0; i < floatBuffer.length; i++) {
    pcm[i] = Math.max(-1, Math.min(1, floatBuffer[i])) * 32767;
  }
  const chunks = [];
  const blockSize = 1152;
  for (let i = 0; i < pcm.length; i += blockSize) {
    const encoded = encoder.encodeBuffer(pcm.subarray(i, i + blockSize));
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }
  const flushed = encoder.flush();
  if (flushed.length) chunks.push(Buffer.from(flushed));
  return Buffer.concat(chunks);
}

const A5 = 880;
const D6 = 1174.66;

const sounds = [
  { file: 'work-end.mp3', freqA: A5, freqB: D6 },
  { file: 'break-end.mp3', freqA: D6, freqB: A5 },
];

const outDir = path.resolve('resources/sounds');
fs.mkdirSync(outDir, { recursive: true });
for (const s of sounds) {
  const mp3 = encodeMp3(renderDingDong(s.freqA, s.freqB, 1.0));
  fs.writeFileSync(path.join(outDir, s.file), mp3);
  console.log(`${s.file}: ${mp3.length} bytes`);
}
