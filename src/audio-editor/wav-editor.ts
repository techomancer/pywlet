import {
  applyAdsrEnvelope,
  decodeWavDataUrl,
  DEFAULT_SAMPLE_RATE,
  encodeWavToDataUrl,
  generateFmSamples,
  generateToneSamples,
  type AdsrParams,
  type WaveShape,
} from './wav-codec';

export interface WavEditorCallbacks {
  onSaveWavFile: (filename: string, dataUrl: string) => void;
}

type InsertMode = 'replace' | 'insert' | 'mix';

export class WavEditorController {
  private container: HTMLElement;
  private callbacks: WavEditorCallbacks;

  private filename = 'assets/boop.wav';
  private sampleRate = DEFAULT_SAMPLE_RATE;
  private samples: Float32Array = new Float32Array(DEFAULT_SAMPLE_RATE * 0.25);
  private readOnly = false;

  private cursorSample = 0;
  private selStart: number | null = null;
  private selEnd: number | null = null;

  private clipboard: Float32Array | null = null;
  private undoStack: Float32Array[] = [];

  private waveCanvas!: HTMLCanvasElement;
  private waveCtx!: CanvasRenderingContext2D;
  private envCanvas!: HTMLCanvasElement;
  private envCtx!: CanvasRenderingContext2D;

  private isDraggingWave = false;
  private dragAnchorSample = 0;

  private audioCtx: AudioContext | null = null;
  private activeSource: AudioBufferSourceNode | null = null;
  private playStartTime = 0;
  private playOffsetSample = 0;
  private playEndSample = 0;
  private playLoop = false;
  private playAnimId: number | null = null;

  constructor(container: HTMLElement, callbacks: WavEditorCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.buildDOM();
    this.renderAll();
  }

  public loadWavFile(filename: string, dataUrl: string): void {
    this.stopPlayback();
    this.filename = filename;
    this.undoStack = [];
    this.selStart = null;
    this.selEnd = null;
    this.cursorSample = 0;

    try {
      const decoded = decodeWavDataUrl(dataUrl);
      this.samples = decoded.samples;
      this.sampleRate = decoded.sampleRate || DEFAULT_SAMPLE_RATE;
    } catch {
      this.sampleRate = DEFAULT_SAMPLE_RATE;
      this.samples = new Float32Array(DEFAULT_SAMPLE_RATE * 0.25);
    }

    this.renderAll();
  }

  public getFilename(): string {
    return this.filename;
  }

  public setReadOnly(readOnly: boolean): void {
    this.readOnly = readOnly;
    const studio = this.container.querySelector('.wav-studio');
    if (studio) {
      studio.classList.toggle('is-readonly', readOnly);
    }
    const mutatingSelectors = [
      '#wav-btn-undo',
      '#wav-btn-save',
      '#wav-btn-cut',
      '#wav-btn-paste',
      '#wav-btn-delete',
      '#wav-btn-silence',
      '#wav-vol-slider',
      '#wav-btn-vol-apply',
      '#wav-btn-normalize',
      '#wav-btn-fade-in',
      '#wav-btn-fade-out',
      '#wav-btn-gen-tone',
      '#wav-btn-gen-fm',
      '#wav-btn-apply-env',
      '.wav-preset-btn',
      '.wav-fm-preset-btn',
    ];
    for (const sel of mutatingSelectors) {
      this.container.querySelectorAll(sel).forEach((el) => {
        (el as HTMLButtonElement | HTMLInputElement).disabled = readOnly;
      });
    }
  }

  public stopPlayback(): void {
    if (this.activeSource) {
      try {
        this.activeSource.stop();
        this.activeSource.disconnect();
      } catch {
        // Ignore already-stopped source
      }
      this.activeSource = null;
    }
    if (this.playAnimId !== null) {
      cancelAnimationFrame(this.playAnimId);
      this.playAnimId = null;
    }
    this.renderWaveform();
  }

  private pushUndo(): void {
    this.undoStack.push(new Float32Array(this.samples));
    if (this.undoStack.length > 25) {
      this.undoStack.shift();
    }
  }

  private emitSave(): void {
    if (this.readOnly) return;
    const dataUrl = encodeWavToDataUrl(this.samples, this.sampleRate);
    this.callbacks.onSaveWavFile(this.filename, dataUrl);
  }

  private getSelectionRange(): { start: number; end: number; hasSelection: boolean } {
    if (this.selStart !== null && this.selEnd !== null) {
      const a = Math.max(0, Math.min(this.samples.length, Math.min(this.selStart, this.selEnd)));
      const b = Math.max(0, Math.min(this.samples.length, Math.max(this.selStart, this.selEnd)));
      if (b - a > 1) {
        return { start: a, end: b, hasSelection: true };
      }
    }
    return { start: 0, end: this.samples.length, hasSelection: false };
  }

  private getAdsrParams(): AdsrParams {
    const a = Number((this.container.querySelector('#wav-env-a') as HTMLInputElement)?.value) || 0;
    const d = Number((this.container.querySelector('#wav-env-d') as HTMLInputElement)?.value) || 0;
    const s = (Number((this.container.querySelector('#wav-env-s') as HTMLInputElement)?.value) || 0) / 100;
    const r = Number((this.container.querySelector('#wav-env-r') as HTMLInputElement)?.value) || 0;
    return { attackMs: a, decayMs: d, sustainLevel: s, releaseMs: r };
  }

