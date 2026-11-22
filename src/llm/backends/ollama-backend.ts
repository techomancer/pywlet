import type { ChatMessage, LLMBackend, LLMDebugEvent, LLMProgressEvent } from '../types';

function nowTime(): string {
  return new Date().toLocaleTimeString();
}

function normalizeServerBaseUrl(raw: string): string {
  let base = raw.trim().replace(/\/+$/, '');
  if (!base) base = 'http://localhost:11434';
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
  // Strip accidental trailing /v1/chat/completions or /v1
  base = base.replace(/\/v1\/chat\/completions$/i, '').replace(/\/v1$/i, '');
  return base;
}

/**
 * Strips `<think>...</think>` blocks emitted by reasoning models (e.g. Qwen3/3.8)
 * so the 11-year-old only sees the clear tutor explanation (while raw reasoning stays in AI Debug).
 */
function stripThinkingTags(text: string): string {
  const closed = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const openIdx = closed.toLowerCase().indexOf('<think>');
  if (openIdx >= 0) {
    return closed.slice(0, openIdx).trimStart();
  }
  return closed.trimStart();
}

/**
 * Pluggable adapter for any OpenAI-compatible local server:
 * llama.cpp (`llama-server`), Ollama, LM Studio, vLLM, etc.
 */
export class OllamaLocalBackend implements LLMBackend {
  readonly id = 'ollama-local' as const;
  readonly displayName = 'Local Server (Ollama / llama.cpp)';

  private baseUrl: string;
  private model: string;
  private serverKind = 'Local Server';
  private ready = false;

  constructor(baseUrl = 'http://localhost:11434', model = '') {
    this.baseUrl = normalizeServerBaseUrl(baseUrl);
    this.model = model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(rawUrl: string): void {
    const next = normalizeServerBaseUrl(rawUrl);
    if (next !== this.baseUrl) {
      this.baseUrl = next;
      this.model = '';
      this.ready = false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async init(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<void> {
    onProgress?.({
      status: 'loading',
      message: `Connecting to ${this.baseUrl}...`,
    });

    // 1. Try OpenAI-compatible /v1/models first (works on llama-server, Ollama, LM Studio, vLLM)
    try {
      const res = await fetch(`${this.baseUrl}/v1/models`);
      if (res.ok) {
        const json = await res.json();
        const models: Array<{ id?: string }> = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.models)
          ? json.models
          : [];
        const detected = models[0]?.id || (models[0] as any)?.name || '';
        if (detected) {
          this.model = detected;
        } else if (!this.model) {
          this.model = 'local-model';
        }
        this.serverKind = 'llama.cpp / OpenAI Server';
        this.ready = true;
        onDebug?.({
          timestamp: nowTime(),
          stage: 'model-load',
          detail: `Connected to ${this.baseUrl}/v1/models — active model: ${this.model}`,
          data: {
            device: 'local-http',
            adapterInfo: `Local HTTP (${this.model})`,
          },
        });
        onProgress?.({
          status: 'ready',
          message: `Connected: ${this.model} @ ${this.baseUrl}`,
        });
        return;
      }
    } catch {
      // Fall through to /health and /api/tags probes
    }

    // 2. Try Ollama native /api/tags
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      if (res.ok) {
        const json = await res.json();
        const firstModel = json?.models?.[0]?.name || 'qwen2.5-coder:1.5b';
        this.model = this.model || firstModel;
        this.serverKind = 'Ollama';
        this.ready = true;
        onDebug?.({
          timestamp: nowTime(),
          stage: 'model-load',
          detail: `Connected to Ollama at ${this.baseUrl} — model: ${this.model}`,
          data: {
            device: 'local-http',
            adapterInfo: `Ollama (${this.model})`,
          },
        });
        onProgress?.({
          status: 'ready',
          message: `Connected to Ollama (${this.model})`,
        });
        return;
      }
    } catch {
      // Fall through to /health
    }

    // 3. Try llama.cpp /health
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      if (res.ok) {
        this.model = this.model || 'local-model';
        this.serverKind = 'llama.cpp';
        this.ready = true;
        onProgress?.({
          status: 'ready',
          message: `Connected to ${this.serverKind} @ ${this.baseUrl}`,
        });
        return;
      }
    } catch {
      // All probes failed
    }

    const msg = `Could not reach local server at ${this.baseUrl} (tried /v1/models, /api/tags, /health). Check the URL in ⚙️ AI Setup and ensure CORS is enabled.`;
    onProgress?.({ status: 'error', message: msg });
    onDebug?.({ timestamp: nowTime(), stage: 'error', detail: msg });
    throw new Error(msg);
  }

  async streamResponse(
    messages: ChatMessage[],
    onToken: (tokenChunk: string) => void,
    onDebug?: (event: LLMDebugEvent) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.ready) {
      await this.init(undefined, onDebug);
    }

    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
    const startMs = performance.now();

    onDebug?.({
      timestamp: nowTime(),
      stage: 'prompt-sent',
      detail: `Streaming from ${endpoint} (model: ${this.model})`,
      data: {
        device: 'local-http',
        adapterInfo: `${this.serverKind} (${this.model})`,
        promptPreview: lastUser,
      },
    });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model || 'local-model',
        messages,
        temperature: 0.35,
        max_tokens: 1024,
        stream: true,
        // Gently disable long chain-of-thought on Qwen3/3.8 llama-server when supported
        reasoning_format: 'deepseek',
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(`Local server returned HTTP ${response.status}${errBody ? `: ${errBody.slice(0, 140)}` : ''}`);
    }

