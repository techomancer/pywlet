// Use relative path into node_modules/dist (3 levels up from src/llm/workers/)
// to bypass package.json `exports` while letting Vite bundle the WASM and MJS assets.
import ortWasmUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import ortMjsUrl from '../../../node_modules/@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs?url';
import { pipeline, TextStreamer, env } from '@huggingface/transformers';

// Disable local `/models/` path lookup so Vite's SPA fallback doesn't return `index.html`.
env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;

// Point ONNX Runtime directly to the Vite-resolved local `.wasm` and `.mjs` asset URLs
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: ortMjsUrl,
    wasm: ortWasmUrl,
  } as any;
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  // Multi-threaded WASM requires SharedArrayBuffer (COOP/COEP headers).
  // Static hosts like GitHub Pages cannot set custom COOP/COEP headers, so
  // fall back cleanly to single-threaded SIMD WASM when not cross-origin isolated.
  const canUseThreads = typeof self !== 'undefined' && Boolean((self as any).crossOriginIsolated);
  env.backends.onnx.wasm.numThreads = canUseThreads ? Math.min(4, Math.max(1, cores)) : 1;
}

// IMPORTANT: On Linux with integrated GPUs (like AMD Radeon Lucienne), Transformers.js sets
// `env.backends.onnx.webgpu.powerPreference = 'high-performance'` by default (onnx.js line 223).
// When Chrome looks for a discrete 'high-performance' GPU on a single-iGPU Linux laptop, it
// can fall back to `google / swiftshader` instead of the integrated AMD Radeon RADV driver!
// Removing `powerPreference` lets Chrome pick the default AMD Radeon Vulkan adapter.
if ((env.backends?.onnx as any)?.webgpu) {
  delete (env.backends.onnx as any).webgpu.powerPreference;
}

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function postDebug(stage: string, detail: string, data?: Record<string, any>): void {
  self.postMessage({
    type: 'DEBUG',
    payload: {
      timestamp: nowTime(),
      stage,
      detail,
      data,
    },
  });
}

async function purgePoisonedLocalCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open('transformers-cache');
    const keys = await cache.keys();
    for (const req of keys) {
      const isLocalPath =
        req.url.includes('/models/') && !req.url.includes('huggingface.co');
      if (isLocalPath) {
        await cache.delete(req);
        continue;
      }
      const res = await cache.match(req);
      const contentType = res?.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        await cache.delete(req);
      }
    }
  } catch {
    // Ignore cache inspection errors
  }
}

/**
 * Probes WebGPU adapter status inside the worker and detects whether the adapter
 * is real GPU hardware or Google's CPU-emulated SwiftShader / llvmpipe fallback.
 *
 * CRITICAL: Running WebGPU shaders on `google / swiftshader` (software Vulkan emulation)
 * is 30x-50x SLOWER than native multi-threaded SIMD WASM and makes 0.5B LLM generation
 * appear completely frozen! When SwiftShader is detected, we automatically switch to
 * native SIMD WASM and guide the user to enable real hardware GPU in `chrome://flags`.
 */
async function probeWebGPU(): Promise<{
  available: boolean;
  isSoftwareAdapter: boolean;
  adapterLabel: string;
  reason?: string;
}> {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  if (!nav || !('gpu' in nav)) {
    return {
      available: false,
      isSoftwareAdapter: false,
      adapterLabel: 'No navigator.gpu API',
      reason: 'WebGPU API not exposed by browser (enable via chrome://flags)',
    };
  }

  try {
    const inspectAdapter = async (ad: any, tag: string) => {
      if (!ad) return { ad: null, isSoft: false, label: `${tag}:null`, raw: null };
      const info =
        ad.info ||
        (typeof ad.requestAdapterInfo === 'function' ? await ad.requestAdapterInfo() : {});
      const raw = {
        vendor: info.vendor || '',
        architecture: info.architecture || '',
        device: info.device || '',
        description: info.description || '',
        isFallbackAdapter: Boolean(ad.isFallbackAdapter),
      };
      const parts = [raw.vendor, raw.architecture, raw.device, raw.description].filter(Boolean);
      const label = parts.length > 0 ? parts.join(' / ') : 'WebGPU Adapter';
      const lower = label.toLowerCase();
      const isSoft =
        raw.isFallbackAdapter ||
        lower.includes('swiftshader') ||
        lower.includes('llvmpipe') ||
        lower.includes('software') ||
        lower.includes('microsoft basic render');
      return { ad, isSoft, label, raw };
    };

    const defaultRes = await inspectAdapter(await nav.gpu.requestAdapter(), 'default');
    const highPerfRes = await inspectAdapter(
      await nav.gpu.requestAdapter({ powerPreference: 'high-performance' }),
      'high-perf'
    );
    const lowPowerRes = await inspectAdapter(
      await nav.gpu.requestAdapter({ powerPreference: 'low-power' }),
      'low-power'
    );

    postDebug(
      'gpu-probe',
      `Adapter dump -> default: ${JSON.stringify(defaultRes.raw)} | high-perf: ${JSON.stringify(
        highPerfRes.raw
      )} | low-power: ${JSON.stringify(lowPowerRes.raw)}`
    );

    // Pick the first non-software adapter among default, high-performance, low-power
    const hardwareCandidate = [defaultRes, highPerfRes, lowPowerRes].find(
      (r) => r.ad && !r.isSoft
    );

    if (hardwareCandidate) {
      return {
        available: true,
        isSoftwareAdapter: false,
        adapterLabel: hardwareCandidate.label,
      };
    }

    const firstAny = defaultRes.ad ? defaultRes : highPerfRes.ad ? highPerfRes : lowPowerRes;

    if (!firstAny.ad) {
      return {
        available: false,
        isSoftwareAdapter: false,
        adapterLabel: 'null WebGPU Adapter',
        reason:
          'navigator.gpu.requestAdapter() returned null for all preferences (check chrome://gpu for Vulkan status)',
      };
    }

    return {
      available: false,
      isSoftwareAdapter: true,
      adapterLabel: firstAny.label,
      reason: `Chrome returned software WebGPU (${firstAny.label}). Check the Adapter dump in the debug log above!`,
    };
  } catch (err: any) {
    return {
      available: false,
      isSoftwareAdapter: false,
      adapterLabel: 'WebGPU Error',
      reason: err?.message || String(err),
    };
  }
}

