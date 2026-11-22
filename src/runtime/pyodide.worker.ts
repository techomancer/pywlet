import { PYWLET_PYTHON_BOOTSTRAP } from './pyodide-bridge-script';

interface PyodideInstance {
  runPython: (code: string) => any;
  runPythonAsync: (code: string) => Promise<any>;
  setStdout: (opts: { batched: (msg: string) => void }) => void;
  setStderr: (opts: { batched: (msg: string) => void }) => void;
  setInterruptBuffer?: (buf: Int32Array | Uint8Array) => void;
  registerJsModule: (name: string, module: Record<string, any>) => void;
  FS: any;
  globals: any;
}

let pyodide: PyodideInstance | null = null;
let initPromise: Promise<void> | null = null;
let interruptBuf: Int32Array | null = null;
let inputBuf: Int32Array | null = null;
let waitBuf: Int32Array | null = null;

// Fallback non-SAB input state
const fallbackKeys = new Set<number>();
let fallbackMouseX = 0;
let fallbackMouseY = 0;
let fallbackMouseButtons = 0;
let fallbackStop = false;

// Queued Pygame events (KEYDOWN/KEYUP/MOUSEBUTTONDOWN)
const pendingEvents: Array<Record<string, any>> = [];
// Image dimensions table sent from main thread (path -> [w, h])
let imageSizes: Record<string, [number, number]> = {};

function checkStopSignal(): void {
  if (fallbackStop) {
    throw new Error('__PYWLET_STOPPED__');
  }
  if (inputBuf && Atomics.load(inputBuf, 3) !== 0) {
    throw new Error('__PYWLET_STOPPED__');
  }
  if (interruptBuf && Atomics.load(interruptBuf, 0) !== 0) {
    throw new Error('__PYWLET_STOPPED__');
  }
}