    const contentType = response.headers.get('content-type') || '';

    // Non-streaming JSON fallback if server ignored stream: true
    if (!contentType.includes('text/event-stream') || !response.body) {
      const data = await response.json();
      const rawContent: string = data.choices?.[0]?.message?.content || '';
      const clean = stripThinkingTags(rawContent);
      if (clean) onToken(clean);
      return clean;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let rawContent = '';
    let rawReasoning = '';
    let emittedLen = 0;
    let tokenChunks = 0;
    let firstTokenMs: number | null = null;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || !line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;

        try {
          const parsed = JSON.parse(payload);
          const delta = parsed.choices?.[0]?.delta;
          if (!delta) continue;

          if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
            rawReasoning += delta.reasoning_content;
            onDebug?.({
              timestamp: nowTime(),
              stage: 'token-stream',
              detail: 'Reasoning stream',
              data: {
                device: 'local-http',
                rawReply: `[thinking]\n${rawReasoning}\n\n[answer]\n${rawContent}`,
              },
            });
          }

          if (typeof delta.content === 'string' && delta.content) {
            tokenChunks++;
            if (firstTokenMs === null) {
              firstTokenMs = Math.round(performance.now() - startMs);
              onDebug?.({
                timestamp: nowTime(),
                stage: 'prefill',
                detail: `First token in ${firstTokenMs}ms`,
                data: { device: 'local-http', elapsedMs: firstTokenMs },
              });
            }
            rawContent += delta.content;
            const visible = stripThinkingTags(rawContent);
            if (visible.length > emittedLen) {
              const newSlice = visible.slice(emittedLen);
              emittedLen = visible.length;
              onToken(newSlice);
            }
            onDebug?.({
              timestamp: nowTime(),
              stage: 'token-stream',
              detail: 'Token chunk',
              data: {
                device: 'local-http',
                tokenCount: tokenChunks,
                rawReply: rawReasoning
                  ? `[thinking]\n${rawReasoning}\n\n[answer]\n${rawContent}`
                  : rawContent,
              },
            });
          }
        } catch {
          // Ignore partial/malformed SSE line
        }
      }
    }

    const totalMs = Math.round(performance.now() - startMs);
    const tps = Number(((tokenChunks || 1) / Math.max(0.1, totalMs / 1000)).toFixed(1));
    onDebug?.({
      timestamp: nowTime(),
      stage: 'generation-done',
      detail: `Completed ${tokenChunks} chunks in ${totalMs}ms (${tps} tok/s) via ${this.model}`,
      data: {
        device: 'local-http',
        tokenCount: tokenChunks,
        tokensPerSec: tps,
        elapsedMs: totalMs,
      },
    });

    return stripThinkingTags(rawContent);
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }
}