let generator: any = null;
let activeDevice: 'webgpu' | 'wasm' = 'wasm';
let activeAdapterLabel = 'CPU (SIMD WASM)';
let currentModelId = 'onnx-community/Qwen2.5-Coder-0.5B-Instruct';

self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;

  if (type === 'PROBE_GPU') {
    const gpu = await probeWebGPU();
    postDebug(
      'gpu-probe',
      gpu.available
        ? `Hardware WebGPU Ready: ${gpu.adapterLabel}`
        : gpu.isSoftwareAdapter
        ? `⚠️ Software WebGPU detected (${gpu.adapterLabel}) — auto-switching to fast SIMD WASM!`
        : `WebGPU Not Active (${gpu.reason}) — using SIMD WASM`,
      {
        device: gpu.available ? 'webgpu' : 'wasm',
        adapterInfo: gpu.available
          ? gpu.adapterLabel
          : gpu.isSoftwareAdapter
          ? `SIMD WASM (bypassed ${gpu.adapterLabel})`
          : 'SIMD WASM',
        webgpuAvailable: gpu.available,
      }
    );
    return;
  }

  if (type === 'INIT') {
    const requestedModel = payload?.modelId || currentModelId;
    currentModelId = requestedModel;
    const shortName = currentModelId.split('/').pop() || currentModelId;

    try {
      await purgePoisonedLocalCache();

      const gpu = await probeWebGPU();
      const threads = env.backends?.onnx?.wasm?.numThreads || 1;

      postDebug(
        'gpu-probe',
        gpu.available
          ? `Hardware WebGPU Adapter detected: ${gpu.adapterLabel}`
          : gpu.reason || `Using SIMD WASM (${threads} threads)`,
        {
          device: gpu.available ? 'webgpu' : 'wasm',
          adapterInfo: gpu.available
            ? gpu.adapterLabel
            : gpu.isSoftwareAdapter
            ? `SIMD WASM ${threads}T (bypassed SwiftShader)`
            : `SIMD WASM (${threads}T)`,
          webgpuAvailable: gpu.available,
        }
      );

      activeDevice = gpu.available ? 'webgpu' : 'wasm';
      activeAdapterLabel = gpu.available
        ? `WebGPU (${gpu.adapterLabel})`
        : `SIMD WASM (${threads} threads)`;

      self.postMessage({
        type: 'PROGRESS',
        payload: {
          status: 'loading',
          message: `Loading ${shortName} on ${activeAdapterLabel}...`,
        },
      });

      const loadStart = performance.now();

      try {
        generator = await pipeline('text-generation', currentModelId, {
          device: activeDevice,
          dtype: 'q4',
          progress_callback: (info: any) => {
            if (info.status === 'progress' && typeof info.progress === 'number') {
              self.postMessage({
                type: 'PROGRESS',
                payload: {
                  status: 'downloading',
                  message: `Caching ${info.file}: ${Math.round(info.progress)}%`,
                  percent: Math.round(info.progress),
                },
              });
            } else if (info.status === 'ready') {
              postDebug('model-load', `Pipeline ready on ${activeAdapterLabel}`);
            }
          },
        });
      } catch (webgpuErr: any) {
        if (activeDevice === 'webgpu') {
          postDebug(
            'model-load',
            `WebGPU pipeline init failed (${webgpuErr?.message || webgpuErr}); falling back to SIMD WASM...`,
            { device: 'wasm', webgpuAvailable: false }
          );
          activeDevice = 'wasm';
          activeAdapterLabel = `SIMD WASM (${threads} threads)`;

          generator = await pipeline('text-generation', currentModelId, {
            device: 'wasm',
            dtype: 'q4',
          });
        } else {
          throw webgpuErr;
        }
      }

      const loadMs = Math.round(performance.now() - loadStart);
      postDebug('model-load', `Loaded ${shortName} on ${activeAdapterLabel} in ${loadMs}ms`, {
        device: activeDevice,
        adapterInfo: activeAdapterLabel,
        webgpuAvailable: activeDevice === 'webgpu',
        elapsedMs: loadMs,
      });

      self.postMessage({
        type: 'READY',
        payload: {
          status: 'ready',
          message: `Ready: ${shortName} [${activeAdapterLabel}]`,
        },
      });
    } catch (err: any) {
      postDebug('error', `Model load failed: ${err?.message || String(err)}`);
      self.postMessage({
        type: 'ERROR',
        payload: {
          status: 'error',
          message: `Transformers.js load error: ${err?.message || String(err)}`,
        },
      });
    }
    return;
  }

  if (type === 'GENERATE') {
    if (!generator) {
      self.postMessage({
        type: 'GENERATE_ERROR',
        payload: 'Model is not initialized yet.',
      });
      return;
    }

    try {
      const { messages } = payload;
      const lastUser = [...messages].reverse().find((m: any) => m.role === 'user')?.content || '';

      postDebug(
        'prompt-sent',
        `Starting generation on ${activeAdapterLabel} (prompt length: ${lastUser.length} chars)`,
        {
          device: activeDevice,
          adapterInfo: activeAdapterLabel,
          promptPreview: lastUser,
        }
      );

      self.postMessage({
        type: 'PROGRESS',
        payload: {
          status: 'generating',
          message: `Prefilling prompt on ${activeAdapterLabel}...`,
        },
      });

      let fullText = '';
      let generatedTokenCount = 0;
      const genStart = performance.now();
      let firstTokenTime: number | null = null;

      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        token_callback_function: () => {
          generatedTokenCount++;
          const now = performance.now();
          if (firstTokenTime === null) {
            firstTokenTime = now;
            const prefillMs = Math.round(firstTokenTime - genStart);
            postDebug('prefill', `First token generated after ${prefillMs}ms prefill`, {
              device: activeDevice,
              elapsedMs: prefillMs,
              tokenCount: 1,
            });
          }
          const decodeSec = Math.max(0.05, (now - (firstTokenTime || genStart)) / 1000);
          const tps = Number((generatedTokenCount / decodeSec).toFixed(1));

          self.postMessage({
            type: 'PROGRESS',
            payload: {
              status: 'generating',
              message: `Streaming on ${activeAdapterLabel}: ${generatedTokenCount} tokens (${tps} tok/s)`,
            },
          });
        },
        callback_function: (tokenText: string) => {
          fullText += tokenText;
          self.postMessage({
            type: 'TOKEN',
            payload: tokenText,
          });
          postDebug('token-stream', `Chunk: ${JSON.stringify(tokenText)}`, {
            device: activeDevice,
            tokenCount: generatedTokenCount,
            rawReply: fullText,
          });
        },
      });

      const output = await generator(messages, {
        max_new_tokens: 110,
        do_sample: false,
        streamer,
      });

      if (!fullText && Array.isArray(output) && output[0]?.generated_text) {
        const gen = output[0].generated_text;
        if (Array.isArray(gen)) {
          const lastMsg = gen[gen.length - 1];
          fullText = lastMsg?.content || '';
        } else if (typeof gen === 'string') {
          fullText = gen;
        }
        if (fullText) {
          self.postMessage({ type: 'TOKEN', payload: fullText });
        }
      }

      const totalMs = Math.round(performance.now() - genStart);
      const avgTps = Number(((generatedTokenCount || 1) / Math.max(0.1, totalMs / 1000)).toFixed(1));

      postDebug(
        'generation-done',
        `Completed ${generatedTokenCount} tokens in ${totalMs}ms (${avgTps} tok/s) on ${activeAdapterLabel}`,
        {
          device: activeDevice,
          tokenCount: generatedTokenCount,
          tokensPerSec: avgTps,
          elapsedMs: totalMs,
          rawReply: fullText,
        }
      );

      self.postMessage({
        type: 'PROGRESS',
        payload: {
          status: 'ready',
          message: `Ready [${activeAdapterLabel}] — Last reply: ${generatedTokenCount} tokens (${avgTps} tok/s)`,
        },
      });

      self.postMessage({
        type: 'DONE',
        payload: fullText,
      });
    } catch (err: any) {
      postDebug('error', `Generation error: ${err?.message || String(err)}`);
      self.postMessage({
        type: 'GENERATE_ERROR',
        payload: err?.message || String(err),
      });
    }
  }
};
