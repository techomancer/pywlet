import {
  flattenSpriteLayers,
  type SpriteProjectData,
} from '../sprite-editor/sprite-data';
import { stripStringsAndComments } from '../diagnostics/python-coach';

export interface RuntimeCallbacks {
  onStdout: (line: string) => void;
  onStderr: (line: string, friendlyLine?: { line: number; message: string }) => void;
  onStatusChange: (status: 'ready' | 'running' | 'loading') => void;
  getSpriteProjectData?: () => SpriteProjectData;
}

/**
 * Python + Pygame-compatible runtime engine for the browser.
 *
 * Architecture:
 * 1. If a local or cached Pyodide bundle is present at `/vendor/pyodide/pyodide.mjs`,
 *    it loads full CPython WASM + `pygame-ce` SDL2 canvas.
 * 2. Simultaneously provides a built-in, zero-download HTML5 Canvas Pygame runner
 *    so that beginner Pygame programs (`pygame.init()`, `pygame.display.set_mode()`,
 *    `pygame.time.Clock()`, `screen.fill()`, `pygame.draw.circle()`, `pygame.draw.rect()`,
 *    `pygame.draw.line()`, `pygame.key.get_pressed()`, `clock.tick(60)`) run immediately
 *    offline at 60 FPS without waiting for external WASM downloads.
 */
export class PythonPygameRuntime {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private callbacks: RuntimeCallbacks;
  private running = false;
  private animFrameId: number | null = null;
  private pressedKeys: Set<string> = new Set();
  private pyodide: any = null;

  constructor(canvas: HTMLCanvasElement, callbacks: RuntimeCallbacks) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas context not supported');
    this.ctx = ctx;
    this.callbacks = callbacks;

