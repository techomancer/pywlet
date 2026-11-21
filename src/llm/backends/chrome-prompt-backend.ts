import type { ChatMessage, LLMBackend, LLMDebugEvent, LLMProgressEvent } from '../types';
import { PYWLET_SYSTEM_PROMPT } from '../guardrail';

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/**
 * Pluggable adapter for Chrome's built-in Prompt API (Gemini Nano).
 * Emits detailed diagnostics to the AI Debug Panel so we can see the exact API object,
 * `availability()` / `capabilities()` state, download progress, and streaming tokens.
 */
export class ChromePromptBackend implements LLMBackend {
  readonly id = 'chrome-prompt' as const;
  readonly displayName = 'Chrome Prompt API (Gemini Nano)';

  private session: any = null;
  private debugListener?: (event: LLMDebugEvent) => void;

  isReady(): boolean {
    return this.session !== null;
  }

  private emitDebug(
    stage: LLMDebugEvent['stage'],
    detail: string,
    data?: LLMDebugEvent['data']
  ): void {
    this.debugListener?.({
      timestamp: nowTime(),
      stage,
      detail,
      data,
    });
  }

  private getApiFactory(): { factory: any; apiName: string } | null {
    const win = globalThis as any;
    if (win.LanguageModel) return { factory: win.LanguageModel, apiName: 'self.LanguageModel' };
    if (win.ai?.languageModel)
      return { factory: win.ai.languageModel, apiName: 'window.ai.languageModel' };
    if (win.ai?.assistant) return { factory: win.ai.assistant, apiName: 'window.ai.assistant' };
    return null;
  }

