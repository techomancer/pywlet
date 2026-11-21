import type { ChatMessage, TutorCodeContext } from './types';

export const PYWLET_SYSTEM_PROMPT = `You are Pywlet 🦉, a friendly Python and Pygame tutor for an 11-year-old.
RULES:
1. NEVER write solution code or multi-line \`\`\`python code blocks.
2. Answer in 2 to 3 short, friendly sentences and end with a guiding question.
3. Only use tiny 1-line generic examples like \`pygame.draw.circle(screen, color, (x, y), radius)\`.`;

/**
 * Builds a compact, fast-to-prefill contextual prompt around the student's cursor.
 * Keeping the prompt around ~120-200 tokens makes local 0.5B/1.5B models on WebGPU/WASM
 * respond in <1-2 seconds instead of spending 20+ seconds prefilling the entire file.
 */
export function buildSocraticMessages(
  userQuestion: string,
  ctx: TutorCodeContext,
  chatHistory: ChatMessage[] = []
): ChatMessage[] {
  const contextParts: string[] = [`File: ${ctx.activeFile}`];

  if (ctx.cursorLineNumber && ctx.cursorLineText !== undefined) {
    contextParts.push(`Cursor Line ${ctx.cursorLineNumber}: \`${ctx.cursorLineText.trim()}\``);
  }
  if (ctx.selectedText) {
    contextParts.push(`Selected: \`${ctx.selectedText.trim()}\``);
  } else if (ctx.cursorWord) {
    contextParts.push(`Keyword: \`${ctx.cursorWord}\``);
  }
  if (ctx.activeError) {
    contextParts.push(
      `Notice on Line ${ctx.activeError.line}: ${ctx.activeError.title} (${ctx.activeError.friendlyExplanation})`
    );
  }

  // Send a focused 11-line window around the cursor (or error line) so prefill is near-instant
  const allLines = ctx.fullCode.split('\n');
  const centerLine = (ctx.activeError?.line || ctx.cursorLineNumber || 1) - 1;
  const startIdx = Math.max(0, centerLine - 5);
  const endIdx = Math.min(allLines.length, centerLine + 6);

  const snippetLines = allLines
    .slice(startIdx, endIdx)
    .map((line, idx) => `${startIdx + idx + 1}: ${line}`)
    .join('\n');

  const userPrompt = `${contextParts.join(' | ')}
Code snippet around line ${centerLine + 1}:
${snippetLines}

Student asks: ${userQuestion}
(Explain simply in 2-3 sentences for an 11-year-old. Do NOT write solution code blocks.)`;

  return [
    { role: 'system', content: PYWLET_SYSTEM_PROMPT },
    ...chatHistory.slice(-2),
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Post-processing & streaming guardrail that strips multi-line fenced code blocks
 * if a small local model tries to generate solution code despite the system prompt.
 */
export function enforceNoCodeGenerationGuardrail(rawText: string): string {
  return rawText.replace(/```[\s\S]*?```/g, (block) => {
    const inner = block.replace(/```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
    const lines = inner.split('\n').filter((l) => l.trim().length > 0);
    if (lines.length === 1 && lines[0].length < 55) {
      return `\`${lines[0].trim()}\``;
    }
    return `*(🦉 Spoiler hidden! Try typing this part in the editor yourself — ask me if you want a hint on the next line!)*`;
  });
}
