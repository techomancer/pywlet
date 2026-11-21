export type LLMBackendId = 'transformers-js' | 'chrome-prompt' | 'ollama-local';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMProgressEvent {
  status: 'idle' | 'downloading' | 'loading' | 'ready' | 'generating' | 'error';
  message: string;
  percent?: number;
}

export interface LLMDebugEvent {
  timestamp: string;
  stage:
    | 'gpu-probe'
    | 'model-load'
    | 'prompt-sent'
    | 'prefill'
    | 'token-stream'
    | 'generation-done'
    | 'error';
  detail: string;
  data?: {
    device?: 'webgpu' | 'wasm' | 'chrome-builtin' | 'local-http';
    adapterInfo?: string;
    webgpuAvailable?: boolean;
    promptPreview?: string;
    tokenCount?: number;
    tokensPerSec?: number;
    elapsedMs?: number;
    rawReply?: string;
  };
}

/**
 * Pluggable Local LLM Backend Interface.
 */
export interface LLMBackend {
  readonly id: LLMBackendId;
  readonly displayName: string;

  init(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ): Promise<void>;

  isReady(): boolean;

  streamResponse(
    messages: ChatMessage[],
    onToken: (tokenChunk: string) => void,
    onDebug?: (event: LLMDebugEvent) => void,
    signal?: AbortSignal
  ): Promise<string>;

  dispose(): Promise<void>;
}

export interface TutorCodeContext {
  activeFile: string;
  fullCode: string;
  selectedText?: string;
  cursorWord?: string;
  cursorLineNumber?: number;
  cursorLineText?: string;
  projectFiles: string[];
  activeError?: {
    line: number;
    title: string;
    friendlyExplanation: string;
    rawError?: string;
  };
}
