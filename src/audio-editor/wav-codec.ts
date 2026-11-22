export type WaveShape = 'sine' | 'square' | 'triangle' | 'sawtooth' | 'noise';

export interface AdsrParams {
  attackMs: number;
  decayMs: number;
  sustainLevel: number; // 0.0 to 1.0
  releaseMs: number;
}

export interface DecodedWav {
  samples: Float32Array;
  sampleRate: number;
}

export const DEFAULT_SAMPLE_RATE = 22050;

export function sampleWaveShape(shape: WaveShape, phaseRad: number): number {
  const norm = ((phaseRad / (Math.PI * 2)) % 1 + 1) % 1;
  switch (shape) {
    case 'sine':
      return Math.sin(phaseRad);
    case 'square':
      return norm < 0.5 ? 1 : -1;
    case 'triangle':
      return norm < 0.25 ? norm * 4 : norm < 0.75 ? 2 - norm * 4 : norm * 4 - 4;
    case 'sawtooth':
      return 2 * norm - 1;
    case 'noise':
      return Math.random() * 2 - 1;
  }
}

export function applyAdsrEnvelope(
  samples: Float32Array,
  sampleRate: number,
  adsr: AdsrParams
): Float32Array {
  const out = new Float32Array(samples.length);
  const total = samples.length;
  if (total === 0) return out;

  const attackSamples = Math.max(0, Math.round((adsr.attackMs / 1000) * sampleRate));
  const decaySamples = Math.max(0, Math.round((adsr.decayMs / 1000) * sampleRate));
  const releaseSamples = Math.max(0, Math.round((adsr.releaseMs / 1000) * sampleRate));
  const sustain = Math.max(0, Math.min(1, adsr.sustainLevel));

  // Ensure attack + decay + release never exceed total duration
  const sumADR = attackSamples + decaySamples + releaseSamples;
  const scale = sumADR > total && sumADR > 0 ? total / sumADR : 1;
  const aN = Math.round(attackSamples * scale);
  const dN = Math.round(decaySamples * scale);
  const rN = Math.round(releaseSamples * scale);
  const releaseStart = Math.max(aN + dN, total - rN);

  for (let i = 0; i < total; i++) {
    let env = sustain;
    if (i < aN && aN > 0) {
      env = i / aN;
    } else if (i < aN + dN && dN > 0) {
      const t = (i - aN) / dN;
      env = 1 - (1 - sustain) * t;
    } else if (i >= releaseStart && rN > 0) {
      const t = (i - releaseStart) / rN;
      env = sustain * (1 - Math.min(1, t));
    }
    out[i] = samples[i] * env;
  }

  return out;
}

export function generateToneSamples(opts: {
  shape: WaveShape;
  startFreq: number;
  endFreq: number;
  durationSec: number;
  amplitude: number;
  sampleRate?: number;
  adsr?: AdsrParams | null;
}): Float32Array {
  const sr = opts.sampleRate || DEFAULT_SAMPLE_RATE;
  const count = Math.max(1, Math.round(opts.durationSec * sr));
  const out = new Float32Array(count);
  const amp = Math.max(0, Math.min(1, opts.amplitude));

  let phase = 0;
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? i / (count - 1) : 0;
    const freq = opts.startFreq + (opts.endFreq - opts.startFreq) * t;
    phase += (2 * Math.PI * Math.max(1, freq)) / sr;
    out[i] = sampleWaveShape(opts.shape, phase) * amp;
  }

  return opts.adsr ? applyAdsrEnvelope(out, sr, opts.adsr) : out;
}

export function generateFmSamples(opts: {
  carrierFreq: number;
  modFreq: number;
  modDepthHz: number;
  carrierShape: WaveShape;
  modShape: WaveShape;
  durationSec: number;
  amplitude: number;
  sampleRate?: number;
  adsr?: AdsrParams | null;
}): Float32Array {
  const sr = opts.sampleRate || DEFAULT_SAMPLE_RATE;
  const count = Math.max(1, Math.round(opts.durationSec * sr));
  const out = new Float32Array(count);
  const amp = Math.max(0, Math.min(1, opts.amplitude));

  let carrierPhase = 0;
  let modPhase = 0;

  for (let i = 0; i < count; i++) {
    modPhase += (2 * Math.PI * Math.max(0.5, opts.modFreq)) / sr;
    const modSignal = sampleWaveShape(opts.modShape, modPhase);
    const instantFreq = Math.max(1, opts.carrierFreq + opts.modDepthHz * modSignal);
    carrierPhase += (2 * Math.PI * instantFreq) / sr;
    out[i] = sampleWaveShape(opts.carrierShape, carrierPhase) * amp;
  }

  return opts.adsr ? applyAdsrEnvelope(out, sr, opts.adsr) : out;
}

/**
 * Encodes mono Float32Array PCM samples (-1.0..1.0) into a standard 16-bit RIFF/WAVE binary.
 */
export function encodeWavBytes(samples: Float32Array, sampleRate = DEFAULT_SAMPLE_RATE): Uint8Array {
  const numSamples = samples.length;
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = PCM
  view.setUint16(22, 1, true); // NumChannels = 1 (mono)
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // ByteRate
  view.setUint16(32, 2, true); // BlockAlign
  view.setUint16(34, 16, true); // BitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    const int16 = clamped < 0 ? Math.round(clamped * 32768) : Math.round(clamped * 32767);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function encodeWavToDataUrl(samples: Float32Array, sampleRate = DEFAULT_SAMPLE_RATE): string {
  const bytes = encodeWavBytes(samples, sampleRate);
  return `data:audio/wav;base64,${bytesToBase64(bytes)}`;
}

