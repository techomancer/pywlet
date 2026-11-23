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

const DEFAULT_LOCAL_URL = 'http://localhost:11434';
const AUTO_DISCOVERY_URLS = ['http://localhost:11434', 'http://localhost:8080', 'http://localhost:1234'];

/**
 * Pluggable adapter for any OpenAI-compatible local server:
 * llama.cpp (`llama-server`), Strata, Ollama, LM Studio, vLLM, etc.
 */
export class OllamaLocalBackend implements LLMBackend {
  readonly id = 'ollama-local' as const;
  readonly displayName = 'Local Server (Ollama / llama.cpp / Strata)';

  private baseUrl: string;
  private apiKey = '';
  private model: string;
  private serverKind = 'Local Server';
  private ready = false;
  private customUrlExplicit = false;

  constructor(baseUrl = DEFAULT_LOCAL_URL, model = '') {
    this.baseUrl = normalizeServerBaseUrl(baseUrl);
    this.model = model;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  setBaseUrl(rawUrl: string, explicit = true): void {
    const next = normalizeServerBaseUrl(rawUrl);
    this.customUrlExplicit = explicit && next !== DEFAULT_LOCAL_URL;
    if (next !== this.baseUrl) {
      this.baseUrl = next;
      this.model = '';
      this.ready = false;
    }
  }

  setApiKey(key: string): void {
    const clean = key.trim();
    if (clean !== this.apiKey) {
      this.apiKey = clean;
      this.ready = false;
    }
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    if (!this.apiKey) return extra;
    return { ...extra, Authorization: `Bearer ${this.apiKey}` };
  }

  isReady(): boolean {
    return this.ready;
  }

  private async probeSingleBaseUrl(
    baseUrl: string,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<{ ok: boolean; model?: string; serverKind?: string; statusNote?: string }> {
    let lastNote = '';

    // 1. Try OpenAI-compatible /v1/models first (Strata, llama-server, Ollama, LM Studio, vLLM)
    try {
      const res = await fetch(`${baseUrl}/v1/models`, {
        headers: this.authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        const models: Array<{ id?: string; name?: string }> = Array.isArray(json?.data)
          ? json.data
          : Array.isArray(json?.models)
          ? json.models
          : [];
        const detected = models[0]?.id || models[0]?.name || '';
        return {
          ok: true,
          model: detected || this.model || 'local-model',
          serverKind: 'OpenAI-Compatible Server',
        };
      }
      lastNote = `/v1/models -> HTTP ${res.status}`;
      onDebug?.({
        timestamp: nowTime(),
        stage: 'model-load',
        detail: `Probe ${baseUrl}/v1/models returned HTTP ${res.status}`,
      });
    } catch (err: any) {
      lastNote = `/v1/models -> ${err?.message || 'network/CORS error'}`;
      onDebug?.({
        timestamp: nowTime(),
        stage: 'model-load',
        detail: `Probe ${baseUrl}/v1/models failed: ${err?.message || err}`,
      });
    }

    // 2. Try Ollama native /api/tags
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        headers: this.authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        const firstModel = json?.models?.[0]?.name || 'qwen2.5-coder:1.5b';
        return {
          ok: true,
          model: this.model || firstModel,
          serverKind: 'Ollama',
        };
      }
    } catch {
      // Fall through to /health
    }

    // 3. Try /health (llama.cpp / Strata)
    try {
      const res = await fetch(`${baseUrl}/health`, {
        headers: this.authHeaders(),
      });
      if (res.ok) {
        return {
          ok: true,
          model: this.model || 'local-model',
          serverKind: 'Local HTTP Server',
        };
      }
    } catch {
      // Fall through
    }

    return { ok: false, statusNote: lastNote };
  }

  async init(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<void> {
    const candidates = this.customUrlExplicit
      ? [this.baseUrl]
      : [this.baseUrl, ...AUTO_DISCOVERY_URLS.filter((u) => u !== this.baseUrl)];

    let lastStatusNote = '';
    for (const candidate of candidates) {
      onProgress?.({
        status: 'loading',
        message: `Connecting to ${candidate}...`,
      });
      const result = await this.probeSingleBaseUrl(candidate, onDebug);
      if (result.ok) {
        this.baseUrl = candidate;
        this.model = result.model || 'local-model';
        this.serverKind = result.serverKind || 'Local Server';
        this.ready = true;
        onDebug?.({
          timestamp: nowTime(),
          stage: 'model-load',
          detail: `Connected to ${this.baseUrl} — active model: ${this.model}`,
          data: {
            device: 'local-http',
            adapterInfo: `${this.serverKind} (${this.model})`,
          },
        });
        onProgress?.({
          status: 'ready',
          message: `Connected: ${this.model} @ ${this.baseUrl}`,
        });
        return;
      }
      if (candidate === this.baseUrl && result.statusNote) {
        lastStatusNote = result.statusNote;
      }
    }

    // Check if the configured server is actually reachable without CORS (gives a much clearer hint)
    let likelyCorsBlock = false;
    try {
      await fetch(`${this.baseUrl}/health`, { mode: 'no-cors' });
      likelyCorsBlock = true;
    } catch {
      // Could still be CORS under COEP, or server not running
    }

    const origin = typeof window !== 'undefined' ? window.location.origin : 'this page';
    const msg = likelyCorsBlock
      ? `Server is running at ${this.baseUrl}, but it blocked browser CORS from ${origin}! Allow "${origin}" in your server's CORS settings (e.g. "cors_origins": ["${origin}"] in Strata, or OLLAMA_ORIGINS=* in Ollama).`
      : `Could not reach local server at ${this.baseUrl} (${lastStatusNote || 'blocked or unreachable'}). Check the Server URL (e.g. http://localhost:8080/v1 for Strata/llama.cpp, :11434 for Ollama) and allow CORS for "${origin}" (in Strata: add "${origin}" to cors_origins).`;

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

    const basePayload = {
      model: this.model || 'local-model',
      messages,
      temperature: 0.35,
      max_tokens: 1024,
      stream: true,
    };

    const headers = this.authHeaders({ 'Content-Type': 'application/json' });

    let response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...basePayload,
        // Gently disable long chain-of-thought on Qwen3/3.8 llama-server when supported
        reasoning_format: 'deepseek',
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal,
    });

    // Some strict OpenAI-compatible servers (e.g. Strata, vLLM proxies) reject extra fields with 400/422.
    // Automatically retry with a pure standard OpenAI payload.
    if (response.status === 400 || response.status === 422) {
      onDebug?.({
        timestamp: nowTime(),
        stage: 'model-load',
        detail: `Server returned HTTP ${response.status} on extended options; retrying with standard OpenAI payload...`,
      });
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(basePayload),
        signal,
      });
    }

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