    this.bindInputEvents();
  }

  private bindInputEvents(): void {
    window.addEventListener('keydown', (e) => {
      if (this.running) {
        this.pressedKeys.add(e.code);
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
          e.preventDefault();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      this.pressedKeys.delete(e.code);
    });
  }

  isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    this.callbacks.onStatusChange('ready');
  }

  /**
   * Executes the learner's Python/Pygame script.
   */
  async runCode(code: string): Promise<void> {
    this.stop();
    this.running = true;
    this.callbacks.onStatusChange('running');
    this.canvas.focus();

    if (!this.pyodide && (window as any).loadPyodide) {
      try {
        this.callbacks.onStdout('Loading Pyodide WASM runtime...');
        this.pyodide = await (window as any).loadPyodide({
          stdout: (msg: string) => this.callbacks.onStdout(msg),
          stderr: (msg: string) => this.callbacks.onStderr(msg),
        });
      } catch {
        // Fallback to built-in instant Pygame Canvas interpreter
      }
    }

    if (this.pyodide) {
      await this.runWithPyodide(code);
    } else {
      await this.runWithBuiltInPygameBridge(code);
    }
  }

  private async runWithPyodide(code: string): Promise<void> {
    try {
      this.pyodide.canvas.setCanvas2D(this.canvas);
      await this.pyodide.runPythonAsync(code);
    } catch (err: any) {
      this.reportPythonError(err?.message || String(err));
      this.stop();
    }
  }

  /**
   * Built-in zero-dependency Python/Pygame interpreter for beginner Pygame scripts
   * so the IDE works 100% offline out-of-the-box.
   */
  private async runWithBuiltInPygameBridge(code: string): Promise<void> {
    try {
      const lines = code.split('\n');
      const env: Record<string, any> = {
        WIDTH: this.canvas.width,
        HEIGHT: this.canvas.height,
        running: true,
        score: 0,
        pygame: '__PYGAME_MODULE__',
        screen: '__PYGAME_SURFACE__',
        clock: '__PYGAME_CLOCK__',
        keys: '__PYGAME_KEYS__',
      };

      // Execute setup lines before the main `while` loop
      let whileLineIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        const raw = lines[i];
        const trimmed = stripStringsAndComments(raw).withoutComment.trim();
        if (!trimmed) continue;

        if (/^while\s+/.test(trimmed)) {
          whileLineIdx = i;
          break;
        }

        this.execStatementLine(trimmed, i + 1, env);
      }

      if (whileLineIdx === -1) {
        // Pure script without a game loop
        this.stop();
        return;
      }

      const loopLines = lines.slice(whileLineIdx + 1);
      const stepFrame = () => {
        if (!this.running || !env.running) {
          this.stop();
          return;
        }

        try {
          this.execBlock(loopLines, whileLineIdx + 2, env);
        } catch (err: any) {
          this.reportPythonError(err?.message || String(err));
          this.stop();
          return;
        }

        this.animFrameId = requestAnimationFrame(stepFrame);
      };

      this.animFrameId = requestAnimationFrame(stepFrame);
    } catch (err: any) {
      this.reportPythonError(err?.message || String(err));
      this.stop();
    }
  }

  private execBlock(blockLines: string[], startLineNum: number, env: Record<string, any>): void {
    let i = 0;
    while (i < blockLines.length) {
      const raw = blockLines[i];
      const stripped = stripStringsAndComments(raw).withoutComment;
      const trimmed = stripped.trim();
      const lineNum = startLineNum + i;

      if (!trimmed) {
        i++;
        continue;
      }

      // Handle `if <cond>:` or `elif <cond>:` or `else:` blocks
      if ((trimmed.startsWith('if ') || trimmed.startsWith('elif ')) && trimmed.endsWith(':')) {
        const keywordLen = trimmed.startsWith('elif ') ? 5 : 3;
        const condExpr = trimmed.slice(keywordLen, -1).trim();
        const indent = raw.search(/\S|$/);
        const subLines: string[] = [];
        let j = i + 1;
        while (j < blockLines.length) {
          const nextRaw = blockLines[j];
          const nextTrim = stripStringsAndComments(nextRaw).withoutComment.trim();
          if (nextTrim && nextRaw.search(/\S|$/) <= indent) break;
          subLines.push(nextRaw);
          j++;
        }

        if (this.evalCondition(condExpr, env, lineNum)) {
          this.execBlock(subLines, lineNum + 1, env);
        }
        i = j;
        continue;
      }

      // Handle `for event in pygame.event.get():` boilerplate block
      if (trimmed.startsWith('for ') && trimmed.includes('pygame.event.get()')) {
        const indent = raw.search(/\S|$/);
        let j = i + 1;
        while (j < blockLines.length) {
          const nextRaw = blockLines[j];
          const nextTrim = nextRaw.replace(/#.*$/, '').trim();
          if (nextTrim && nextRaw.search(/\S|$/) <= indent) break;
          j++;
        }
        i = j;
        continue;
      }

      this.execStatementLine(trimmed, lineNum, env);
      i++;
    }
  }

  private execStatementLine(stmt: string, lineNum: number, env: Record<string, any>): void {
    // 1. Ignore imports and Pygame window/clock/key setup calls (including LHS assignments like `screen = pygame.display.set_mode(...)`)
    if (
      stmt.startsWith('import ') ||
      stmt.startsWith('from ') ||
      stmt.startsWith('pygame.init') ||
      stmt.startsWith('pygame.display.') ||
      stmt.startsWith('pygame.quit') ||
      stmt.includes('pygame.display.set_mode') ||
      stmt.includes('pygame.display.set_caption') ||
      stmt.includes('pygame.time.Clock') ||
      stmt.includes('pygame.key.get_pressed') ||
      stmt.includes('pygame.font.init') ||
      /^\w+\.tick\s*\(/.test(stmt)
    ) {
      const lhsMatch = stmt.match(/^([a-zA-Z_]\w*)\s*=/);
      if (lhsMatch) {
        env[lhsMatch[1]] = '__PYGAME_OBJECT__';
      }
      return;
    }

    // 2. print(...)
    const printMatch = stmt.match(/^print\s*\((.*)\)$/);
    if (printMatch) {
      const inner = printMatch[1].trim();
      if (!inner) {
        this.callbacks.onStdout('');
        return;
      }
      const val = this.evalExpr(inner, env, lineNum);
      this.callbacks.onStdout(String(val));
      return;
    }

    // 3. screen.fill((r, g, b)) or screen.fill(color_var)
    const fillMatch = stmt.match(/^\w+\.fill\s*\((.+)\)$/);
    if (fillMatch) {
      const rgb = this.parseColorTuple(fillMatch[1].trim(), env, lineNum);
      this.ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    // 4. pygame.draw.circle(surface, color, (x, y), radius)
    const circleMatch = stmt.match(
      /^pygame\.draw\.circle\s*\(\s*\w+\s*,\s*(\([^)]+\)|\w+)\s*,\s*\(([^)]+)\)\s*,\s*([^)]+)\)$/
    );
    if (circleMatch) {
      const rgb = this.parseColorTuple(circleMatch[1].trim(), env, lineNum);
      const center = circleMatch[2].split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
      const radius = Number(this.evalExpr(circleMatch[3].trim(), env, lineNum));

      this.ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      this.ctx.beginPath();
      this.ctx.arc(center[0] || 0, center[1] || 0, Math.max(1, radius), 0, Math.PI * 2);
      this.ctx.fill();
      return;
    }

    // 5. pygame.draw.rect(surface, color, (x, y, w, h))
    const rectMatch = stmt.match(
      /^pygame\.draw\.rect\s*\(\s*\w+\s*,\s*(\([^)]+\)|\w+)\s*,\s*\(([^)]+)\)\s*\)$/
    );
    if (rectMatch) {
      const rgb = this.parseColorTuple(rectMatch[1].trim(), env, lineNum);
      const rect = rectMatch[2].split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
      this.ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      this.ctx.fillRect(rect[0] || 0, rect[1] || 0, rect[2] || 20, rect[3] || 20);
      return;
    }

    // 6. pygame.draw.line(surface, color, (x1, y1), (x2, y2), width?)
    const lineMatch = stmt.match(
      /^pygame\.draw\.line\s*\(\s*\w+\s*,\s*(\([^)]+\)|\w+)\s*,\s*\(([^)]+)\)\s*,\s*\(([^)]+)\)(?:\s*,\s*([^)]+))?\)$/
    );
    if (lineMatch) {
      const rgb = this.parseColorTuple(lineMatch[1].trim(), env, lineNum);
      const p1 = lineMatch[2].split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
      const p2 = lineMatch[3].split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
      const width = lineMatch[4] ? Number(this.evalExpr(lineMatch[4].trim(), env, lineNum)) : 2;
      this.ctx.strokeStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      this.ctx.lineWidth = Math.max(1, width);
      this.ctx.beginPath();
      this.ctx.moveTo(p1[0] || 0, p1[1] || 0);
      this.ctx.lineTo(p2[0] || 0, p2[1] || 0);
      this.ctx.stroke();
      return;
    }

    // 6b. Built-in Sprite & Tilemap helpers:
    // `draw_tilemap(screen, scale, map_name)` or `draw_sprite(screen, sprite_idx, x, y, scale, sheet_name)`
    const tilemapDrawMatch = stmt.match(
      /^draw_tilemap\s*\(\s*\w+(?:\s*,\s*([^,)]+))?(?:\s*,\s*([^)]+))?\s*\)$/
    );
    if (tilemapDrawMatch) {
      const scale = tilemapDrawMatch[1]
        ? Number(this.evalExpr(tilemapDrawMatch[1].trim(), env, lineNum))
        : 4;
      const mapName = tilemapDrawMatch[2]
        ? String(this.evalExpr(tilemapDrawMatch[2].trim(), env, lineNum))
        : undefined;
      this.renderProjectTilemap(Math.max(1, scale), mapName);
      return;
    }

    const spriteDrawMatch = stmt.match(
      /^draw_sprite\s*\(\s*\w+\s*,\s*([^,]+)\s*,\s*([^,]+)\s*,\s*([^,)]+)(?:\s*,\s*([^,)]+))?(?:\s*,\s*([^)]+))?\s*\)$/
    );
    if (spriteDrawMatch) {
      const spIdx = Number(this.evalExpr(spriteDrawMatch[1].trim(), env, lineNum));
      const x = Number(this.evalExpr(spriteDrawMatch[2].trim(), env, lineNum));
      const y = Number(this.evalExpr(spriteDrawMatch[3].trim(), env, lineNum));
      const scale = spriteDrawMatch[4]
        ? Number(this.evalExpr(spriteDrawMatch[4].trim(), env, lineNum))
        : 4;
      const sheetName = spriteDrawMatch[5]
        ? String(this.evalExpr(spriteDrawMatch[5].trim(), env, lineNum))
        : undefined;
      this.renderProjectSprite(spIdx, x, y, Math.max(1, scale), sheetName);
      return;
    }

    // 6c. Pygame Font & Text Rendering support:
    // - `font = pygame.font.SysFont("monospace", 20)` or `pygame.font.Font(None, 24)`
    // - `text_surf = font.render("Score: " + str(score), True, (255, 255, 0))`
    // - `screen.blit(text_surf, (x, y))`
    // - or shorthand `draw_text(screen, "Hello", x, y, size, color, font_name)`
    const sysFontMatch = stmt.match(
      /^([a-zA-Z_]\w*)\s*=\s*pygame\.font\.(?:SysFont|Font)\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)$/
    );
    if (sysFontMatch) {
      const [, fontVar, rawFamily, rawSize] = sysFontMatch;
      const familyVal = rawFamily.trim() === 'None' ? 'monospace' : String(this.evalExpr(rawFamily.trim(), env, lineNum));
      const sizeVal = Number(this.evalExpr(rawSize.trim(), env, lineNum)) || 18;
      env[fontVar] = { __type: 'font', family: familyVal, size: sizeVal };
      return;
    }

    const fontRenderMatch = stmt.match(
      /^([a-zA-Z_]\w*)\s*=\s*([a-zA-Z_]\w*)\.render\s*\(\s*(.+?)\s*,\s*(?:True|False|1|0)\s*,\s*(\([^)]+\)|\w+)\s*\)$/
    );
    if (fontRenderMatch) {
      const [, surfVar, fontVar, textExpr, colorExpr] = fontRenderMatch;
      const fontObj = env[fontVar]?.__type === 'font' ? env[fontVar] : { family: 'monospace', size: 18 };
      const textVal = String(this.evalExpr(textExpr.trim(), env, lineNum));
      const rgb = this.parseColorTuple(colorExpr.trim(), env, lineNum);
      env[surfVar] = {
        __type: 'text_surface',
        text: textVal,
        fontFamily: fontObj.family,
        fontSize: fontObj.size,
        rgb,
      };
      return;
    }

    const blitMatch = stmt.match(/^\w+\.blit\s*\(\s*([a-zA-Z_]\w*)\s*,\s*\(([^)]+)\)\s*\)$/);
    if (blitMatch) {
      const [, surfVar, posExpr] = blitMatch;
      const surfObj = env[surfVar];
      if (surfObj && surfObj.__type === 'text_surface') {
        const coords = posExpr.split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
        this.ctx.font = `bold ${surfObj.fontSize}px ${surfObj.fontFamily}, monospace`;
        this.ctx.fillStyle = `rgb(${surfObj.rgb[0]}, ${surfObj.rgb[1]}, ${surfObj.rgb[2]})`;
        this.ctx.textBaseline = 'top';
        this.ctx.fillText(surfObj.text, coords[0] || 0, coords[1] || 0);
      }
      return;
    }

    const drawTextMatch = stmt.match(
      /^draw_text\s*\(\s*\w+\s*,\s*(.+?)\s*,\s*([^,]+)\s*,\s*([^,)]+)(?:\s*,\s*([^,)]+))?(?:\s*,\s*(\([^)]+\)|\w+))?\s*\)$/
    );
    if (drawTextMatch) {
      const textVal = String(this.evalExpr(drawTextMatch[1].trim(), env, lineNum));
      const x = Number(this.evalExpr(drawTextMatch[2].trim(), env, lineNum)) || 0;
      const y = Number(this.evalExpr(drawTextMatch[3].trim(), env, lineNum)) || 0;
      const size = drawTextMatch[4] ? Number(this.evalExpr(drawTextMatch[4].trim(), env, lineNum)) : 18;
      const rgb = drawTextMatch[5]
        ? this.parseColorTuple(drawTextMatch[5].trim(), env, lineNum)
        : [248, 250, 252];
      this.ctx.font = `bold ${size}px "JetBrains Mono", monospace`;
      this.ctx.fillStyle = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
      this.ctx.textBaseline = 'top';
      this.ctx.fillText(textVal, x, y);
      return;
    }

    // 7. Compound assignment (`x += dx`, `y -= speed`)
    const compoundMatch = stmt.match(/^([a-zA-Z_]\w*)\s*(\+=|-=|\*=)\s*(.+)$/);
    if (compoundMatch) {
      const [, varName, op, rhs] = compoundMatch;
      if (!(varName in env)) {
        throw new Error(`Line ${lineNum}: NameError: name '${varName}' is not defined`);
      }
      const val = Number(this.evalExpr(rhs.trim(), env, lineNum));
      if (op === '+=') env[varName] += val;
      if (op === '-=') env[varName] -= val;
      if (op === '*=') env[varName] *= val;
      return;
    }

    // 8. Variable or tuple assignment (`x = 200`, `color = (255, 0, 0)`, or `x, y = 200, 140`)
    const assignMatch = stmt.match(/^([a-zA-Z_][\w,\s]*)\s*=\s*(.+)$/);
    if (assignMatch) {
      const lhs = assignMatch[1].trim();
      const rhs = assignMatch[2].trim();

      if (!lhs.includes(',') && rhs.startsWith('(') && rhs.endsWith(')')) {
        const inner = rhs.slice(1, -1);
        env[lhs] = inner.split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
        return;
      }

      if (lhs.includes(',')) {
        const names = lhs.split(',').map((s) => s.trim());
        const cleanRhs = rhs.startsWith('(') && rhs.endsWith(')') ? rhs.slice(1, -1) : rhs;
        const vals = cleanRhs.split(',').map((s) => this.evalExpr(s.trim(), env, lineNum));
        names.forEach((n, idx) => {
          env[n] = vals[idx];
        });
      } else {
        env[lhs] = this.evalExpr(rhs, env, lineNum);
      }
      return;
    }

    // 9. Catch unrecognized or misspelled statements/calls so they never fail silently!
    if (/^pygame\.draw\.(\w+)/.test(stmt)) {
      const fnName = stmt.match(/^pygame\.draw\.(\w+)/)?.[1] || '';
      if (!['circle', 'rect', 'line'].includes(fnName)) {
        throw new Error(
          `Line ${lineNum}: AttributeError: module 'pygame.draw' has no function '${fnName}' (try circle, rect, or line)`
        );
      }
      throw new Error(
        `Line ${lineNum}: TypeError: Check the arguments passed to 'pygame.draw.${fnName}(...)' — did you include screen, color (R, G, B), and position/size?`
      );
    }

    if (/^([a-zA-Z_]\w*)\s*\(/.test(stmt)) {
      const fnName = stmt.match(/^([a-zA-Z_]\w*)\s*\(/)?.[1] || stmt;
      throw new Error(`Line ${lineNum}: NameError: function '${fnName}' is not defined`);
    }

    throw new Error(`Line ${lineNum}: SyntaxError: Python could not understand '${stmt}'`);
  }

  private parseColorTuple(expr: string, env: Record<string, any>, lineNum: number): [number, number, number] {
    if (expr in env && Array.isArray(env[expr])) {
      const arr = env[expr];
      return [Number(arr[0]) || 0, Number(arr[1]) || 0, Number(arr[2]) || 0];
    }
    const clean = expr.replace(/^\(|\)$/g, '');
    const parts = clean.split(',').map((s) => Number(this.evalExpr(s.trim(), env, lineNum)));
    return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
  }

  private evalCondition(cond: string, env: Record<string, any>, lineNum: number): boolean {
    // Check for unknown or misspelled `pygame.K_*` key names
    const keyConstMatch = cond.match(/pygame\.(K_[A-Za-z0-9_]+)/);
    if (keyConstMatch) {
      const keyConst = keyConstMatch[1];
      const validKeys = ['K_LEFT', 'K_RIGHT', 'K_UP', 'K_DOWN', 'K_SPACE', 'K_a', 'K_d', 'K_w', 'K_s'];
      if (!validKeys.includes(keyConst)) {
        throw new Error(
          `Line ${lineNum}: AttributeError: 'pygame.${keyConst}' is not a recognized key (try K_LEFT, K_RIGHT, K_UP, K_DOWN, or K_SPACE)`
        );
      }
    }

    if (cond.includes('K_LEFT') || cond.includes('K_a')) return this.pressedKeys.has('ArrowLeft') || this.pressedKeys.has('KeyA');
    if (cond.includes('K_RIGHT') || cond.includes('K_d')) return this.pressedKeys.has('ArrowRight') || this.pressedKeys.has('KeyD');
    if (cond.includes('K_UP') || cond.includes('K_w')) return this.pressedKeys.has('ArrowUp') || this.pressedKeys.has('KeyW');
    if (cond.includes('K_DOWN') || cond.includes('K_s')) return this.pressedKeys.has('ArrowDown') || this.pressedKeys.has('KeyS');
    if (cond.includes('K_SPACE')) return this.pressedKeys.has('Space');
    if (cond.includes('pygame.QUIT')) return false;

    if (cond.includes(' or ')) {
      return cond.split(' or ').some((part) => this.evalCondition(part.trim(), env, lineNum));
    }
    if (cond.includes(' and ')) {
      return cond.split(' and ').every((part) => this.evalCondition(part.trim(), env, lineNum));
    }

    const cmpMatch = cond.match(/^(.+?)\s*(<=|>=|==|!=|<|>)\s*(.+)$/);
    if (cmpMatch) {
      const left = Number(this.evalExpr(cmpMatch[1].trim(), env, lineNum));
      const op = cmpMatch[2];
      const right = Number(this.evalExpr(cmpMatch[3].trim(), env, lineNum));
      if (op === '<') return left < right;
      if (op === '>') return left > right;
      if (op === '<=') return left <= right;
      if (op === '>=') return left >= right;
      if (op === '==') return left === right;
      if (op === '!=') return left !== right;
    }
    return Boolean(env[cond]);
  }

  private evalExpr(expr: string, env: Record<string, any>, lineNum: number): any {
    // Support string concatenation with `+`
    if (expr.includes('+') && (expr.includes('"') || expr.includes("'") || expr.includes('str('))) {
      return expr
        .split('+')
        .map((part) => {
          const p = part.trim();
          const strCall = p.match(/^str\s*\((.+)\)$/);
          if (strCall) {
            return String(this.evalExpr(strCall[1].trim(), env, lineNum));
          }
          const val = this.evalExpr(p, env, lineNum);
          // In Python, `"Score: " + 5` (without `str(5)`) raises TypeError!
          if (typeof val === 'number' && !p.startsWith('"') && !p.startsWith("'")) {
            throw new Error(
              `Line ${lineNum}: TypeError: can only concatenate str (not "int") to str — wrap numbers in str(${p}) when joining with text!`
            );
          }
          return String(val);
        })
        .join('');
    }

    if (
      (expr.startsWith('"') && expr.endsWith('"')) ||
      (expr.startsWith("'") && expr.endsWith("'"))
    ) {
      return expr.slice(1, -1);
    }
    if (expr === 'True') return true;
    if (expr === 'False') return false;
    if (!Number.isNaN(Number(expr))) return Number(expr);

    const substituted = expr.replace(/\b[a-zA-Z_]\w*\b/g, (ident) => {
      if (ident in env) return String(env[ident]);
      if (lineNum > 0) {
        throw new Error(`Line ${lineNum}: NameError: name '${ident}' is not defined`);
      }
      return '0';
    });

    try {
      if (/^[\d\s+\-*/().]+$/.test(substituted)) {
        const res = Function(`"use strict"; return (${substituted});`)();
        if (res === Infinity || res === -Infinity || Number.isNaN(res)) {
          throw new Error(`Line ${lineNum}: ZeroDivisionError: division by zero`);
        }
        return res;
      }
    } catch (err: any) {
      if (err?.message?.includes('ZeroDivisionError')) throw err;
    }
    return substituted;
  }

  private renderProjectSprite(
    spriteIdx: number,
    destX: number,
    destY: number,
    scale: number,
    sheetName?: string
  ): void {
    const spriteData = this.callbacks.getSpriteProjectData?.();
    if (!spriteData) return;
    const sheet =
      (sheetName ? spriteData.sheets[sheetName] : undefined) ||
      spriteData.sheets[spriteData.activeSheetName] ||
      Object.values(spriteData.sheets)[0];
    if (!sheet) return;
    const sp = sheet.sprites[spriteIdx];
    if (!sp) return;
    const size = sheet.spriteSize;
    const flat = flattenSpriteLayers(sp, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const colorIdx = flat[y][x];
        if (colorIdx > 0 && spriteData.palette[colorIdx]) {
          this.ctx.fillStyle = spriteData.palette[colorIdx];
          this.ctx.fillRect(destX + x * scale, destY + y * scale, scale, scale);
        }
      }
    }
  }

  private renderProjectTilemap(scale: number, mapName?: string): void {
    const spriteData = this.callbacks.getSpriteProjectData?.();
    if (!spriteData) return;
    const map =
      (mapName ? spriteData.maps[mapName] : undefined) ||
      spriteData.maps[spriteData.activeMapName] ||
      Object.values(spriteData.maps)[0];
    if (!map) return;
    const sheet =
      spriteData.sheets[map.sheetName] ||
      spriteData.sheets[spriteData.activeSheetName] ||
      Object.values(spriteData.sheets)[0];
    if (!sheet) return;
    const tilePx = sheet.spriteSize * scale;

    for (let r = 0; r < map.rows; r++) {
      for (let c = 0; c < map.cols; c++) {
        const spIdx = map.tiles[r]?.[c] ?? -1;
        if (spIdx >= 0) {
          this.renderProjectSprite(spIdx, c * tilePx, r * tilePx, scale, sheet.name);
        }
      }
    }
  }

  private reportPythonError(rawMsg: string): void {
    // 1. Built-in runner error format: `Line 36: NameError: ...`
    const lineMatch = rawMsg.match(/Line (\d+):\s*(.+)/);
    if (lineMatch) {
      this.callbacks.onStderr(rawMsg, {
        line: Number(lineMatch[1]),
        message: lineMatch[2],
      });
      return;
    }

    // 2. Full CPython / Pyodide multi-line traceback format: `File "<exec>", line 14, in <module>`
    const pyodideLineMatches = [...rawMsg.matchAll(/line (\d+)/gi)];
    const lastLineNum =
      pyodideLineMatches.length > 0
        ? Number(pyodideLineMatches[pyodideLineMatches.length - 1][1])
        : 1;
    const nonEmptyLines = rawMsg
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const summaryLine = nonEmptyLines[nonEmptyLines.length - 1] || rawMsg;

    this.callbacks.onStderr(rawMsg, {
      line: lastLineNum,
      message: summaryLine,
    });
  }
}