/**
 * Decodes a RIFF/WAVE data URL (8-bit, 16-bit, 24-bit PCM or 32-bit float; mono or stereo)
 * into a normalized mono Float32Array.
 */
export function decodeWavDataUrl(dataUrl: string): DecodedWav {
  const commaIdx = dataUrl.indexOf(',');
  const b64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
  const bytes = base64ToBytes(b64);
  return decodeWavBytes(bytes);
}

export function decodeWavBytes(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 44) {
    return { samples: new Float32Array(DEFAULT_SAMPLE_RATE * 0.25), sampleRate: DEFAULT_SAMPLE_RATE };
  }

  let audioFormat = 1;
  let numChannels = 1;
  let sampleRate = DEFAULT_SAMPLE_RATE;
  let bitsPerSample = 16;
  let dataOffset = -1;
  let dataSize = 0;

  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(
      view.getUint8(pos),
      view.getUint8(pos + 1),
      view.getUint8(pos + 2),
      view.getUint8(pos + 3)
    );
    const size = view.getUint32(pos + 4, true);
    if (id === 'fmt ' && pos + 8 + 16 <= bytes.byteLength) {
      audioFormat = view.getUint16(pos + 8, true);
      numChannels = Math.max(1, view.getUint16(pos + 10, true));
      sampleRate = view.getUint32(pos + 12, true) || DEFAULT_SAMPLE_RATE;
      bitsPerSample = view.getUint16(pos + 22, true) || 16;
    } else if (id === 'data') {
      dataOffset = pos + 8;
      dataSize = Math.min(size, bytes.byteLength - dataOffset);
      break;
    }
    pos += 8 + size + (size % 2);
  }

  if (dataOffset < 0 || dataSize <= 0) {
    return { samples: new Float32Array(DEFAULT_SAMPLE_RATE * 0.25), sampleRate };
  }

  const bytesPerSample = Math.max(1, bitsPerSample / 8);
  const frameSize = bytesPerSample * numChannels;
  const numFrames = Math.floor(dataSize / frameSize);
  const samples = new Float32Array(numFrames);

  for (let i = 0; i < numFrames; i++) {
    let sum = 0;
    for (let ch = 0; ch < numChannels; ch++) {
      const off = dataOffset + i * frameSize + ch * bytesPerSample;
      let s = 0;
      if (audioFormat === 3 && bitsPerSample === 32) {
        s = view.getFloat32(off, true);
      } else if (bitsPerSample === 8) {
        s = (view.getUint8(off) - 128) / 128;
      } else if (bitsPerSample === 16) {
        s = view.getInt16(off, true) / 32768;
      } else if (bitsPerSample === 24) {
        const b0 = view.getUint8(off);
        const b1 = view.getUint8(off + 1);
        const b2 = view.getUint8(off + 2);
        let val = b0 | (b1 << 8) | (b2 << 16);
        if (val & 0x800000) val |= ~0xffffff;
        s = val / 8388608;
      } else if (bitsPerSample === 32) {
        s = view.getInt32(off, true) / 2147483648;
      }
      sum += s;
    }
    samples[i] = Math.max(-1, Math.min(1, sum / numChannels));
  }

  return { samples, sampleRate };
}

export function createStarterSoundWav(
  preset: 'boop' | 'coin' | 'jump' | 'laser' | 'boom' = 'boop'
): string {
  const sr = DEFAULT_SAMPLE_RATE;
  let samples: Float32Array;

  switch (preset) {
    case 'coin': {
      const a = generateToneSamples({
        shape: 'square',
        startFreq: 988,
        endFreq: 988,
        durationSec: 0.08,
        amplitude: 0.45,
        sampleRate: sr,
        adsr: { attackMs: 4, decayMs: 20, sustainLevel: 0.7, releaseMs: 10 },
      });
      const b = generateToneSamples({
        shape: 'square',
        startFreq: 1319,
        endFreq: 1319,
        durationSec: 0.24,
        amplitude: 0.45,
        sampleRate: sr,
        adsr: { attackMs: 4, decayMs: 60, sustainLevel: 0.5, releaseMs: 120 },
      });
      samples = new Float32Array(a.length + b.length);
      samples.set(a, 0);
      samples.set(b, a.length);
      break;
    }
    case 'jump':
      samples = generateToneSamples({
        shape: 'triangle',
        startFreq: 240,
        endFreq: 680,
        durationSec: 0.22,
        amplitude: 0.65,
        sampleRate: sr,
        adsr: { attackMs: 5, decayMs: 60, sustainLevel: 0.5, releaseMs: 80 },
      });
      break;
    case 'laser':
      samples = generateToneSamples({
        shape: 'sawtooth',
        startFreq: 1100,
        endFreq: 180,
        durationSec: 0.18,
        amplitude: 0.5,
        sampleRate: sr,
        adsr: { attackMs: 2, decayMs: 40, sustainLevel: 0.4, releaseMs: 90 },
      });
      break;
    case 'boom':
      samples = generateToneSamples({
        shape: 'noise',
        startFreq: 120,
        endFreq: 40,
        durationSec: 0.42,
        amplitude: 0.75,
        sampleRate: sr,
        adsr: { attackMs: 5, decayMs: 120, sustainLevel: 0.35, releaseMs: 220 },
      });
      break;
    case 'boop':
    default:
      samples = generateFmSamples({
        carrierFreq: 440,
        modFreq: 220,
        modDepthHz: 90,
        carrierShape: 'sine',
        modShape: 'sine',
        durationSec: 0.22,
        amplitude: 0.55,
        sampleRate: sr,
        adsr: { attackMs: 6, decayMs: 50, sustainLevel: 0.5, releaseMs: 100 },
      });
      break;
  }

  return encodeWavToDataUrl(samples, sr);
}
