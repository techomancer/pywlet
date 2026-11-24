import {
  flattenSpriteLayers,
  type SpriteProjectData,
} from '../sprite-editor/sprite-data';
import type { PythonDiagnostic } from '../diagnostics/python-coach';
import {
  DEBUG_BP_BYTE_OFFSET,
  DEBUG_BP_MAX_BYTES,
  DEBUG_CMD_CONTINUE,
  DEBUG_CMD_EVAL,
  DEBUG_CMD_IDLE,
  DEBUG_CMD_PAUSE,
  DEBUG_CMD_SELECT_FRAME,
  DEBUG_CMD_STEP_INTO,
  DEBUG_CMD_STEP_OUT,
  DEBUG_CMD_STEP_OVER,
  DEBUG_CMD_STOP,
  DEBUG_EVAL_BYTE_OFFSET,
  DEBUG_EVAL_MAX_BYTES,
  DEBUG_SAB_BYTE_LENGTH,
  DEBUG_SLOT_BP_COUNT,
  DEBUG_SLOT_BP_JSON_LEN,
  DEBUG_SLOT_BP_VERSION,
  DEBUG_SLOT_CMD,
  DEBUG_SLOT_EVAL_LEN,
  DEBUG_SLOT_FRAME_IDX,
  DEBUG_SLOT_SEQ,
  type DebugEvalResult,
  type DebugPausePayload,
} from './debug-types';

export interface RuntimeCallbacks {
  onStdout: (line: string) => void;
  onStderr: (line: string, friendlyLine?: { line: number; message: string }) => void;
  onStatusChange: (status: 'ready' | 'running' | 'loading' | 'paused') => void;
  onPyodideReady?: () => void;
  onDebugPaused?: (payload: DebugPausePayload) => void;
  onDebugResumed?: () => void;
  onDebugEvalResult?: (result: DebugEvalResult) => void;
  getSpriteProjectData?: () => SpriteProjectData;
  getWorkspaceFile?: (filename: string) => string | null;
}

const KEY_CODE_TO_PYGAME: Record<string, number> = {
  ArrowLeft: 1,
  ArrowRight: 2,
  ArrowUp: 3,
  ArrowDown: 4,
  Space: 5,
  Enter: 6,
  Escape: 7,
  ShiftLeft: 8,
  ShiftRight: 9,
  Backspace: 10,
  Tab: 11,
};

const KEY_NAME_TO_PYGAME: Record<string, number> = {
  ArrowLeft: 1,
  Left: 1,
  ArrowRight: 2,
  Right: 2,
  ArrowUp: 3,
  Up: 3,
  ArrowDown: 4,
  Down: 4,
  ' ': 5,
  Spacebar: 5,
  Enter: 6,
  Escape: 7,
  Esc: 7,
  Shift: 8,
  Backspace: 10,
  Tab: 11,
};

for (let i = 0; i < 26; i++) {
  const ch = String.fromCharCode(65 + i);
  KEY_CODE_TO_PYGAME[`Key${ch}`] = 20 + i;
  KEY_NAME_TO_PYGAME[ch.toLowerCase()] = 20 + i;
  KEY_NAME_TO_PYGAME[ch] = 20 + i;
}
for (let i = 0; i < 10; i++) {
  KEY_CODE_TO_PYGAME[`Digit${i}`] = 50 + i;
  KEY_NAME_TO_PYGAME[String(i)] = 50 + i;
}

function resolvePygameKeyCode(e: KeyboardEvent): number | undefined {
  // Prefer e.key for Arrow keys so Windows Numpad arrows (NumLock OFF) also work!
  if (e.key && e.key in KEY_NAME_TO_PYGAME) {
    return KEY_NAME_TO_PYGAME[e.key];
  }
  return KEY_CODE_TO_PYGAME[e.code];
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('.monaco-editor'));
}

/**
 * Real CPython 3.14 (Pyodide WebAssembly) + HTML5 Canvas Pygame runtime & real-time AST linter.
 *
 * Runs Pyodide inside a dedicated Web Worker with self-hosted WASM/stdlib from `<base>pyodide/`,
 * SharedArrayBuffer key/mouse/interrupt synchronization (for true 60 FPS synchronous `while running:`
 * Pygame loops and instant Stop), and real CPython `ast.parse` live diagnostics.
 */
export class PythonPygameRuntime {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: RuntimeCallbacks;

