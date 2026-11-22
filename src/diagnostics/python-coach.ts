export interface PythonDiagnostic {
  line: number;
  column: number;
  endColumn: number;
  severity: 'error' | 'warning' | 'info';
  title: string;
  friendlyExplanation: string;
}

const BLOCK_KEYWORDS = /^(if|elif|else|for|while|def|class|try|except|finally|with)\b/;

/**
 * Strips Python comments (`#...`) ONLY when `#` is outside string literals,
 * and replaces string literal contents with spaces so characters like `#`, `(`, `)`, `:`, `=`
 * inside quotes never trigger false-positive syntax diagnostics!
 */
export function stripStringsAndComments(rawLine: string): {
  codeOnly: string;
  withoutComment: string;
  unclosedQuote: '"' | "'" | null;
} {
  let codeOnly = '';
  let withoutComment = '';
  let inQuote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < rawLine.length; i++) {
    const ch = rawLine[i];

    if (escaped) {
      escaped = false;
      withoutComment += ch;
      codeOnly += inQuote ? ' ' : ch;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      withoutComment += ch;
      codeOnly += inQuote ? ' ' : ch;
      continue;
    }

    if (inQuote) {
      withoutComment += ch;
      if (ch === inQuote) {
        inQuote = null;
        codeOnly += ch;
      } else {
        codeOnly += ' ';
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inQuote = ch;
      withoutComment += ch;
      codeOnly += ch;
      continue;
    }

    if (ch === '#') {
      // Real Python comment outside quotes — stop here!
      break;
    }

    withoutComment += ch;
    codeOnly += ch;
  }

  return {
    codeOnly: codeOnly.trimEnd(),
    withoutComment: withoutComment.trimEnd(),
    unclosedQuote: inQuote,
  };
}

/**
 * Instant, zero-latency static checker designed for an 11-year-old learning Python & Pygame.
 * Catches common beginner syntax pitfalls and Pygame loop gotchas as they type,
 * providing friendly explanations before they even run the code.
 */