  private buildDOM(): void {
    this.container.innerHTML = `
      <div class="wav-studio">
        <!-- Top Transport & File Bar -->
        <div class="wav-toolbar">
          <div class="wav-toolbar-group">
            <button id="wav-btn-play" class="btn btn-small btn-run" title="Play marked selection (or full sound)">▶ Play</button>
            <button id="wav-btn-play-all" class="btn btn-small" title="Play full clip from start">▶ All</button>
            <button id="wav-btn-stop" class="btn btn-small btn-stop" title="Stop playback">⏹ Stop</button>
            <label class="checkbox-label">
              <input type="checkbox" id="wav-loop-toggle" />
              🔁 Loop
            </label>
            <span id="wav-meta-badge" class="badge badge-ok">0.25s · 22050 Hz</span>
          </div>

          <div class="wav-toolbar-group">
            <button id="wav-btn-undo" class="btn btn-small" title="Undo last edit">↩ Undo</button>
            <button id="wav-btn-save" class="btn btn-small btn-Ask" title="Save .wav to workspace">💾 Save .wav</button>
            <button id="wav-btn-export" class="btn btn-small" title="Download .wav file to computer">⬇ Export .wav</button>
          </div>
        </div>

        <!-- Interactive Waveform Canvas Card -->
        <div class="wav-wave-card">
          <div class="section-header">
            <span id="wav-wave-title">🔊 WAVEFORM — Drag on the wave to mark a section!</span>
            <span id="wav-sel-readout" class="coord-readout">Cursor: 0 ms</span>
          </div>
          <div class="wav-canvas-wrap">
            <canvas id="wav-canvas" width="900" height="175"></canvas>
          </div>

          <!-- Mark, Cut/Copy/Paste, Volume & Fade Controls -->
          <div class="wav-edit-bar">
            <div class="wav-edit-group">
              <span class="wav-group-label">Mark &amp; Edit:</span>
              <button id="wav-btn-sel-all" class="icon-btn" title="Mark entire waveform">Select All</button>
              <button id="wav-btn-sel-clear" class="icon-btn" title="Clear selection mark">Clear Mark</button>
              <button id="wav-btn-cut" class="icon-btn" title="Cut marked selection to clipboard">✂️ Cut</button>
              <button id="wav-btn-copy" class="icon-btn" title="Copy marked selection">📋 Copy</button>
              <button id="wav-btn-paste" class="icon-btn" title="Paste clipboard at cursor or over mark">📥 Paste</button>
              <button id="wav-btn-delete" class="icon-btn" title="Delete marked selection">🗑 Delete</button>
              <button id="wav-btn-silence" class="icon-btn" title="Silence marked selection">🔇 Silence</button>
            </div>

            <div class="wav-edit-group">
              <span class="wav-group-label">Volume &amp; Fades:</span>
              <input id="wav-vol-slider" type="range" min="10" max="250" value="100" title="Volume percentage" />
              <span id="wav-vol-val" class="wav-val-label">100%</span>
              <button id="wav-btn-vol-apply" class="icon-btn" title="Apply volume gain to selection or whole clip">🔊 Apply Vol</button>
              <button id="wav-btn-normalize" class="icon-btn" title="Normalize loudness to 95% peak">📊 Normalize</button>
              <button id="wav-btn-fade-in" class="icon-btn" title="Fade in marked selection or whole clip">📈 Fade In</button>
              <button id="wav-btn-fade-out" class="icon-btn" title="Fade out marked selection or whole clip">📉 Fade Out</button>
            </div>
          </div>
        </div>

        <!-- Bottom Deck: Generators (Tone + FM) & ADSR Envelope Tool -->
        <div class="wav-deck-grid">
          <!-- Left: Tone & FM Generator Card -->
          <div class="sprite-card wav-gen-card">
            <div class="wav-gen-tabs">
              <button id="wav-tab-tone" class="mode-tab active">🌊 Tone Generator</button>
              <button id="wav-tab-fm" class="mode-tab">🎛️ FM Synth</button>
              <div class="wav-gen-mode-wrap">
                <label>Mode:</label>
                <select id="wav-insert-mode" class="select-control select-small">
                  <option value="replace">Replace (or Mark)</option>
                  <option value="insert">Insert at Cursor</option>
                  <option value="mix">Mix / Layer</option>
                </select>
                <label class="checkbox-label">
                  <input type="checkbox" id="wav-use-adsr" checked />
                  Use Envelope
                </label>
              </div>
            </div>

            <!-- Tone Generator Controls -->
            <div id="wav-pane-tone" class="wav-gen-pane">
              <div class="wav-param-grid">
                <label class="wav-field">
                  <span>Wave Shape</span>
                  <select id="wav-tone-shape" class="select-control select-small">
                    <option value="sine">〰️ Sine (Smooth)</option>
                    <option value="square">⎍ Square (8-bit Retro)</option>
                    <option value="triangle">△ Triangle (Soft Chiptune)</option>
                    <option value="sawtooth">⩘ Sawtooth (Buzzy Synth)</option>
                    <option value="noise">🌫️ White Noise (Boom / Hi-Hat)</option>
                  </select>
                </label>
                <label class="wav-field">
                  <span>Start Freq: <strong id="wav-tone-f1-val">440 Hz</strong></span>
                  <input id="wav-tone-f1" type="range" min="40" max="2400" value="440" />
                </label>
                <label class="wav-field">
                  <span>End Freq (Sweep): <strong id="wav-tone-f2-val">440 Hz</strong></span>
                  <input id="wav-tone-f2" type="range" min="40" max="2400" value="440" />
                </label>
                <label class="wav-field">
                  <span>Duration: <strong id="wav-tone-dur-val">0.30 s</strong></span>
                  <input id="wav-tone-dur" type="range" min="0.05" max="3.0" step="0.05" value="0.30" />
                </label>
                <label class="wav-field">
                  <span>Amplitude: <strong id="wav-tone-amp-val">65%</strong></span>
                  <input id="wav-tone-amp" type="range" min="10" max="100" value="65" />
                </label>
                <div class="wav-field wav-field-action">
                  <button id="wav-btn-gen-tone" class="btn btn-run btn-small">✨ Generate Tone</button>
                </div>
              </div>
              <div class="wav-presets-row">
                <span class="wav-group-label">Quick Arcade Presets:</span>
                <button class="icon-btn wav-preset-btn" data-preset="coin">🪙 Coin</button>
                <button class="icon-btn wav-preset-btn" data-preset="jump">🦘 Jump</button>
                <button class="icon-btn wav-preset-btn" data-preset="laser">🔫 Laser</button>
                <button class="icon-btn wav-preset-btn" data-preset="boom">💥 Boom</button>
                <button class="icon-btn wav-preset-btn" data-preset="beep">🎵 Beep</button>
              </div>
            </div>

            <!-- FM Generator Controls -->
            <div id="wav-pane-fm" class="wav-gen-pane hidden">
              <div class="wav-param-grid">
                <label class="wav-field">
                  <span>Carrier Wave</span>
                  <select id="wav-fm-cshape" class="select-control select-small">
                    <option value="sine">Sine</option>
                    <option value="triangle">Triangle</option>
                    <option value="square">Square</option>
                    <option value="sawtooth">Sawtooth</option>
                  </select>
                </label>
                <label class="wav-field">
                  <span>Modulator Wave</span>
                  <select id="wav-fm-mshape" class="select-control select-small">
                    <option value="sine">Sine</option>
                    <option value="triangle">Triangle</option>
                    <option value="square">Square</option>
                    <option value="sawtooth">Sawtooth</option>
                  </select>
                </label>
                <label class="wav-field">
                  <span>Carrier Freq: <strong id="wav-fm-fc-val">440 Hz</strong></span>
                  <input id="wav-fm-fc" type="range" min="40" max="2000" value="440" />
                </label>
                <label class="wav-field">
                  <span>Modulator Freq: <strong id="wav-fm-fm-val">220 Hz</strong></span>
                  <input id="wav-fm-fm" type="range" min="1" max="1500" value="220" />
                </label>
                <label class="wav-field">
                  <span>FM Depth: <strong id="wav-fm-depth-val">180 Hz</strong></span>
                  <input id="wav-fm-depth" type="range" min="0" max="1500" value="180" />
                </label>
                <label class="wav-field">
                  <span>Duration: <strong id="wav-fm-dur-val">0.45 s</strong></span>
                  <input id="wav-fm-dur" type="range" min="0.05" max="3.0" step="0.05" value="0.45" />
                </label>
              </div>
              <div class="wav-presets-row">
                <button id="wav-btn-gen-fm" class="btn btn-run btn-small">✨ Generate FM</button>
                <span class="wav-group-label">FM Presets:</span>
                <button class="icon-btn wav-fm-preset-btn" data-fm="bell">🔔 Sci-Fi Bell</button>
                <button class="icon-btn wav-fm-preset-btn" data-fm="robot">🤖 Robot</button>
                <button class="icon-btn wav-fm-preset-btn" data-fm="ufo">🛸 UFO</button>
                <button class="icon-btn wav-fm-preset-btn" data-fm="zap">⚡ Power Zap</button>
              </div>
            </div>
          </div>

          <!-- Right: Simple ADSR Envelope Tool -->
          <div class="sprite-card wav-env-card">
            <div class="section-header">
              <span>📐 ENVELOPE TOOL (ADSR)</span>
              <button id="wav-btn-apply-env" class="icon-btn" title="Shape the marked selection (or whole clip) with this envelope">
                Apply Envelope
              </button>
            </div>
            <canvas id="wav-env-canvas" width="260" height="72"></canvas>
            <div class="wav-env-sliders">
              <label class="wav-env-row">
                <span>Attack</span>
                <input id="wav-env-a" type="range" min="0" max="500" value="10" />
                <span id="wav-env-a-val">10ms</span>
              </label>
              <label class="wav-env-row">
                <span>Decay</span>
                <input id="wav-env-d" type="range" min="0" max="500" value="80" />
                <span id="wav-env-d-val">80ms</span>
              </label>
              <label class="wav-env-row">
                <span>Sustain</span>
                <input id="wav-env-s" type="range" min="0" max="100" value="55" />
                <span id="wav-env-s-val">55%</span>
              </label>
              <label class="wav-env-row">
                <span>Release</span>
                <input id="wav-env-r" type="range" min="0" max="800" value="120" />
                <span id="wav-env-r-val">120ms</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;

    this.waveCanvas = this.container.querySelector('#wav-canvas') as HTMLCanvasElement;
    this.waveCtx = this.waveCanvas.getContext('2d')!;
    this.envCanvas = this.container.querySelector('#wav-env-canvas') as HTMLCanvasElement;
    this.envCtx = this.envCanvas.getContext('2d')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector(sel) as T;

    // Transport
    q('#wav-btn-play').addEventListener('click', () => {
      const { start, end, hasSelection } = this.getSelectionRange();
      this.playRange(hasSelection ? start : this.cursorSample, end);
    });
    q('#wav-btn-play-all').addEventListener('click', () => this.playRange(0, this.samples.length));
    q('#wav-btn-stop').addEventListener('click', () => this.stopPlayback());
    q<HTMLInputElement>('#wav-loop-toggle').addEventListener('change', (e) => {
      this.playLoop = (e.target as HTMLInputElement).checked;
      if (this.activeSource) this.activeSource.loop = this.playLoop;
    });

    // Undo / Save / Export
    q('#wav-btn-undo').addEventListener('click', () => {
      const prev = this.undoStack.pop();
      if (prev) {
        this.samples = prev;
        this.selStart = null;
        this.selEnd = null;
        this.cursorSample = Math.min(this.cursorSample, this.samples.length);
        this.renderAll();
        this.emitSave();
      }
    });

    q('#wav-btn-save').addEventListener('click', () => {
      this.emitSave();
    });

    q('#wav-btn-export').addEventListener('click', () => {
      const dataUrl = encodeWavToDataUrl(this.samples, this.sampleRate);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = this.filename.split('/').pop() || 'sound.wav';
      a.click();
    });

    // Waveform marking (click + drag)
    const sampleFromMouseEvent = (e: MouseEvent): number => {
      const rect = this.waveCanvas.getBoundingClientRect();
      const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      return Math.round(norm * this.samples.length);
    };

    this.waveCanvas.addEventListener('mousedown', (e) => {
      const s = sampleFromMouseEvent(e);
      this.isDraggingWave = true;
      this.dragAnchorSample = s;
      this.cursorSample = s;
      this.selStart = s;
      this.selEnd = s;
      this.renderWaveform();
      this.updateReadouts();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDraggingWave) return;
      const s = sampleFromMouseEvent(e);
      this.selStart = this.dragAnchorSample;
      this.selEnd = s;
      this.renderWaveform();
      this.updateReadouts();
    });

    window.addEventListener('mouseup', () => {
      if (!this.isDraggingWave) return;
      this.isDraggingWave = false;
      if (this.selStart !== null && this.selEnd !== null && Math.abs(this.selEnd - this.selStart) <= 4) {
        this.selStart = null;
        this.selEnd = null;
      }
      this.renderWaveform();
      this.updateReadouts();
    });

    this.waveCanvas.addEventListener('dblclick', () => {
      this.selStart = 0;
      this.selEnd = this.samples.length;
      this.renderWaveform();
      this.updateReadouts();
    });

    // Mark & Clipboard actions
    q('#wav-btn-sel-all').addEventListener('click', () => {
      this.selStart = 0;
      this.selEnd = this.samples.length;
      this.renderWaveform();
      this.updateReadouts();
    });

    q('#wav-btn-sel-clear').addEventListener('click', () => {
      this.selStart = null;
      this.selEnd = null;
      this.renderWaveform();
      this.updateReadouts();
    });

    q('#wav-btn-copy').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      this.clipboard = this.samples.slice(start, end);
      this.updateReadouts();
    });

    q('#wav-btn-cut').addEventListener('click', () => {
      const { start, end, hasSelection } = this.getSelectionRange();
      if (!hasSelection) return;
      this.pushUndo();
      this.clipboard = this.samples.slice(start, end);
      this.deleteRange(start, end);
    });

    q('#wav-btn-delete').addEventListener('click', () => {
      const { start, end, hasSelection } = this.getSelectionRange();
      if (!hasSelection) return;
      this.pushUndo();
      this.deleteRange(start, end);
    });

    q('#wav-btn-paste').addEventListener('click', () => {
      if (!this.clipboard || this.clipboard.length === 0) return;
      this.pushUndo();
      const { start, end, hasSelection } = this.getSelectionRange();
      const insertAt = hasSelection ? start : Math.min(this.cursorSample, this.samples.length);
      const afterStart = hasSelection ? end : insertAt;

      const next = new Float32Array(insertAt + this.clipboard.length + (this.samples.length - afterStart));
      next.set(this.samples.subarray(0, insertAt), 0);
      next.set(this.clipboard, insertAt);
      next.set(this.samples.subarray(afterStart), insertAt + this.clipboard.length);
      this.samples = next;
      this.selStart = insertAt;
      this.selEnd = insertAt + this.clipboard.length;
      this.cursorSample = this.selEnd;
      this.renderAll();
      this.emitSave();
    });

    q('#wav-btn-silence').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      this.pushUndo();
      for (let i = start; i < end; i++) {
        this.samples[i] = 0;
      }
      this.renderAll();
      this.emitSave();
    });

    // Volume, Normalize, Fade In, Fade Out
    const volSlider = q<HTMLInputElement>('#wav-vol-slider');
    volSlider.addEventListener('input', () => {
      q('#wav-vol-val').textContent = `${volSlider.value}%`;
    });

    q('#wav-btn-vol-apply').addEventListener('click', () => {
      const gain = Number(volSlider.value) / 100;
      const { start, end } = this.getSelectionRange();
      this.pushUndo();
      for (let i = start; i < end; i++) {
        this.samples[i] = Math.max(-1, Math.min(1, this.samples[i] * gain));
      }
      volSlider.value = '100';
      q('#wav-vol-val').textContent = '100%';
      this.renderAll();
      this.emitSave();
    });

    q('#wav-btn-normalize').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      let peak = 0;
      for (let i = start; i < end; i++) {
        const a = Math.abs(this.samples[i]);
        if (a > peak) peak = a;
      }
      if (peak < 0.0001) return;
      this.pushUndo();
      const scale = 0.95 / peak;
      for (let i = start; i < end; i++) {
        this.samples[i] = Math.max(-1, Math.min(1, this.samples[i] * scale));
      }
      this.renderAll();
      this.emitSave();
    });

    q('#wav-btn-fade-in').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      const len = end - start;
      if (len <= 1) return;
      this.pushUndo();
      for (let i = 0; i < len; i++) {
        this.samples[start + i] *= i / (len - 1);
      }
      this.renderAll();
      this.emitSave();
    });

    q('#wav-btn-fade-out').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      const len = end - start;
      if (len <= 1) return;
      this.pushUndo();
      for (let i = 0; i < len; i++) {
        this.samples[start + i] *= 1 - i / (len - 1);
      }
      this.renderAll();
      this.emitSave();
    });

    // Generator Tabs
    const tabTone = q('#wav-tab-tone');
    const tabFm = q('#wav-tab-fm');
    const paneTone = q('#wav-pane-tone');
    const paneFm = q('#wav-pane-fm');

    tabTone.addEventListener('click', () => {
      tabTone.classList.add('active');
      tabFm.classList.remove('active');
      paneTone.classList.remove('hidden');
      paneFm.classList.add('hidden');
    });

    tabFm.addEventListener('click', () => {
      tabFm.classList.add('active');
      tabTone.classList.remove('active');
      paneFm.classList.remove('hidden');
      paneTone.classList.add('hidden');
    });

    // Live slider label bindings
    const bindSlider = (id: string, outId: string, fmt: (v: string) => string, extra?: () => void) => {
      const el = q<HTMLInputElement>(id);
      el.addEventListener('input', () => {
        q(outId).textContent = fmt(el.value);
        extra?.();
      });
    };

    bindSlider('#wav-tone-f1', '#wav-tone-f1-val', (v) => `${v} Hz`);
    bindSlider('#wav-tone-f2', '#wav-tone-f2-val', (v) => `${v} Hz`);
    bindSlider('#wav-tone-dur', '#wav-tone-dur-val', (v) => `${Number(v).toFixed(2)} s`);
    bindSlider('#wav-tone-amp', '#wav-tone-amp-val', (v) => `${v}%`);

    bindSlider('#wav-fm-fc', '#wav-fm-fc-val', (v) => `${v} Hz`);
    bindSlider('#wav-fm-fm', '#wav-fm-fm-val', (v) => `${v} Hz`);
    bindSlider('#wav-fm-depth', '#wav-fm-depth-val', (v) => `${v} Hz`);
    bindSlider('#wav-fm-dur', '#wav-fm-dur-val', (v) => `${Number(v).toFixed(2)} s`);

    bindSlider('#wav-env-a', '#wav-env-a-val', (v) => `${v}ms`, () => this.renderEnvelopePreview());
    bindSlider('#wav-env-d', '#wav-env-d-val', (v) => `${v}ms`, () => this.renderEnvelopePreview());
    bindSlider('#wav-env-s', '#wav-env-s-val', (v) => `${v}%`, () => this.renderEnvelopePreview());
    bindSlider('#wav-env-r', '#wav-env-r-val', (v) => `${v}ms`, () => this.renderEnvelopePreview());

    // Generate Tone
    q('#wav-btn-gen-tone').addEventListener('click', () => {
      const shape = q<HTMLSelectElement>('#wav-tone-shape').value as WaveShape;
      const startFreq = Number(q<HTMLInputElement>('#wav-tone-f1').value) || 440;
      const endFreq = Number(q<HTMLInputElement>('#wav-tone-f2').value) || 440;
      const durationSec = Number(q<HTMLInputElement>('#wav-tone-dur').value) || 0.3;
      const amplitude = (Number(q<HTMLInputElement>('#wav-tone-amp').value) || 65) / 100;
      const useAdsr = q<HTMLInputElement>('#wav-use-adsr').checked;

      const generated = generateToneSamples({
        shape,
        startFreq,
        endFreq,
        durationSec,
        amplitude,
        sampleRate: this.sampleRate,
        adsr: useAdsr ? this.getAdsrParams() : null,
      });
      this.applyGeneratedSamples(generated);
      this.playRange(0, this.samples.length);
    });

    // Arcade Tone Presets
    this.container.querySelectorAll('.wav-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-preset');
        const setTone = (shape: WaveShape, f1: number, f2: number, dur: number, a: number, d: number, s: number, r: number) => {
          q<HTMLSelectElement>('#wav-tone-shape').value = shape;
          q<HTMLInputElement>('#wav-tone-f1').value = String(f1);
          q('#wav-tone-f1-val').textContent = `${f1} Hz`;
          q<HTMLInputElement>('#wav-tone-f2').value = String(f2);
          q('#wav-tone-f2-val').textContent = `${f2} Hz`;
          q<HTMLInputElement>('#wav-tone-dur').value = String(dur);
          q('#wav-tone-dur-val').textContent = `${dur.toFixed(2)} s`;
          this.setAdsrSliders(a, d, s, r);
          q('#wav-btn-gen-tone').click();
        };

        if (preset === 'coin') setTone('square', 988, 1319, 0.25, 4, 40, 50, 120);
        else if (preset === 'jump') setTone('triangle', 220, 720, 0.25, 5, 50, 60, 80);
        else if (preset === 'laser') setTone('sawtooth', 1200, 160, 0.2, 2, 40, 35, 90);
        else if (preset === 'boom') setTone('noise', 120, 40, 0.45, 5, 130, 30, 240);
        else setTone('sine', 523, 523, 0.2, 8, 40, 65, 80);
      });
    });

    // Generate FM
    q('#wav-btn-gen-fm').addEventListener('click', () => {
      const carrierShape = q<HTMLSelectElement>('#wav-fm-cshape').value as WaveShape;
      const modShape = q<HTMLSelectElement>('#wav-fm-mshape').value as WaveShape;
      const carrierFreq = Number(q<HTMLInputElement>('#wav-fm-fc').value) || 440;
      const modFreq = Number(q<HTMLInputElement>('#wav-fm-fm').value) || 220;
      const modDepthHz = Number(q<HTMLInputElement>('#wav-fm-depth').value) || 180;
      const durationSec = Number(q<HTMLInputElement>('#wav-fm-dur').value) || 0.45;
      const useAdsr = q<HTMLInputElement>('#wav-use-adsr').checked;

      const generated = generateFmSamples({
        carrierFreq,
        modFreq,
        modDepthHz,
        carrierShape,
        modShape,
        durationSec,
        amplitude: 0.65,
        sampleRate: this.sampleRate,
        adsr: useAdsr ? this.getAdsrParams() : null,
      });
      this.applyGeneratedSamples(generated);
      this.playRange(0, this.samples.length);
    });

    // FM Presets
    this.container.querySelectorAll('.wav-fm-preset-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const preset = btn.getAttribute('data-fm');
        const setFm = (
          cShape: WaveShape,
          mShape: WaveShape,
          fc: number,
          fm: number,
          depth: number,
          dur: number,
          a: number,
          d: number,
          s: number,
          r: number
        ) => {
          q<HTMLSelectElement>('#wav-fm-cshape').value = cShape;
          q<HTMLSelectElement>('#wav-fm-mshape').value = mShape;
          q<HTMLInputElement>('#wav-fm-fc').value = String(fc);
          q('#wav-fm-fc-val').textContent = `${fc} Hz`;
          q<HTMLInputElement>('#wav-fm-fm').value = String(fm);
          q('#wav-fm-fm-val').textContent = `${fm} Hz`;
          q<HTMLInputElement>('#wav-fm-depth').value = String(depth);
          q('#wav-fm-depth-val').textContent = `${depth} Hz`;
          q<HTMLInputElement>('#wav-fm-dur').value = String(dur);
          q('#wav-fm-dur-val').textContent = `${dur.toFixed(2)} s`;
          this.setAdsrSliders(a, d, s, r);
          q('#wav-btn-gen-fm').click();
        };

        if (preset === 'bell') setFm('sine', 'sine', 660, 924, 420, 0.7, 3, 180, 20, 420);
        else if (preset === 'robot') setFm('square', 'sine', 240, 38, 120, 0.4, 8, 60, 75, 100);
        else if (preset === 'ufo') setFm('sine', 'triangle', 520, 9, 260, 0.85, 30, 80, 80, 180);
        else setFm('sawtooth', 'square', 480, 140, 680, 0.3, 2, 70, 30, 140);
      });
    });

    // Direct Apply Envelope button
    q('#wav-btn-apply-env').addEventListener('click', () => {
      const { start, end } = this.getSelectionRange();
      const slice = this.samples.slice(start, end);
      if (slice.length === 0) return;
      this.pushUndo();
      const shaped = applyAdsrEnvelope(slice, this.sampleRate, this.getAdsrParams());
      this.samples.set(shaped, start);
      this.renderAll();
      this.emitSave();
    });
  }

  private setAdsrSliders(a: number, d: number, s: number, r: number): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector(sel) as T;
    q<HTMLInputElement>('#wav-env-a').value = String(a);
    q('#wav-env-a-val').textContent = `${a}ms`;
    q<HTMLInputElement>('#wav-env-d').value = String(d);
    q('#wav-env-d-val').textContent = `${d}ms`;
    q<HTMLInputElement>('#wav-env-s').value = String(s);
    q('#wav-env-s-val').textContent = `${s}%`;
    q<HTMLInputElement>('#wav-env-r').value = String(r);
    q('#wav-env-r-val').textContent = `${r}ms`;
    this.renderEnvelopePreview();
  }

  private applyGeneratedSamples(generated: Float32Array): void {
    const mode = (this.container.querySelector('#wav-insert-mode') as HTMLSelectElement).value as InsertMode;
    const { start, end, hasSelection } = this.getSelectionRange();

    this.pushUndo();

    if (mode === 'replace') {
      if (hasSelection) {
        const next = new Float32Array(start + generated.length + (this.samples.length - end));
        next.set(this.samples.subarray(0, start), 0);
        next.set(generated, start);
        next.set(this.samples.subarray(end), start + generated.length);
        this.samples = next;
        this.selStart = start;
        this.selEnd = start + generated.length;
      } else {
        this.samples = generated;
        this.selStart = null;
        this.selEnd = null;
        this.cursorSample = 0;
      }
    } else if (mode === 'insert') {
      const at = hasSelection ? start : Math.min(this.cursorSample, this.samples.length);
      const next = new Float32Array(this.samples.length + generated.length);
      next.set(this.samples.subarray(0, at), 0);
      next.set(generated, at);
      next.set(this.samples.subarray(at), at + generated.length);
      this.samples = next;
      this.selStart = at;
      this.selEnd = at + generated.length;
    } else {
      // mix / layer starting at cursor or selection start
      const at = hasSelection ? start : Math.min(this.cursorSample, this.samples.length);
      const neededLen = Math.max(this.samples.length, at + generated.length);
      const next = new Float32Array(neededLen);
      next.set(this.samples, 0);
      for (let i = 0; i < generated.length; i++) {
        next[at + i] = Math.max(-1, Math.min(1, next[at + i] + generated[i]));
      }
      this.samples = next;
    }

    this.renderAll();
    this.emitSave();
  }

  private deleteRange(start: number, end: number): void {
    const nextLen = Math.max(1, this.samples.length - (end - start));
    const next = new Float32Array(nextLen);
    if (this.samples.length - (end - start) > 0) {
      next.set(this.samples.subarray(0, start), 0);
      next.set(this.samples.subarray(end), start);
    }
    this.samples = next;
    this.cursorSample = Math.min(start, this.samples.length);
    this.selStart = null;
    this.selEnd = null;
    this.renderAll();
    this.emitSave();
  }

  private playRange(startSample: number, endSample: number): void {
    this.stopPlayback();
    const s0 = Math.max(0, Math.min(this.samples.length - 1, startSample));
    const s1 = Math.max(s0 + 1, Math.min(this.samples.length, endSample));
    const slice = this.samples.subarray(s0, s1);
    if (slice.length === 0) return;

    if (!this.audioCtx) {
      this.audioCtx = new AudioContext();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    const buf = this.audioCtx.createBuffer(1, slice.length, this.sampleRate);
    buf.getChannelData(0).set(slice);

    const src = this.audioCtx.createBufferSource();
    src.buffer = buf;
    src.loop = this.playLoop;
    src.connect(this.audioCtx.destination);
    src.onended = () => {
      if (this.activeSource === src) {
        this.activeSource = null;
        if (this.playAnimId !== null) {
          cancelAnimationFrame(this.playAnimId);
          this.playAnimId = null;
        }
        this.renderWaveform();
      }
    };

    this.activeSource = src;
    this.playStartTime = this.audioCtx.currentTime;
    this.playOffsetSample = s0;
    this.playEndSample = s1;
    src.start();

    const tick = () => {
      if (!this.activeSource || !this.audioCtx) return;
      this.renderWaveform();
      this.playAnimId = requestAnimationFrame(tick);
    };
    this.playAnimId = requestAnimationFrame(tick);
  }

  public renderAll(): void {
    this.updateReadouts();
    this.renderWaveform();
    this.renderEnvelopePreview();
  }

  private updateReadouts(): void {
    const durSec = this.samples.length / this.sampleRate;
    const metaEl = this.container.querySelector('#wav-meta-badge');
    if (metaEl) {
      metaEl.textContent = `${durSec.toFixed(2)}s · ${this.sampleRate} Hz · 16-bit mono`;
    }

    const titleEl = this.container.querySelector('#wav-wave-title');
    if (titleEl) {
      titleEl.textContent = `🔊 ${this.filename} — Drag to mark, click to place cursor`;
    }

    const selEl = this.container.querySelector('#wav-sel-readout');
    if (selEl) {
      const { start, end, hasSelection } = this.getSelectionRange();
      const clipNote = this.clipboard ? ` | Clipboard: ${Math.round((this.clipboard.length / this.sampleRate) * 1000)}ms` : '';
      if (hasSelection) {
        const ms0 = Math.round((start / this.sampleRate) * 1000);
        const ms1 = Math.round((end / this.sampleRate) * 1000);
        selEl.textContent = `Mark: ${ms0}ms – ${ms1}ms (${ms1 - ms0}ms)${clipNote}`;
      } else {
        const ms = Math.round((this.cursorSample / this.sampleRate) * 1000);
        selEl.textContent = `Cursor: ${ms}ms${clipNote}`;
      }
    }
  }

  private renderWaveform(): void {
    const ctx = this.waveCtx;
    const W = this.waveCanvas.width;
    const H = this.waveCanvas.height;
    const midY = H / 2;

    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, W, H);

    // Subtle horizontal grid lines
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.12)';
    ctx.lineWidth = 1;
    for (const frac of [0.25, 0.5, 0.75]) {
      const y = Math.round(H * frac) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    // Time ticks
    const totalSec = this.samples.length / this.sampleRate;
    const stepSec = totalSec <= 0.5 ? 0.05 : totalSec <= 2 ? 0.25 : 0.5;
    ctx.fillStyle = '#64748b';
    ctx.font = '10px monospace';
    for (let t = 0; t <= totalSec + 0.0001; t += stepSec) {
      const x = Math.round((t / Math.max(0.001, totalSec)) * W) + 0.5;
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.1)';
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.fillText(`${t.toFixed(2)}s`, Math.min(W - 34, x + 3), 12);
    }

    // Marked selection highlight
    const { start, end, hasSelection } = this.getSelectionRange();
    if (hasSelection && this.samples.length > 0) {
      const x0 = (start / this.samples.length) * W;
      const x1 = (end / this.samples.length) * W;
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), H);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x0, 0);
      ctx.lineTo(x0, H);
      ctx.moveTo(x1, 0);
      ctx.lineTo(x1, H);
      ctx.stroke();
    }

    // Draw min/max waveform envelope per pixel column
    const len = this.samples.length;
    if (len > 0) {
      const samplesPerPx = len / W;
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.25;
      ctx.beginPath();

      for (let x = 0; x < W; x++) {
        const sStart = Math.floor(x * samplesPerPx);
        const sEnd = Math.min(len, Math.max(sStart + 1, Math.floor((x + 1) * samplesPerPx)));
        let min = 1;
        let max = -1;
        for (let i = sStart; i < sEnd; i++) {
          const v = this.samples[i];
          if (v < min) min = v;
          if (v > max) max = v;
        }
        const yTop = midY - max * (H * 0.44);
        const yBot = midY - min * (H * 0.44);
        ctx.moveTo(x + 0.5, yTop);
        ctx.lineTo(x + 0.5, Math.max(yTop + 1, yBot));
      }
      ctx.stroke();
    }

    // Cursor line
    if (!hasSelection && len > 0) {
      const cx = (this.cursorSample / len) * W;
      ctx.strokeStyle = '#facc15';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, 0);
      ctx.lineTo(cx, H);
      ctx.stroke();
    }

    // Live playhead line
    if (this.activeSource && this.audioCtx && len > 0) {
      const elapsed = this.audioCtx.currentTime - this.playStartTime;
      const span = Math.max(1, this.playEndSample - this.playOffsetSample);
      const rawOffset = elapsed * this.sampleRate;
      const playSample =
        this.playOffsetSample + (this.playLoop ? rawOffset % span : Math.min(span, rawOffset));
      const px = (playSample / len) * W;
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, H);
      ctx.stroke();
    }
  }

  private renderEnvelopePreview(): void {
    const ctx = this.envCtx;
    const W = this.envCanvas.width;
    const H = this.envCanvas.height;
    const adsr = this.getAdsrParams();

    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, W, H);

    const pad = 8;
    const innerW = W - pad * 2;
    const innerH = H - pad * 2;

    const aMs = Math.max(1, adsr.attackMs);
    const dMs = Math.max(1, adsr.decayMs);
    const sMs = 250; // fixed visual sustain width
    const rMs = Math.max(1, adsr.releaseMs);
    const total = aMs + dMs + sMs + rMs;

    const x0 = pad;
    const xA = x0 + (aMs / total) * innerW;
    const xD = xA + (dMs / total) * innerW;
    const xS = xD + (sMs / total) * innerW;
    const xR = pad + innerW;

    const yBot = H - pad;
    const yTop = pad;
    const ySus = yBot - adsr.sustainLevel * innerH;

    // Fill under curve
    ctx.fillStyle = 'rgba(168, 85, 247, 0.22)';
    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    ctx.lineTo(xA, yTop);
    ctx.lineTo(xD, ySus);
    ctx.lineTo(xS, ySus);
    ctx.lineTo(xR, yBot);
    ctx.closePath();
    ctx.fill();

    // Stroke curve
    ctx.strokeStyle = '#c084fc';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, yBot);
    ctx.lineTo(xA, yTop);
    ctx.lineTo(xD, ySus);
    ctx.lineTo(xS, ySus);
    ctx.lineTo(xR, yBot);
    ctx.stroke();
  }
}
