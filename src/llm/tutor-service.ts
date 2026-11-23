import type {
  ChatMessage,
  LLMBackend,
  LLMBackendId,
  LLMDebugEvent,
  LLMProgressEvent,
  TutorCodeContext,
} from './types';
import { TransformersJsBackend } from './backends/transformers-backend';
import { ChromePromptBackend } from './backends/chrome-prompt-backend';
import { OllamaLocalBackend } from './backends/ollama-backend';
import { buildSocraticMessages, enforceNoCodeGenerationGuardrail } from './guardrail';

const INSTANT_CONCEPT_CARDS: Record<string, string> = {
  import:
    '`import` brings a toolbox into your program! For example, `import pygame` unlocks all the game-making tools for drawing, sounds, and keyboard controls.',
  pygame:
    '`pygame` is our game-making library! It knows how to open a game window, draw shapes and sprites, play sounds, and check which keys you press.',
  def: '`def` defines a reusable recipe (called a **function**). Give it a name, a list of inputs in `()`, and don\'t forget the colon `:` at the end!',
  while:
    'A `while` loop repeats the indented block of code over and over as long as its condition stays `True`. In Pygame, `while running:` is our main game heartbeat!',
  for: 'A `for` loop steps through each item in a list or range one by one—like checking every event in `pygame.event.get()`.',
  if: 'An `if` statement asks a True/False question. Remember: use `==` (two equals signs) when comparing two values!',
  elif: '`elif` means "else if"—it lets you check a second question only when the first `if` was False.',
  else: '`else:` runs when none of the `if` or `elif` questions above it were True.',
  flip: '`pygame.display.flip()` flips the freshly drawn frame onto the screen—like flipping to the next page of a flipbook! Without it, your drawings stay hidden backstage.',
  fill: '`screen.fill((R, G, B))` paints the whole game window with a background color. Tip: Always call `screen.fill` *before* drawing your player, or you\'ll paint right over them!',
  rect: '`pygame.draw.rect(screen, color, (x, y, width, height))` draws a rectangle! Remember `(x, y)` is the top-left corner.',
  circle:
    '`pygame.draw.circle(screen, color, (center_x, center_y), radius)` draws a circle centered at `(center_x, center_y)`.',
  Clock:
    '`pygame.time.Clock()` helps control your game speed so it runs at a steady 60 frames per second (`clock.tick(60)`) on any computer.',
};

export class TutorService {
  private backends: Map<LLMBackendId, LLMBackend> = new Map();
  private currentBackend: LLMBackend;
  private transformersBackend: TransformersJsBackend;
  private ollamaBackend: OllamaLocalBackend;
  private chatHistory: ChatMessage[] = [];
  private onProgress?: (event: LLMProgressEvent) => void;
  private onDebug?: (event: LLMDebugEvent) => void;

  constructor(
    onProgress?: (event: LLMProgressEvent) => void,
    onDebug?: (event: LLMDebugEvent) => void
  ) {
    this.onProgress = onProgress;
    this.onDebug = onDebug;

    this.transformersBackend = new TransformersJsBackend('onnx-community/Qwen2.5-Coder-1.5B-Instruct');
    const chromePrompt = new ChromePromptBackend();
    this.ollamaBackend = new OllamaLocalBackend();

    this.backends.set(this.transformersBackend.id, this.transformersBackend);
    this.backends.set(chromePrompt.id, chromePrompt);
    this.backends.set(this.ollamaBackend.id, this.ollamaBackend);

    this.currentBackend = this.transformersBackend;
  }

  probeGPU(): void {
    this.transformersBackend.probeGPU(this.onDebug);
  }

  setLocalServerUrl(url: string): void {
    this.ollamaBackend.setBaseUrl(url);
  }

  setLocalServerApiKey(key: string): void {
    this.ollamaBackend.setApiKey(key);
  }

  getLocalServerUrl(): string {
    return this.ollamaBackend.getBaseUrl();
  }

  getActiveBackend(): LLMBackend {
    return this.currentBackend;
  }

  async setBackend(id: LLMBackendId): Promise<void> {
    const next = this.backends.get(id);
    if (!next) throw new Error(`Unknown LLM backend: ${id}`);
    if (this.currentBackend.id !== id) {
      await this.currentBackend.dispose();
      this.currentBackend = next;
    }
    this.onProgress?.({
      status: 'idle',
      message: `Switched to ${this.currentBackend.displayName}. Click "⚡ Load AI" or ask a question to initialize.`,
    });
  }

  async initActiveBackend(): Promise<void> {
    await this.currentBackend.init(this.onProgress, this.onDebug);
  }

  getInstantKeywordHint(word?: string): string | null {
    if (!word) return null;
    const clean = word.trim().replace(/[^a-zA-Z_]/g, '');
    return INSTANT_CONCEPT_CARDS[clean] || null;
  }

  async askSocratic(
    question: string,
    ctx: TutorCodeContext,
    onUpdate: (displayMarkdown: string) => void
  ): Promise<string> {
    const instantHint = this.getInstantKeywordHint(ctx.cursorWord || ctx.selectedText);
    const instantPrefix = ctx.activeError
      ? `💡 **Quick Look at Line ${ctx.activeError.line}:** ${ctx.activeError.friendlyExplanation}\n\n`
      : instantHint
      ? `💡 **Quick Concept (${ctx.cursorWord || ctx.selectedText}):** ${instantHint}\n\n`
      : '';

    if (!this.currentBackend.isReady()) {
      onUpdate(`${instantPrefix}⏳ *Initializing ${this.currentBackend.displayName}...*`);

      try {
        await this.currentBackend.init(this.onProgress, this.onDebug);
      } catch (initErr: any) {
        const fallbackMsg = `${instantPrefix}⚠️ **Local AI Notice:** ${
          initErr?.message || String(initErr)
        }`;
        onUpdate(fallbackMsg);
        return fallbackMsg;
      }
    }

    onUpdate(
      `${instantPrefix}🧠 *${this.currentBackend.displayName} is reading your snippet (see 🔍 AI Debug below for live tokens & GPU status)...*`
    );

    const messages = buildSocraticMessages(question, ctx, this.chatHistory);
    let accumulated = '';

    try {
      await this.currentBackend.streamResponse(
        messages,
        (chunk) => {
          accumulated += chunk;
          const guarded = enforceNoCodeGenerationGuardrail(accumulated);
          onUpdate(instantPrefix ? `${instantPrefix}🦉 **AI Tutor:**\n${guarded}` : guarded);
        },
        this.onDebug
      );

      const safeReply = enforceNoCodeGenerationGuardrail(accumulated);
      const finalOutput = instantPrefix
        ? `${instantPrefix}🦉 **AI Tutor:**\n${safeReply}`
        : safeReply;
      onUpdate(finalOutput);

      this.chatHistory.push({ role: 'user', content: question });
      this.chatHistory.push({ role: 'assistant', content: safeReply });
      return finalOutput;
    } catch (err: any) {
      const fallback = `${instantPrefix}⚠️ **AI Error (${this.currentBackend.displayName}):** ${
        err?.message || String(err)
      }`;
      onUpdate(fallback);
      return fallback;
    }
  }
}