async function ensurePyodide(pyodideBaseUrl: string): Promise<PyodideInstance> {
  if (pyodide) return pyodide;
  if (!initPromise) {
    initPromise = (async () => {
      self.postMessage({ type: 'STATUS', status: 'loading' });
      const normalized = pyodideBaseUrl.endsWith('/') ? pyodideBaseUrl : `${pyodideBaseUrl}/`;
      const mod: any = await import(/* @vite-ignore */ `${normalized}pyodide.mjs`);
      const inst: PyodideInstance = await mod.loadPyodide({
        indexURL: normalized,
      });

      inst.setStdout({
        batched: (msg: string) => {
          self.postMessage({ type: 'STDOUT', line: msg });
        },
      });
      inst.setStderr({
        batched: (msg: string) => {
          self.postMessage({ type: 'STDERR', line: msg });
        },
      });

      if (interruptBuf && typeof inst.setInterruptBuffer === 'function') {
        inst.setInterruptBuffer(interruptBuf);
      }

      // Register JS host bridge consumed by PYWLET_PYTHON_BOOTSTRAP
      inst.registerJsModule('_pywlet_host', {
        flush_frame: (cmdsJson: string) => {
          self.postMessage({ type: 'FRAME', commandsJson: cmdsJson });
        },
        play_sound: (path: string, volume: number) => {
          self.postMessage({ type: 'SOUND', path, volume });
        },
        is_key_down: (keyCode: number) => {
          if (inputBuf && keyCode >= 0 && keyCode < 120) {
            return Atomics.load(inputBuf, 4 + keyCode) !== 0;
          }
          return fallbackKeys.has(keyCode);
        },
        get_mouse_pos: () => {
          if (inputBuf) {
            return [Atomics.load(inputBuf, 0), Atomics.load(inputBuf, 1)];
          }
          return [fallbackMouseX, fallbackMouseY];
        },
        get_mouse_buttons: () => {
          const bits = inputBuf ? Atomics.load(inputBuf, 2) : fallbackMouseButtons;
          return [Boolean(bits & 1), Boolean(bits & 2), Boolean(bits & 4)];
        },
        drain_events: () => {
          if (pendingEvents.length === 0) return '[]';
          const out = JSON.stringify(pendingEvents);
          pendingEvents.length = 0;
          return out;
        },
        get_image_size: (path: string) => {
          const clean = path.replace(/^\.?\//, '');
          const dims = imageSizes[clean] || imageSizes[path] || [32, 32];
          return JSON.stringify(dims);
        },
        check_stop: () => {
          checkStopSignal();
        },
        sleep_ms: (ms: number) => {
          checkStopSignal();
          const clamped = Math.max(1, Math.min(250, ms));
          if (waitBuf) {
            // Non-spinning 60 FPS sleep that wakes immediately on Stop!
            Atomics.wait(waitBuf, 0, 0, clamped);
            checkStopSignal();
          }
          // When SharedArrayBuffer is unavailable, `_pywlet_run_async_fallback`
          // yields cooperatively via `await asyncio.sleep(0.016)` so worker
          // postMessage events (keys, mouse, stop) are processed every frame!
        },
      });

      // Ensure /workspace directory exists on sys.path
      try {
        inst.FS.mkdir('/workspace');
      } catch {
        // Already exists
      }
      inst.runPython(`
import sys
if '/workspace' not in sys.path:
    sys.path.insert(0, '/workspace')
`);
      inst.runPython(PYWLET_PYTHON_BOOTSTRAP);
      pyodide = inst;
      self.postMessage({ type: 'READY' });
    })();
  }
  await initPromise;
  return pyodide!;
}

function mountWorkspacePythonFiles(inst: PyodideInstance, files: Record<string, string>): void {
  const FS = inst.FS;

  const ensureDir = (dirPath: string) => {
    const parts = dirPath.split('/').filter(Boolean);
    let cur = '';
    for (const p of parts) {
      cur += `/${p}`;
      try {
        FS.mkdir(cur);
      } catch {
        // Exists
      }
    }
  };

  // Clear previously cached workspace modules in sys.modules so edits reload cleanly
  const moduleNames: string[] = [];

  for (const [name, content] of Object.entries(files)) {
    if (!name.toLowerCase().endsWith('.py')) continue;
    const clean = name.replace(/^\/+/, '');
    const fullPath = `/workspace/${clean}`;
    const lastSlash = fullPath.lastIndexOf('/');
    if (lastSlash > 0) {
      ensureDir(fullPath.slice(0, lastSlash));
    }
    FS.writeFile(fullPath, content, { encoding: 'utf8' });

    const modName = clean.replace(/\.py$/i, '').replace(/\//g, '.');
    moduleNames.push(modName);
  }

  inst.globals.set('_pywlet_mod_names', moduleNames);
  inst.runPython(`
import importlib, sys
for _m in list(_pywlet_mod_names.to_py()):
    sys.modules.pop(_m, None)
importlib.invalidate_caches()
`);
}

function formatPythonTraceback(rawErr: string, filename: string): {
  raw: string;
  line: number;
  message: string;
} {
  const lines = rawErr.split('\n');
  // Find last frame belonging to the learner's file
  let bestLine = 1;
  const fileRegex = new RegExp(`File "(?:${filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}|<exec>|<string>)", line (\\d+)`);
  for (const l of lines) {
    const m = l.match(fileRegex);
    if (m) bestLine = Number(m[1]);
  }
  if (bestLine === 1) {
    const allLineMatches = [...rawErr.matchAll(/line (\d+)/gi)];
    if (allLineMatches.length > 0) {
      bestLine = Number(allLineMatches[allLineMatches.length - 1][1]);
    }
  }
  const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
  const summary = nonEmpty[nonEmpty.length - 1] || rawErr;
  return { raw: rawErr, line: bestLine, message: summary };
}

self.onmessage = async (event: MessageEvent) => {
  const msg = event.data;

  if (msg.type === 'INIT') {
    if (msg.interruptSab) interruptBuf = new Int32Array(msg.interruptSab);
    if (msg.inputSab) inputBuf = new Int32Array(msg.inputSab);
    if (msg.waitSab) waitBuf = new Int32Array(msg.waitSab);
    try {
      await ensurePyodide(msg.pyodideBaseUrl);
    } catch (err: any) {
      self.postMessage({
        type: 'INIT_ERROR',
        error: err?.message || String(err),
      });
    }
    return;
  }

  if (msg.type === 'EVENT') {
    pendingEvents.push(msg.event);
    if (pendingEvents.length > 64) pendingEvents.shift();
    return;
  }

  if (msg.type === 'FALLBACK_KEY') {
    if (msg.down) fallbackKeys.add(msg.keyCode);
    else fallbackKeys.delete(msg.keyCode);
    return;
  }

  if (msg.type === 'FALLBACK_MOUSE') {
    fallbackMouseX = msg.x;
    fallbackMouseY = msg.y;
    fallbackMouseButtons = msg.buttons;
    return;
  }

  if (msg.type === 'FALLBACK_CLEAR_KEYS') {
    fallbackKeys.clear();
    return;
  }

  if (msg.type === 'STOP') {
    fallbackStop = true;
    return;
  }

  if (msg.type === 'LINT') {
    const { requestId, code, filename, pyodideBaseUrl } = msg;
    try {
      const inst = await ensurePyodide(pyodideBaseUrl);
      inst.globals.set('_pywlet_lint_src', code);
      inst.globals.set('_pywlet_lint_file', filename || 'main.py');
      const jsonStr: string = inst.runPython('_pywlet_lint(_pywlet_lint_src, _pywlet_lint_file)');
      self.postMessage({
        type: 'LINT_RESULT',
        requestId,
        diagnostics: JSON.parse(jsonStr),
      });
    } catch (err: any) {
      self.postMessage({
        type: 'LINT_RESULT',
        requestId,
        diagnostics: [],
        error: err?.message || String(err),
      });
    }
    return;
  }

  if (msg.type === 'RUN') {
    const { code, filename, workspaceFiles, imgSizes, pyodideBaseUrl } = msg;
    fallbackStop = false;
    pendingEvents.length = 0;
    imageSizes = imgSizes || {};

    if (interruptBuf) Atomics.store(interruptBuf, 0, 0);
    if (inputBuf) Atomics.store(inputBuf, 3, 0);
    if (waitBuf) Atomics.store(waitBuf, 0, 0);

    try {
      const inst = await ensurePyodide(pyodideBaseUrl);
      mountWorkspacePythonFiles(inst, workspaceFiles || {});
      inst.runPython('_pywlet_reset_runtime_state()');

      // Run user script inside a clean isolated __main__ namespace
      inst.globals.set('_pywlet_run_code', code);
      inst.globals.set('_pywlet_run_file', filename || 'main.py');

      if (waitBuf && inputBuf) {
        // Fast path (SharedArrayBuffer available): run untouched synchronous CPython
        const execScript = `
_ns = {'__name__': '__main__', '__file__': _pywlet_run_file}
_compiled = compile(_pywlet_run_code, _pywlet_run_file, 'exec')
exec(_compiled, _ns, _ns)
`;
        inst.runPython(execScript);
      } else {
        // Non-SharedArrayBuffer path (e.g. plain HTTP LAN IP or pre-COI load):
        // yield cooperatively on every `while` frame so postMessage keys/mouse/stop work!
        await inst.runPythonAsync('await _pywlet_run_async_fallback(_pywlet_run_code, _pywlet_run_file)');
      }
      // Flush any trailing drawing commands from scripts without a game loop
      inst.runPython('import pygame; pygame.display.flip()');
      self.postMessage({ type: 'RUN_DONE' });
    } catch (err: any) {
      const raw = err?.message || String(err);
      if (raw.includes('__PYWLET_STOPPED__') || raw.includes('KeyboardInterrupt')) {
        self.postMessage({ type: 'RUN_DONE' });
        return;
      }
      const parsed = formatPythonTraceback(raw, filename || 'main.py');
      self.postMessage({
        type: 'RUN_ERROR',
        raw: parsed.raw,
        line: parsed.line,
        message: parsed.message,
      });
      self.postMessage({ type: 'RUN_DONE' });
    }
  }
};
