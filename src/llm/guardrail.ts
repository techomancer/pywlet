import type { ChatMessage, TutorCodeContext } from './types';

export const PYWLET_SYSTEM_PROMPT = `You are Pywlet 🦉, a friendly, accurate Python 3 and Pygame tutor for an 11-year-old.
STRICT RULES:
1. TRUST THE VERIFIED PYTHON DIAGNOSTIC: When a "VERIFIED PYTHON DIAGNOSTIC" with a caret (^) pointer is provided, that exact line, column, and reason is 100% ground truth from Python 3.14. NEVER contradict it or invent a different bug (like spacing, tuples, or IDE bugs).
2. Explain simply WHY that exact Python rule works that way in 2 to 3 short, encouraging sentences, and end with 1 guiding question so the learner can fix it themselves.
3. NEVER write corrected solution code, NEVER say "Here's how to correct the code:", and NEVER output \`\`\` code blocks. Tiny inline mentions of a single keyword or symbol like \`:\` or \`==\` are fine.`;

function formatCodeWithErrorPointer(ctx: TutorCodeContext): {
  snippet: string;
  errorLineText: string;
  offendingToken: string;
} {
  const allLines = ctx.fullCode.split('\n');
  const errLine = ctx.activeError?.line;
  const centerLineIdx = (errLine || ctx.cursorLineNumber || 1) - 1;

  // CRITICAL for small local models (0.5B/1.5B):
  // When explaining a specific syntax/linter error, send ONLY the broken line and
  // 1 line above it for block context. Sending unrelated lines (like `set_mode`)
  // causes small 4-bit models to lock onto and hallucinate bugs in those other lines!
  const startIdx = errLine
    ? Math.max(0, centerLineIdx - 1)
    : allLines.length <= 40
    ? 0
    : Math.max(0, centerLineIdx - 8);
  const endIdx = errLine
    ? Math.min(allLines.length, centerLineIdx + 1)
    : allLines.length <= 40
    ? allLines.length
    : Math.min(allLines.length, centerLineIdx + 9);

  const errorLineText = errLine && errLine >= 1 && errLine <= allLines.length ? allLines[errLine - 1] : '';
  let offendingToken = '';
  if (ctx.activeError && errorLineText && ctx.activeError.column) {
    const startCol = Math.max(0, ctx.activeError.column - 1);
    const endCol = Math.max(startCol + 1, (ctx.activeError.endColumn || ctx.activeError.column + 1) - 1);
    offendingToken = errorLineText.slice(startCol, endCol);
  }

  const out: string[] = [];
  for (let i = startIdx; i < endIdx; i++) {
    const lineNum = i + 1;
    const prefix = `${String(lineNum).padStart(2, ' ')}: `;
    out.push(`${prefix}${allLines[i]}`);

    if (errLine && lineNum === errLine && ctx.activeError) {
      const col = Math.max(1, ctx.activeError.column || 1);
      const span = Math.max(1, (ctx.activeError.endColumn || col + 1) - col);
      const caretIndent = ' '.repeat(prefix.length + col - 1);
      const carets = '^'.repeat(Math.min(span, 20));
      out.push(`${caretIndent}${carets}  <-- ERROR HERE (line ${lineNum}, col ${col}): ${ctx.activeError.title}`);
    }
  }

  return {
    snippet: out.join('\n'),
    errorLineText,
    offendingToken,
  };
}

/**
 * Builds a grounded, high-signal Socratic prompt with full surrounding code,
 * exact caret pointer (`^`) at the Python 3.14 diagnostic location, and recent console output.
 */
export function buildSocraticMessages(
  userQuestion: string,
  ctx: TutorCodeContext,
  chatHistory: ChatMessage[] = []
): ChatMessage[] {
  const { snippet, errorLineText, offendingToken } = formatCodeWithErrorPointer(ctx);
  const sections: string[] = [`File: ${ctx.activeFile} | Workspace files: ${ctx.projectFiles.join(', ')}`];

  if (ctx.activeError) {
    const loc = ctx.activeError.column
      ? `Line ${ctx.activeError.line}, Column ${ctx.activeError.column}`
      : `Line ${ctx.activeError.line}`;
    const tokenInfo = offendingToken ? ` | Exact offending token: ${JSON.stringify(offendingToken)}` : '';
    sections.push(
      [
        '=== VERIFIED PYTHON 3.14 DIAGNOSTIC (GROUND TRUTH — DO NOT CONTRADICT) ===',
        `Location: ${loc}${tokenInfo}`,
        `Broken line: ${errorLineText}`,
        `Issue: ${ctx.activeError.title}`,
        `Verified explanation: ${ctx.activeError.friendlyExplanation}`,
        ctx.activeError.rawError ? `Raw Python traceback: ${ctx.activeError.rawError}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    );

    if (ctx.allDiagnostics && ctx.allDiagnostics.length > 1) {
      const others = ctx.allDiagnostics
        .slice(1, 4)
        .map((d) => `- Line ${d.line}, Col ${d.column}: ${d.title}`)
        .join('\n');
      sections.push(`Other diagnostics in file:\n${others}`);
    }
  } else {
    if (ctx.cursorLineNumber && ctx.cursorLineText !== undefined) {
      sections.push(`Cursor at Line ${ctx.cursorLineNumber}: \`${ctx.cursorLineText.trim()}\``);
    }
    if (ctx.selectedText) {
      sections.push(`Highlighted code: \`${ctx.selectedText.trim()}\``);
    } else if (ctx.cursorWord) {
      sections.push(`Word under cursor: \`${ctx.cursorWord}\``);
    }
  }

  sections.push(`Code:\n${snippet}`);

  if (!ctx.activeError && ctx.recentConsole && ctx.recentConsole.trim()) {
    sections.push(`Recent console output:\n${ctx.recentConsole.trim()}`);
  }

  const guidance = ctx.activeError
    ? 'Explain ONLY why the verified Python diagnostic above happened (referencing the exact line and token shown by the ^ pointer), give a gentle hint on how the learner can fix it themselves, and ask 1 short guiding question. Do NOT contradict the diagnostic and do NOT write code blocks.'
    : 'Explain simply in 2-3 friendly sentences for an 11-year-old and end with 1 guiding question. Do NOT write solution code blocks.';

  const userPrompt = `${sections.join('\n\n')}\n\nStudent asks: ${userQuestion}\n(${guidance})`;

  // Avoid leaking stale error turns into a fresh diagnostic explanation
  const recentHistory = ctx.activeError ? [] : chatHistory.slice(-2);

  return [
    { role: 'system', content: PYWLET_SYSTEM_PROMPT },
    ...recentHistory,
    { role: 'user', content: userPrompt },
  ];
}

/**
 * Post-processing & streaming guardrail that strips multi-line fenced code blocks
 * if a small local model tries to generate solution code despite the system prompt.
 */
export function enforceNoCodeGenerationGuardrail(rawText: string): string {
  return rawText
    .replace(/```[\s\S]*?```/g, (block) => {
      const inner = block.replace(/```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
      const lines = inner.split('\n').filter((l) => l.trim().length > 0);
      if (lines.length === 1 && lines[0].length < 48 && !/[=:]/.test(lines[0])) {
        return `\`${lines[0].trim()}\``;
      }
      return `*(🦉 Spoiler hidden! Try making the change in the editor yourself — ask me if you'd like another hint!)*`;
    })
    .replace(/Here(?:'s| is) how you can (?:fix|correct) (?:the|this|your) code:\s*/gi, '');
}
