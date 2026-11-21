import type { ChatMessage, LLMBackend, LLMDebugEvent, LLMProgressEvent } from '../types';

export class TransformersJsBackend implements LLMBackend {
  readonly id = 'transformers-js' as const;
  readonly displayName = 'Transformers.js (Qwen2.5 Local)';

  private worker: Worker | null = null;
  private ready = false;
  private modelId: string;
  private debugListener?: (event: LLMDebugEvent) => void;
  private progressListener?: (event: LLMProgressEvent) => void;

  constructor(modelId = 'onnx-community/Qwen2.5-Coder-0.5B-Instruct') {
    this.modelId = modelId;
  }

  isReady(): boolean {
    return this.ready;
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('../workers/transformers.worker.ts', import.meta.url),
        { type: 'module' }
      );
      this.worker.addEventListener('message', (event: MessageEvent) => {
        const { type, payload } = event.data;
        if (type === 'DEBUG') {
          this.debugListener?.(payload);
        } else if (type === 'PROGRESS') {
          this.progressListener?.(payload);
        }
      });
    }
    return this.worker;
  }

  async probeGPU(onDebug?: (event: LLMDebugEvent) => void): Promise<void> {
    if (onDebug) this.debugListener = onDebug;
    const worker = this.ensureWorker();
    worker.postMessage({ type: 'PROBE_GPU' });
  }

  async init(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<void> {
    if (onProgress) this.progressListener = onProgress;
    if (onDebug) this.debugListener = onDebug;

    if (this.ready && this.worker) {
      onProgress?.({ status: 'ready', message: `${this.displayName} Ready` });
      return;
    }

    const worker = this.ensureWorker();

    return new Promise<void>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const { type, payload } = event.data;
        if (type === 'READY') {
          this.ready = true;
          onProgress?.(payload);
          worker.removeEventListener('message', handler);
          resolve();
        } else if (type === 'ERROR') {
          this.ready = false;
          onProgress?.(payload);
          worker.removeEventListener('message', handler);
          reject(new Error(payload.message));
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({
        type: 'INIT',
        payload: { modelId: this.modelId },
      });
    });
  }

  async streamResponse(
    messages: ChatMessage[],
    onToken: (tokenChunk: string) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<string> {
    if (onDebug) this.debugListener = onDebug;

    if (!this.ready || !this.worker) {
      await this.init(this.progressListener, this.debugListener);
    }

    const worker = this.ensureWorker();

    return new Promise<string>((resolve, reject) => {
      const handler = (event: MessageEvent) => {
        const { type, payload } = event.data;
        if (type === 'TOKEN') {
          onToken(payload);
        } else if (type === 'DONE') {
          worker.removeEventListener('message', handler);
          resolve(payload);
        } else if (type === 'GENERATE_ERROR') {
          worker.removeEventListener('message', handler);
          reject(new Error(payload));
        }
      };

      worker.addEventListener('message', handler);
      worker.postMessage({
        type: 'GENERATE',
        payload: { messages },
      });
    });
  }

  async dispose(): Promise<void> {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.ready = false;
  }
}