  async init(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<void> {
    if (onDebug) this.debugListener = onDebug;

    const detected = this.getApiFactory();
    if (!detected) {
      const msg =
        'Chrome Prompt API object (LanguageModel / window.ai) not found. Enable chrome://flags/#prompt-api-for-gemini-nano and chrome://flags/#optimization-guide-on-device-model ("Enabled BypassPerfRequirement").';
      this.emitDebug('error', msg);
      onProgress?.({ status: 'error', message: msg });
      throw new Error(msg);
    }

    const { factory, apiName } = detected;
    this.emitDebug('model-load', `Detected Chrome Prompt API: ${apiName}`, {
      device: 'chrome-builtin',
      adapterInfo: `Gemini Nano (${apiName})`,
      webgpuAvailable: true,
    });

    onProgress?.({
      status: 'loading',
      message: `Checking ${apiName} availability...`,
    });

    let availStatus = 'unknown';

    // Chrome 134+ LanguageModel.availability() takes options (e.g. expectedInputs/Outputs or empty object)
    if (typeof factory.availability === 'function') {
      try {
        availStatus = await withTimeout(
          factory.availability(),
          5000,
          'LanguageModel.availability() timed out after 5s'
        );
      } catch (err: any) {
        this.emitDebug('error', `${apiName}.availability() threw: ${err?.message || err}`);
      }
      this.emitDebug('model-load', `${apiName}.availability() returned: "${availStatus}"`);

      if (availStatus === 'unavailable' || availStatus === 'no') {
        const msg = `Chrome Gemini Nano status is "${availStatus}". Make sure chrome://flags/#optimization-guide-on-device-model is set to "Enabled BypassPerfRequirement", then check chrome://components for "Optimization Guide On Device Model".`;
        this.emitDebug('error', msg);
        onProgress?.({ status: 'error', message: msg });
        throw new Error(msg);
      }
    } else if (typeof factory.capabilities === 'function') {
      try {
        const caps = await withTimeout<any>(
          factory.capabilities(),
          5000,
          'capabilities() timed out after 5s'
        );
        availStatus = caps?.available || 'unknown';
        this.emitDebug(
          'model-load',
          `${apiName}.capabilities() returned: ${JSON.stringify(caps)}`
        );
      } catch (err: any) {
        this.emitDebug('error', `${apiName}.capabilities() threw: ${err?.message || err}`);
      }
    }

    // If Chrome reports 'downloadable' or 'after-download' or 'downloading', Chrome is downloading
    // the ~1.7GB Gemini Nano weights in the background when create() is called!
    const isDownloadingWeights =
      availStatus === 'downloadable' ||
      availStatus === 'after-download' ||
      availStatus === 'downloading';

    const createTimeoutMs = isDownloadingWeights ? 120000 : 20000;

    onProgress?.({
      status: isDownloadingWeights ? 'downloading' : 'loading',
      message: isDownloadingWeights
        ? `Chrome Gemini Nano status is "${availStatus}" — Chrome is downloading/extracting the on-device model (check chrome://on-device-internals or chrome://components)...`
        : `Creating ${apiName} session...`,
    });

    this.emitDebug(
      'model-load',
      `Calling ${apiName}.create() (status="${availStatus}", timeout=${createTimeoutMs / 1000}s)...`
    );

    const createStart = performance.now();

    const createSession = async () => {
      const monitorOption = {
        monitor: (m: any) => {
          m?.addEventListener?.('downloadprogress', (e: any) => {
            const loaded = e.loaded || 0;
            const total = e.total || 1;
            const pct = e.total ? Math.round((loaded / total) * 100) : Math.round(loaded * 100);
            const msg = `Chrome downloading Gemini Nano weights: ${pct}% (${loaded}/${total})`;
            this.emitDebug('model-load', msg);
            onProgress?.({
              status: 'downloading',
              message: msg,
              percent: pct,
            });
          });
        },
      };

      // 1. Try minimal create({ monitor }) first — in several Chrome Linux builds, passing
      // `initialPrompts` or `systemPrompt` before the base weights are warmed up causes create() to hang or reject.
      try {
        this.emitDebug('model-load', `Attempt 1: ${apiName}.create({ monitor })`);
        return await factory.create(monitorOption);
      } catch (e1: any) {
        this.emitDebug(
          'model-load',
          `Attempt 1 failed (${e1?.message || e1}), trying ${apiName}.create() with no args...`
        );
        return await factory.create();
      }
    };

    try {
      this.session = await withTimeout(
        createSession(),
        createTimeoutMs,
        `Chrome ${apiName}.create() timed out after ${
          createTimeoutMs / 1000
        }s (availability was "${availStatus}"). Open chrome://on-device-internals and chrome://components ("Optimization Guide On Device Model") to check if Chrome is still downloading the 1.7GB Gemini Nano weights!`
      );
    } catch (err: any) {
      this.emitDebug('error', `Session creation failed: ${err?.message || err}`);
      onProgress?.({ status: 'error', message: err?.message || String(err) });
      throw err;
    }

    const elapsed = Math.round(performance.now() - createStart);
    this.emitDebug('model-load', `Gemini Nano session created in ${elapsed}ms`, {
      device: 'chrome-builtin',
      adapterInfo: `Gemini Nano (${apiName})`,
      elapsedMs: elapsed,
    });

    onProgress?.({ status: 'ready', message: 'Chrome Gemini Nano Ready (Built-in)' });
  }

  async streamResponse(
    messages: ChatMessage[],
    onToken: (tokenChunk: string) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<string> {
    if (onDebug) this.debugListener = onDebug;

    if (!this.session) {
      await this.init(undefined, onDebug);
    }

    const lastUserMessage =
      [...messages].reverse().find((m) => m.role === 'user')?.content || '';

    const fullPrompt = `${PYWLET_SYSTEM_PROMPT}\n\n${lastUserMessage}`;

    this.emitDebug(
      'prompt-sent',
      `Sending prompt to Chrome Gemini Nano (${fullPrompt.length} chars)`,
      {
        device: 'chrome-builtin',
        adapterInfo: 'Chrome Gemini Nano',
        promptPreview: fullPrompt,
      }
    );

    const genStart = performance.now();
    let firstTokenTime: number | null = null;
    let chunkCount = 0;

    // Try streaming first so we get immediate token feedback in the AI Debug panel
    if (typeof this.session.promptStreaming === 'function') {
      try {
        const stream = this.session.promptStreaming(fullPrompt);
        let previousLength = 0;
        let fullText = '';

        const processIncomingChunk = (rawChunk: string) => {
          chunkCount++;
          const now = performance.now();
          if (firstTokenTime === null) {
            firstTokenTime = now;
            this.emitDebug(
              'prefill',
              `First token from Gemini Nano after ${Math.round(now - genStart)}ms`,
              {
                device: 'chrome-builtin',
                elapsedMs: Math.round(now - genStart),
                tokenCount: 1,
              }
            );
          }

          // Chrome's promptStreaming yields cumulative strings in older Chrome and delta chunks in newer Chrome
          const delta = rawChunk.startsWith(fullText)
            ? rawChunk.slice(previousLength)
            : rawChunk;
          fullText = rawChunk.startsWith(fullText) ? rawChunk : fullText + rawChunk;
          previousLength = fullText.length;

          if (delta) {
            onToken(delta);
            const elapsedSec = Math.max(0.05, (now - (firstTokenTime || genStart)) / 1000);
            const tps = Number((chunkCount / elapsedSec).toFixed(1));
            this.emitDebug('token-stream', `Chunk: ${JSON.stringify(delta)}`, {
              device: 'chrome-builtin',
              tokenCount: chunkCount,
              tokensPerSec: tps,
              rawReply: fullText,
            });
          }
        };

        if (typeof stream?.getReader === 'function') {
          const reader = stream.getReader();
          try {
            while (true) {
              const { done, value } = await withTimeout<any>(
                reader.read(),
                30000,
                'Gemini Nano stream reader timed out waiting for token (30s)'
              );
              if (done) break;
              processIncomingChunk(String(value || ''));
            }
          } finally {
            reader.releaseLock();
          }
        } else {
          for await (const chunk of stream) {
            processIncomingChunk(String(chunk || ''));
          }
        }

        const totalMs = Math.round(performance.now() - genStart);
        this.emitDebug(
          'generation-done',
          `Gemini Nano completed ${chunkCount} chunks in ${totalMs}ms`,
          {
            device: 'chrome-builtin',
            tokenCount: chunkCount,
            elapsedMs: totalMs,
            rawReply: fullText,
          }
        );
        return fullText;
      } catch (streamErr: any) {
        this.emitDebug(
          'error',
          `promptStreaming failed (${streamErr?.message || streamErr}); falling back to session.prompt()...`
        );
      }
    }

    if (typeof this.session.prompt === 'function') {
      const fullText: string = await withTimeout(
        this.session.prompt(fullPrompt),
        45000,
        'Chrome Gemini Nano session.prompt() timed out after 45s. Check chrome://on-device-internals to verify model state.'
      );
      const totalMs = Math.round(performance.now() - genStart);
      onToken(fullText);
      this.emitDebug('token-stream', `Full response received`, {
        device: 'chrome-builtin',
        tokenCount: fullText.split(/\s+/).length,
        elapsedMs: totalMs,
        rawReply: fullText,
      });
      this.emitDebug('generation-done', `Gemini Nano completed in ${totalMs}ms`, {
        device: 'chrome-builtin',
        elapsedMs: totalMs,
        rawReply: fullText,
      });
      return fullText;
    }

    throw new Error('Chrome Gemini Nano session does not support promptStreaming() or prompt().');
  }

  async dispose(): Promise<void> {
    if (this.session && typeof this.session.destroy === 'function') {
      this.session.destroy();
    }
    this.session = null;
  }
}