  private worker: Worker | null = null;
  private pyodideReady = false;
  private running = false;
  private paused = false;
  private stopWatchdog: number | null = null;

  private interruptSab: SharedArrayBuffer | null = null;
  private interruptBuf: Int32Array | null = null;
  private inputSab: SharedArrayBuffer | null = null;
  private inputBuf: Int32Array | null = null;
  private waitSab: SharedArrayBuffer | null = null;
  private waitBuf: Int32Array | null = null;
  private debugSab: SharedArrayBuffer | null = null;
  private debugInt32: Int32Array | null = null;
  private debugBytes: Uint8Array | null = null;
  private utf8Encoder = new TextEncoder();
  private breakpointsByFile: Record<string, number[]> = {};

  private imageCache: Map<string, { src: string; img: HTMLImageElement }> = new Map();
  private lastSoundPlayAt: Map<string, number> = new Map();

  private lintSeq = 0;
  private pendingLints: Map<
    number,
    { resolve: (diags: PythonDiagnostic[]) => void; reject: (err: any) => void }
  > = new Map();

  constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas context not supported');
    this.ctx = ctx;
    this.callbacks = callbacks;

    this.initSharedBuffers();
    this.bindInputEvents();
  }

  private getPyodideBaseUrl(): string {
    const base = import.meta.env.BASE_URL || '/';
    return new URL(`${base}pyodide/`, window.location.origin).href;
  }

  private initSharedBuffers(): void {
    if (typeof SharedArrayBuffer !== 'undefined' && window.crossOriginIsolated) {
      this.interruptSab = new SharedArrayBuffer(4);
      this.interruptBuf = new Int32Array(this.interruptSab);
      this.inputSab = new SharedArrayBuffer(128 * 4);
      this.inputBuf = new Int32Array(this.inputSab);
      this.waitSab = new SharedArrayBuffer(4);
      this.waitBuf = new Int32Array(this.waitSab);
      this.debugSab = new SharedArrayBuffer(DEBUG_SAB_BYTE_LENGTH);
      this.debugInt32 = new Int32Array(this.debugSab, 0, 16);
      this.debugBytes = new Uint8Array(this.debugSab);
    }
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(new URL('./pyodide.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'STATUS' && msg.status === 'loading') {
        if (!this.running) {
          this.callbacks.onStatusChange('loading');
        }
        return;
      }

      if (msg.type === 'READY') {
        this.pyodideReady = true;
        if (!this.running) {
          this.callbacks.onStatusChange('ready');
        }
        this.callbacks.onPyodideReady?.();
        return;
      }

      if (msg.type === 'INIT_ERROR') {
        this.callbacks.onStderr(`Failed to initialize Python (Pyodide): ${msg.error}`);
        this.callbacks.onStatusChange('ready');
        return;
      }

      if (msg.type === 'STDOUT') {
        this.callbacks.onStdout(msg.line);
        return;
      }

      if (msg.type === 'STDERR') {
        this.callbacks.onStderr(msg.line);
        return;
      }

      if (msg.type === 'FRAME') {
        if (this.running) {
          try {
            const cmds = JSON.parse(msg.commandsJson);
            this.renderFrameCommands(cmds);
          } catch {
            // Ignore malformed batch
          }
        }
        return;
      }

      if (msg.type === 'SOUND') {
        if (this.running) {
          this.playWorkspaceSound(msg.path, msg.volume ?? 0.7);
        }
        return;
      }

      if (msg.type === 'RUN_ERROR') {
        this.callbacks.onStderr(msg.raw, {
          line: msg.line || 1,
          message: msg.message || msg.raw,
        });
        return;
      }

      if (msg.type === 'DEBUG_PAUSED') {
        if (this.running) {
          this.paused = true;
          this.callbacks.onStatusChange('paused');
          try {
            const payload = JSON.parse(msg.payloadJson) as DebugPausePayload;
            this.callbacks.onDebugPaused?.(payload);
          } catch {
            // Ignore malformed debug snapshot
          }
        }
        return;
      }

      if (msg.type === 'DEBUG_EVAL_RESULT') {
        try {
          const result = JSON.parse(msg.resultJson) as DebugEvalResult;
          this.callbacks.onDebugEvalResult?.(result);
        } catch {
          // Ignore malformed eval response
        }
        return;
      }

      if (msg.type === 'RUN_DONE') {
        this.clearStopWatchdog();
        this.running = false;
        this.paused = false;
        this.callbacks.onDebugResumed?.();
        this.callbacks.onStatusChange('ready');
        return;
      }

      if (msg.type === 'LINT_RESULT') {
        const pending = this.pendingLints.get(msg.requestId);
        if (pending) {
          this.pendingLints.delete(msg.requestId);
          pending.resolve(Array.isArray(msg.diagnostics) ? msg.diagnostics : []);
        }
      }
    };

    worker.onerror = (err) => {
      this.callbacks.onStderr(`Python worker error: ${err.message || String(err)}`);
      this.running = false;
      this.callbacks.onStatusChange('ready');
    };

    this.worker = worker;
    worker.postMessage({
      type: 'INIT',
      pyodideBaseUrl: this.getPyodideBaseUrl(),
      interruptSab: this.interruptSab,
      inputSab: this.inputSab,
      waitSab: this.waitSab,
      debugSab: this.debugSab,
    });
    this.syncBreakpointsToSab();

    return worker;
  }

  public preload(): void {
    this.ensureWorker();
  }

  public isPyodideReady(): boolean {
    return this.pyodideReady;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public isDebugSupported(): boolean {
    return Boolean(this.debugInt32);
  }

  private syncBreakpointsToSab(): void {
    if (!this.debugInt32 || !this.debugBytes) return;
    let count = 0;
    const cleaned: Record<string, number[]> = {};
    for (const [fname, lines] of Object.entries(this.breakpointsByFile)) {
      const uniq = Array.from(new Set(lines.filter((n) => Number.isFinite(n) && n > 0))).sort(
        (a, b) => a - b
      );
      if (uniq.length > 0) {
        cleaned[fname] = uniq;
        count += uniq.length;
      }
    }
    const encoded = this.utf8Encoder.encode(JSON.stringify(cleaned));
    const len = Math.min(encoded.length, DEBUG_BP_MAX_BYTES);
    this.debugBytes.set(encoded.subarray(0, len), DEBUG_BP_BYTE_OFFSET);
    Atomics.store(this.debugInt32, DEBUG_SLOT_BP_JSON_LEN, len);
    Atomics.store(this.debugInt32, DEBUG_SLOT_BP_COUNT, count);
    Atomics.add(this.debugInt32, DEBUG_SLOT_BP_VERSION, 1);
  }

  public setBreakpoints(breakpointsByFile: Record<string, number[]>): void {
    this.breakpointsByFile = {};
    for (const [k, v] of Object.entries(breakpointsByFile)) {
      this.breakpointsByFile[k] = [...v];
    }
    this.syncBreakpointsToSab();
  }

  private sendDebugCommand(cmd: number, resumeUi = true): void {
    if (!this.debugInt32) return;
    if (resumeUi && this.paused) {
      this.paused = false;
      this.callbacks.onStatusChange('running');
      this.callbacks.onDebugResumed?.();
    }
    Atomics.store(this.debugInt32, DEBUG_SLOT_CMD, cmd);
    Atomics.add(this.debugInt32, DEBUG_SLOT_SEQ, 1);
    Atomics.notify(this.debugInt32, DEBUG_SLOT_SEQ);
  }

  public pause(): void {
    if (!this.running || this.paused || !this.debugInt32) return;
    Atomics.store(this.debugInt32, DEBUG_SLOT_CMD, DEBUG_CMD_PAUSE);
    Atomics.add(this.debugInt32, DEBUG_SLOT_SEQ, 1);
    Atomics.notify(this.debugInt32, DEBUG_SLOT_SEQ);
    if (this.waitBuf) {
      Atomics.notify(this.waitBuf, 0);
    }
  }

  public continueDebug(): void {
    if (!this.running || !this.paused) return;
    this.sendDebugCommand(DEBUG_CMD_CONTINUE, true);
  }

  public stepOver(): void {
    if (!this.running || !this.paused) return;
    this.sendDebugCommand(DEBUG_CMD_STEP_OVER, true);
  }

  public stepInto(): void {
    if (!this.running || !this.paused) return;
    this.sendDebugCommand(DEBUG_CMD_STEP_INTO, true);
  }

  public stepOut(): void {
    if (!this.running || !this.paused) return;
    this.sendDebugCommand(DEBUG_CMD_STEP_OUT, true);
  }

  public selectDebugFrame(frameIndex: number): void {
    if (!this.running || !this.paused || !this.debugInt32) return;
    Atomics.store(this.debugInt32, DEBUG_SLOT_FRAME_IDX, Math.max(0, Math.floor(frameIndex)));
    this.sendDebugCommand(DEBUG_CMD_SELECT_FRAME, false);
  }

  public evaluateDebugExpression(expr: string): void {
    if (!this.running || !this.paused || !this.debugInt32 || !this.debugBytes) return;
    const clean = expr.trim();
    if (!clean) return;
    const encoded = this.utf8Encoder.encode(clean);
    const len = Math.min(encoded.length, DEBUG_EVAL_MAX_BYTES);
    this.debugBytes.set(encoded.subarray(0, len), DEBUG_EVAL_BYTE_OFFSET);
    Atomics.store(this.debugInt32, DEBUG_SLOT_EVAL_LEN, len);
    this.sendDebugCommand(DEBUG_CMD_EVAL, false);
  }

  private bindInputEvents(): void {
    // Use capture phase so game controls work reliably on Windows & Linux Chrome
    // without buttons/scrollbars swallowing Arrow keys or Space.
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.running) return;
        // Let the user keep typing in Monaco or Tutor chat if those are explicitly focused
        if (isEditableTarget(e.target) && document.activeElement !== this.canvas) {
          return;
        }
        const pgCode = resolvePygameKeyCode(e);
        if (pgCode !== undefined) {
          if (pgCode >= 1 && pgCode <= 5) {
            e.preventDefault();
          }
          if (this.inputBuf) {
            Atomics.store(this.inputBuf, 4 + pgCode, 1);
          } else {
            this.worker?.postMessage({ type: 'FALLBACK_KEY', keyCode: pgCode, down: true });
          }
          this.worker?.postMessage({ type: 'EVENT', event: { type: 768, key: pgCode } });
        }
      },
      true
    );

    window.addEventListener(
      'keyup',
      (e) => {
        const pgCode = resolvePygameKeyCode(e);
        if (pgCode !== undefined) {
          if (this.inputBuf) {
            Atomics.store(this.inputBuf, 4 + pgCode, 0);
          } else {
            this.worker?.postMessage({ type: 'FALLBACK_KEY', keyCode: pgCode, down: false });
          }
          if (this.running) {
            this.worker?.postMessage({ type: 'EVENT', event: { type: 769, key: pgCode } });
          }
        }
      },
      true
    );

    // Clear all held keys if the browser window loses focus so keys never get stuck
    window.addEventListener('blur', () => {
      if (this.inputBuf) {
        for (let i = 4; i < 128; i++) Atomics.store(this.inputBuf, i, 0);
      } else {
        this.worker?.postMessage({ type: 'FALLBACK_CLEAR_KEYS' });
      }
    });

    const updateMouse = (e: MouseEvent) => {
      const rect = this.canvas.getBoundingClientRect();
      const scaleX = this.canvas.width / Math.max(1, rect.width);
      const scaleY = this.canvas.height / Math.max(1, rect.height);
      const x = Math.round((e.clientX - rect.left) * scaleX);
      const y = Math.round((e.clientY - rect.top) * scaleY);
      if (this.inputBuf) {
        Atomics.store(this.inputBuf, 0, x);
        Atomics.store(this.inputBuf, 1, y);
        Atomics.store(this.inputBuf, 2, e.buttons);
      } else if (this.running) {
        this.worker?.postMessage({ type: 'FALLBACK_MOUSE', x, y, buttons: e.buttons });
      }
    };

    this.canvas.addEventListener('mousemove', updateMouse);
    this.canvas.addEventListener('mousedown', (e) => {
      this.canvas.focus();
      updateMouse(e);
      if (this.running) {
        const rect = this.canvas.getBoundingClientRect();
        const x = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * this.canvas.width);
        const y = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * this.canvas.height);
        this.worker?.postMessage({
          type: 'EVENT',
          event: { type: 1025, pos: [x, y], button: e.button + 1 },
        });
      }
    });
    this.canvas.addEventListener('mouseup', updateMouse);
  }

  private clearStopWatchdog(): void {
    if (this.stopWatchdog !== null) {
      window.clearTimeout(this.stopWatchdog);
      this.stopWatchdog = null;
    }
  }

  public stop(): void {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    this.callbacks.onDebugResumed?.();
    this.callbacks.onStatusChange('ready');

    if (this.inputBuf) {
      Atomics.store(this.inputBuf, 3, 1);
    }
    if (this.interruptBuf) {
      Atomics.store(this.interruptBuf, 0, 2); // SIGINT -> KeyboardInterrupt
    }
    if (this.waitBuf) {
      Atomics.store(this.waitBuf, 0, 1);
      Atomics.notify(this.waitBuf, 0);
    }
    if (this.debugInt32) {
      Atomics.store(this.debugInt32, DEBUG_SLOT_CMD, DEBUG_CMD_STOP);
      Atomics.add(this.debugInt32, DEBUG_SLOT_SEQ, 1);
      Atomics.notify(this.debugInt32, DEBUG_SLOT_SEQ);
    }
    this.worker?.postMessage({ type: 'STOP' });

    // If a runaway loop doesn't stop (or SharedArrayBuffer isn't available),
    // terminate & respawn a fresh worker so Stop ALWAYS works!
    this.clearStopWatchdog();
    this.stopWatchdog = window.setTimeout(() => {
      this.stopWatchdog = null;
      if (!this.running && this.worker) {
        this.respawnWorker();
      }
    }, 350);
  }

  private respawnWorker(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pyodideReady = false;
    for (const [, p] of this.pendingLints) {
      p.resolve([]);
    }
    this.pendingLints.clear();
    if (this.interruptBuf) Atomics.store(this.interruptBuf, 0, 0);
    if (this.inputBuf) Atomics.store(this.inputBuf, 3, 0);
    if (this.waitBuf) Atomics.store(this.waitBuf, 0, 0);
    this.ensureWorker();
  }

  /**
   * Runs real CPython 3.14 `ast.parse` + scope/undefined-name + Pygame AST linting
   * inside the Pyodide Web Worker.
   */
  public async lintCode(code: string, filename = 'main.py'): Promise<PythonDiagnostic[] | null> {
    if (this.running) {
      // Worker is busy executing a live 60 FPS game loop
      return null;
    }
    const worker = this.ensureWorker();
    const requestId = ++this.lintSeq;

    return new Promise((resolve) => {
      this.pendingLints.set(requestId, { resolve, reject: () => resolve([]) });
      worker.postMessage({
        type: 'LINT',
        requestId,
        code,
        filename,
        pyodideBaseUrl: this.getPyodideBaseUrl(),
      });
    });
  }

  /**
   * Pre-decodes workspace `.png` files so we can pass their real width/height
   * to `pygame.image.load(...)` inside the Python worker.
   */
  private async collectWorkspaceImageSizes(
    workspaceFiles: Record<string, string>
  ): Promise<Record<string, [number, number]>> {
    const sizes: Record<string, [number, number]> = {};
    const tasks: Promise<void>[] = [];

    for (const [name, content] of Object.entries(workspaceFiles)) {
      if (!name.toLowerCase().endsWith('.png') || !content.startsWith('data:image')) continue;
      const img = this.getOrLoadImage(name, content);
      if (img.complete && img.naturalWidth > 0) {
        sizes[name] = [img.naturalWidth, img.naturalHeight];
      } else {
        tasks.push(
          new Promise((resolve) => {
            img.onload = () => {
              sizes[name] = [img.naturalWidth || 32, img.naturalHeight || 32];
              resolve();
            };
            img.onerror = () => resolve();
          })
        );
      }
    }

    if (tasks.length > 0) {
      await Promise.all(tasks);
    }
    return sizes;
  }

  /**
   * Executes real Python/Pygame code inside Pyodide (optionally starting paused in step-debug mode).
   */
  public async runCode(
    code: string,
    filename = 'main.py',
    workspaceFiles: Record<string, string> = {},
    options: { debugMode?: boolean } = {}
  ): Promise<void> {
    if (this.running) {
      this.stop();
      // Give interrupted loop a moment to unwind before restarting
      await new Promise((r) => setTimeout(r, 60));
    }

    const worker = this.ensureWorker();
    this.clearStopWatchdog();

    // Reset shared key/stop flags
    if (this.interruptBuf) Atomics.store(this.interruptBuf, 0, 0);
    if (this.inputBuf) {
      for (let i = 3; i < 128; i++) Atomics.store(this.inputBuf, i, 0);
    }
    if (this.waitBuf) Atomics.store(this.waitBuf, 0, 0);
    if (this.debugInt32) {
      Atomics.store(this.debugInt32, DEBUG_SLOT_CMD, DEBUG_CMD_IDLE);
      this.syncBreakpointsToSab();
    }

    const imgSizes = await this.collectWorkspaceImageSizes(workspaceFiles);

    // Filter only `.py` files to mount into Pyodide VFS
    const pyFiles: Record<string, string> = {};
    for (const [name, content] of Object.entries(workspaceFiles)) {
      if (name.toLowerCase().endsWith('.py')) {
        pyFiles[name] = content;
      }
    }

    this.running = true;
    this.paused = false;
    this.callbacks.onStatusChange(this.pyodideReady ? 'running' : 'loading');
    // Move keyboard focus off Monaco / Run button onto the Game Stage canvas immediately
    if (!options.debugMode) {
      if (document.activeElement instanceof HTMLElement && document.activeElement !== this.canvas) {
        document.activeElement.blur();
      }
      this.canvas.focus();
    }

    worker.postMessage({
      type: 'RUN',
      code,
      filename,
      workspaceFiles: pyFiles,
      imgSizes,
      pyodideBaseUrl: this.getPyodideBaseUrl(),
      debugMode: Boolean(options.debugMode),
    });
  }

  // ===========================================================================
  // 2D CANVAS FRAME COMMAND RENDERER
  // ===========================================================================

  private toCssColor(color: any): string {
    if (typeof color === 'string') return color;
    if (Array.isArray(color)) {
      const r = Number(color[0]) || 0;
      const g = Number(color[1]) || 0;
      const b = Number(color[2]) || 0;
      const a = color.length >= 4 ? (Number(color[3]) ?? 255) / 255 : 1;
      return a < 1 ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`;
    }
    return '#ffffff';
  }

  private renderFrameCommands(commands: any[]): void {
    const ctx = this.ctx;

    for (const cmd of commands) {
      const op = cmd[0];
      if (op === 'resize') {
        const w = Math.max(100, Math.min(1200, Number(cmd[1]) || 400));
        const h = Math.max(100, Math.min(900, Number(cmd[2]) || 280));
        if (this.canvas.width !== w || this.canvas.height !== h) {
          this.canvas.width = w;
          this.canvas.height = h;
        }
      } else if (op === 'fill') {
        ctx.fillStyle = this.toCssColor(cmd[1]);
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      } else if (op === 'circle') {
        const [, color, cx, cy, radius, width] = cmd;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(0.5, radius), 0, Math.PI * 2);
        if (width && width > 0) {
          ctx.strokeStyle = this.toCssColor(color);
          ctx.lineWidth = width;
          ctx.stroke();
        } else {
          ctx.fillStyle = this.toCssColor(color);
          ctx.fill();
        }
      } else if (op === 'rect') {
        const [, color, x, y, w, h, width, borderRadius] = cmd;
        ctx.beginPath();
        if (borderRadius && borderRadius > 0 && typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, w, h, borderRadius);
        } else {
          ctx.rect(x, y, w, h);
        }
        if (width && width > 0) {
          ctx.strokeStyle = this.toCssColor(color);
          ctx.lineWidth = width;
          ctx.stroke();
        } else {
          ctx.fillStyle = this.toCssColor(color);
          ctx.fill();
        }
      } else if (op === 'line') {
        const [, color, x1, y1, x2, y2, width] = cmd;
        ctx.strokeStyle = this.toCssColor(color);
        ctx.lineWidth = Math.max(1, width || 1);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      } else if (op === 'lines' || op === 'polygon') {
        const [, color, points, width] = cmd;
        if (!Array.isArray(points) || points.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(points[0][0], points[0][1]);
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i][0], points[i][1]);
        }
        if (op === 'polygon') ctx.closePath();
        if (op === 'lines' || (width && width > 0)) {
          ctx.strokeStyle = this.toCssColor(color);
          ctx.lineWidth = Math.max(1, width || 1);
          ctx.stroke();
        } else {
          ctx.fillStyle = this.toCssColor(color);
          ctx.fill();
        }
      } else if (op === 'ellipse') {
        const [, color, x, y, w, h, width] = cmd;
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
        if (width && width > 0) {
          ctx.strokeStyle = this.toCssColor(color);
          ctx.lineWidth = width;
          ctx.stroke();
        } else {
          ctx.fillStyle = this.toCssColor(color);
          ctx.fill();
        }
      } else if (op === 'text') {
        const [, text, x, y, size, color, family] = cmd;
        ctx.font = `bold ${size || 18}px ${family || 'monospace'}, monospace`;
        ctx.fillStyle = this.toCssColor(color);
        ctx.textBaseline = 'top';
        ctx.fillText(String(text), x, y);
      } else if (op === 'image') {
        const [, path, x, y, w, h, flipX, flipY, angle] = cmd;
        const dataUrl = this.resolveWorkspaceAsset(path);
        if (dataUrl) {
          const img = this.getOrLoadImage(path, dataUrl);
          if (img.complete && img.naturalWidth > 0) {
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.translate(x + w / 2, y + h / 2);
            if (angle) ctx.rotate((-angle * Math.PI) / 180);
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
            ctx.drawImage(img, -w / 2, -h / 2, w, h);
            ctx.restore();
          }
        }
      } else if (op === 'sprite') {
        const [, spIdx, x, y, scale, sheetName] = cmd;
        this.renderProjectSprite(spIdx, x, y, scale, sheetName || undefined);
      } else if (op === 'tilemap') {
        const [, scale, mapName] = cmd;
        this.renderProjectTilemap(scale, mapName || undefined);
      }
    }
  }

  private resolveWorkspaceAsset(assetPath: string): string | null {
    const clean = assetPath.replace(/^\.?\//, '');
    return (
      this.callbacks.getWorkspaceFile?.(clean) ||
      this.callbacks.getWorkspaceFile?.(assetPath) ||
      null
    );
  }

  private getOrLoadImage(key: string, dataUrl: string): HTMLImageElement {
    const cached = this.imageCache.get(key);
    if (cached && cached.src === dataUrl) {
      return cached.img;
    }
    const img = new Image();
    img.src = dataUrl;
    this.imageCache.set(key, { src: dataUrl, img });
    return img;
  }

  private playWorkspaceSound(path: string, volume = 0.7): void {
    const dataUrl = this.resolveWorkspaceAsset(path);
    if (!dataUrl) return;
    const now = performance.now();
    const last = this.lastSoundPlayAt.get(path) || 0;
    if (now - last < 45) return;
    this.lastSoundPlayAt.set(path, now);
    try {
      const audio = new Audio(dataUrl);
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.play().catch(() => {});
    } catch {
      // Ignore autoplay restriction
    }
  }

  private renderProjectSprite(
    spriteIdx: number,
    destX: number,
    destY: number,
    scale: number,
    sheetName?: string
  ): void {
    const spriteData = this.callbacks.getSpriteProjectData?.();
    if (!spriteData) return;
    const sheet =
      (sheetName ? spriteData.sheets[sheetName] : undefined) ||
      spriteData.sheets[spriteData.activeSheetName] ||
      Object.values(spriteData.sheets)[0];
    if (!sheet) return;
    const sp = sheet.sprites[spriteIdx];
    if (!sp) return;
    const size = sheet.spriteSize;
    const flat = flattenSpriteLayers(sp, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const colorIdx = flat[y][x];
        if (colorIdx > 0 && spriteData.palette[colorIdx]) {
          this.ctx.fillStyle = spriteData.palette[colorIdx];
          this.ctx.fillRect(destX + x * scale, destY + y * scale, scale, scale);
        }
      }
    }
  }

  private renderProjectTilemap(scale: number, mapName?: string): void {
    const spriteData = this.callbacks.getSpriteProjectData?.();
    if (!spriteData) return;
    const map =
      (mapName ? spriteData.maps[mapName] : undefined) ||
      spriteData.maps[spriteData.activeMapName] ||
      Object.values(spriteData.maps)[0];
    if (!map) return;
    const sheet =
      spriteData.sheets[map.sheetName] ||
      spriteData.sheets[spriteData.activeSheetName] ||
      Object.values(spriteData.sheets)[0];
    if (!sheet) return;
    const tilePx = sheet.spriteSize * scale;

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const spIdx = map.tiles[r]?.[c] ?? -1;
        if (spIdx >= 0) {
          this.renderProjectSprite(spIdx, c * tilePx, r * tilePx, scale, sheet.name);
        }
      }
    }
  }
}
