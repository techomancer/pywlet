import type { ChatMessage, LLMBackend, LLMDebugEvent, LLMProgressEvent } from '../types';

/**
 * Pluggable adapter for a local Ollama or llama.cpp server running on localhost.
 */
export class OllamaLocalBackend implements LLMBackend {
  readonly id = 'ollama-local' as const;
  readonly displayName = 'Local Server (Ollama / llama.cpp)';

  private endpoint: string;
  private model: string;
  private ready = false;

  constructor(endpoint = 'http://localhost:11434/v1/chat/completions', model = 'qwen2.5-coder:1.5b') {
    this.endpoint = endpoint;
    this.model = model;
  }

  isReady(): boolean {
    return this.ready;
  }

  async init(onProgress?: (event: LLMProgressEvent) => void): Promise<void> {
    onProgress?.({
      status: 'loading',
      message: `Checking local server at ${this.endpoint}...`,
    });

    try {
      const res = await fetch('http://localhost:11434/api/tags');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      this.ready = true;
      onProgress?.({
        status: 'ready',
        message: `Connected to local Ollama (${this.model})`,
      });
    } catch {
      const msg = 'No local Ollama server detected at localhost:11434. Use Transformers.js for in-browser AI.';
      onProgress?.({ status: 'error', message: msg });
      throw new Error(msg);
    }
  }

  async streamResponse(
    messages: ChatMessage[],
    onToken: (tokenChunk: string) => void,
    onDebug?: (event: LLMDebugEvent) => void,
    signal?: AbortSignal
  ): Promise<string> {
    onDebug?.({
      timestamp: new Date().toLocaleTimeString(),
      stage: 'prompt-sent',
      detail: `Sending request to ${this.endpoint}`,
    });
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: 0.4,
        max_tokens: 200,
      }),
      signal,
    });

    if (!response.ok) {
      throw new Error(`Local server returned ${response.status}`);
    }

    const data = await response.json();
    const content: string = data.choices?.[0]?.message?.content || '';
    onToken(content);
    return content;
  }

  async dispose(): Promise<void> {
    this.ready = false;
  }
}