export function analyzePythonCodeForLearners(code: string): PythonDiagnostic[] {
  const lines = code.split('\n');
  const diagnostics: PythonDiagnostic[] = [];

  let hasPygameImport = false;
  let hasWhileLoop = false;
  let hasDisplayFlipOrUpdate = false;
  let fillLine = -1;
  let firstDrawLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const rawLine = lines[i];
    const { codeOnly, withoutComment, unclosedQuote } = stripStringsAndComments(rawLine);
    const stripped = codeOnly;
    const trimmed = withoutComment.trim();
    const codeTrimmed = codeOnly.trim();

    if (!trimmed) continue;

    // 0. Check for unclosed string literal (`SyntaxError: unterminated string literal`)
    if (unclosedQuote && !rawLine.trim().startsWith('"""') && !rawLine.trim().startsWith("'''")) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: `Unclosed quote ${unclosedQuote}`,
        friendlyExplanation: `You opened a string with a ${unclosedQuote} quote on line ${lineNum}, but Python reached the end of the line without finding the matching closing ${unclosedQuote} quote!`,
      });
      continue;
    }

    // 0b. Check for lowercase `true` or `false` (Python requires `True` and `False`)
    const lowerBoolMatch = codeTrimmed.match(/\b(true|false)\b/);
    if (lowerBoolMatch) {
      const word = lowerBoolMatch[1];
      const proper = word === 'true' ? 'True' : 'False';
      diagnostics.push({
        line: lineNum,
        column: Math.max(1, rawLine.indexOf(word) + 1),
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: `Use capital \`${proper}\` in Python`,
        friendlyExplanation: `In Python, True and False always start with a capital letter! Try changing \`${word}\` to \`${proper}\`.`,
      });
    }

    if (/^(import\s+pygame|from\s+pygame\s+import)/.test(codeTrimmed)) {
      hasPygameImport = true;
    }
    if (/^while\s+/.test(codeTrimmed)) {
      hasWhileLoop = true;
    }
    if (/pygame\.display\.(flip|update)\s*\(/.test(codeTrimmed)) {
      hasDisplayFlipOrUpdate = true;
    }
    if (/\.fill\s*\(/.test(codeTrimmed) && fillLine === -1) {
      fillLine = lineNum;
    }
    if (/pygame\.draw\./.test(codeTrimmed) && firstDrawLine === -1) {
      firstDrawLine = lineNum;
    }

    // 1. Check for single `=` inside an `if`, `elif`, or `while` condition
    if (/^(if|elif|while)\s+[^=!:<>]+=\s*[^=]/.test(codeTrimmed)) {
      const eqIdx = rawLine.indexOf('=');
      diagnostics.push({
        line: lineNum,
        column: Math.max(1, eqIdx),
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: 'Single `=` inside a condition',
        friendlyExplanation:
          'In Python, a single `=` puts a value into a variable box. When you want to *compare* two things inside an `if` or `while`, what double symbol should you use instead?',
      });
    }

    // 2. Check for missing colon `:` at the end of block statements (`if`, `for`, `while`, `def`, `else`)
    if (
      BLOCK_KEYWORDS.test(codeTrimmed) &&
      !codeTrimmed.endsWith(':') &&
      !codeTrimmed.endsWith('\\') &&
      !codeTrimmed.endsWith(',')
    ) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: 'Missing colon `:` at end of line',
        friendlyExplanation:
          'Lines that start a new block (`if`, `for`, `while`, `def`, `else`) need a colon `:` at the very end so Python knows the next lines belong inside it!',
      });
    }

    // 3. Check for unbalanced parentheses on a single line (only when not a multi-line `[` or `{` expression)
    const openParens = (stripped.match(/\(/g) || []).length;
    const closeParens = (stripped.match(/\)/g) || []).length;
    if (
      openParens !== closeParens &&
      !codeTrimmed.endsWith(',') &&
      !codeTrimmed.endsWith('(') &&
      !codeTrimmed.endsWith('[') &&
      !codeTrimmed.endsWith('{')
    ) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: 'Unmatched parentheses `( )`',
        friendlyExplanation: `This line has ${openParens} opening \`(\` and ${closeParens} closing \`)\`. Every opening parenthesis needs a matching partner!`,
      });
    }

    // 3b. Check for unbalanced square brackets `[ ]` on a single-line statement (e.g. `keys[pygame.K_LEFT`)
    const openBrackets = (stripped.match(/\[/g) || []).length;
    const closeBrackets = (stripped.match(/\]/g) || []).length;
    if (
      openBrackets !== closeBrackets &&
      !codeTrimmed.endsWith('[') &&
      !codeTrimmed.endsWith(',') &&
      !codeTrimmed.startsWith(']')
    ) {
      diagnostics.push({
        line: lineNum,
        column: 1,
        endColumn: rawLine.length + 1,
        severity: 'error',
        title: 'Unmatched square brackets `[ ]`',
        friendlyExplanation: `This line has ${openBrackets} opening \`[\` and ${closeBrackets} closing \`]\`. Did you forget a closing \`]\` (like in \`keys[pygame.K_LEFT]\`)?`,
      });
    }

    // 4. Check for stray colon on non-block statements OR missing indentation after real block headers
    if (codeTrimmed.endsWith(':')) {
      if (!BLOCK_KEYWORDS.test(codeTrimmed) && !codeTrimmed.startsWith('case ') && !codeTrimmed.startsWith('match ')) {
        const colonCol = rawLine.lastIndexOf(':') + 1;
        diagnostics.push({
          line: lineNum,
          column: Math.max(1, colonCol),
          endColumn: Math.max(2, colonCol + 1),
          severity: 'error',
          title: `Unexpected colon ':' on line ${lineNum}`,
          friendlyExplanation: `There is an extra colon \`:\` at the end of line ${lineNum}. Only block headers like \`if\`, \`while\`, \`for\`, \`def\`, or \`else\` should end with \`:\`!`,
        });
      } else if (i + 1 < lines.length) {
        const currentIndent = rawLine.search(/\S|$/);
        for (let j = i + 1; j < lines.length; j++) {
          const nextRaw = lines[j];
          const nextTrim = stripStringsAndComments(nextRaw).withoutComment.trim();
          if (!nextTrim) continue;
          const nextIndent = nextRaw.search(/\S|$/);
          if (nextIndent <= currentIndent) {
            diagnostics.push({
              line: j + 1,
              column: 1,
              endColumn: nextRaw.length + 1,
              severity: 'error',
              title: 'Expected indented block',
              friendlyExplanation: `Because line ${lineNum} ends with a colon \`:\`, line ${
                j + 1
              } needs to be indented (press Tab or add 4 spaces) so Python knows it's inside the block!`,
            });
          }
          break;
        }
      }
    }
  }

  // 5. Pygame-specific Coach Checks
  if (hasPygameImport && hasWhileLoop && !hasDisplayFlipOrUpdate) {
    diagnostics.push({
      line: lines.length,
      column: 1,
      endColumn: 20,
      severity: 'warning',
      title: 'Missing `pygame.display.flip()` in game loop',
      friendlyExplanation:
        'You have a `while` game loop, but `pygame.display.flip()` is never called! Without flipping the display each frame, your drawings won\'t show up on the screen.',
    });
  }

  if (hasPygameImport && firstDrawLine !== -1 && fillLine > firstDrawLine) {
    diagnostics.push({
      line: fillLine,
      column: 1,
      endColumn: lines[fillLine - 1].length + 1,
      severity: 'warning',
      title: '`screen.fill()` called AFTER drawing',
      friendlyExplanation: `Line ${fillLine} fills the whole screen with a background color *after* you already drew on line ${firstDrawLine}! That paints right over your drawing every frame. What happens if you move \`screen.fill\` earlier?`,
    });
  }

  return diagnostics;
}
