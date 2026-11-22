/**
 * Python bootstrap code executed once inside Pyodide to provide:
 *  1. `_pywlet_lint(code, filename)` — Real CPython AST syntax + undefined-name + Pygame coach
 *  2. Full `pygame` Python module bridged to Pywlet's HTML5 Canvas, keyboard, mouse,
 *     workspace `.png` images, workspace `.wav` sounds, and `sprites_data.py`
 *  3. Built-in helpers: `draw_sprite`, `draw_tilemap`, `draw_text`, `play_sound`
 *  4. `_pywlet_prepare_async_code(code)` — fallback cooperative async transform when
 *     SharedArrayBuffer is unavailable.
 */
export const PYWLET_PYTHON_BOOTSTRAP = `
import ast
import builtins
import difflib
import json
import math
import sys
import time
import types
import _pywlet_host

# =============================================================================
# 1. REAL CPYTHON AST LINTER & FRIENDLY DIAGNOSTIC TRANSLATOR
# =============================================================================

_PYWLET_EXTRA_BUILTINS = {
    'draw_sprite',
    'draw_tilemap',
    'draw_text',
    'play_sound',
    'WIDTH',
    'HEIGHT',
}

_BLOCK_STARTERS = (
    'if', 'elif', 'else', 'for', 'while', 'def', 'async', 'class',
    'try', 'except', 'finally', 'with', 'match', 'case',
)

def _friendly_syntax_error(err, code):
    lineno = err.lineno or 1
    offset = err.offset or 1
    end_offset = err.end_offset or (offset + 1)
    if end_offset <= offset:
        end_offset = offset + 1
    msg = err.msg or 'invalid syntax'
    lines = code.splitlines()
    raw_line = lines[lineno - 1] if 1 <= lineno <= len(lines) else (err.text or '')
    bad_token = raw_line[offset - 1 : end_offset - 1] if raw_line else ''
    stripped_line = raw_line.strip()
    first_word = stripped_line.split()[0].rstrip(':(') if stripped_line else ''

    # 1. Stray colon on a non-block statement (e.g. screen.fill((15, 23, 42)):)
    if bad_token == ':' and first_word not in _BLOCK_STARTERS:
        return (
            f"Unexpected colon ':' on line {lineno}",
            f"Python found an extra colon ':' at column {offset} of line {lineno}. "
            f"Only block headers like 'if', 'while', 'for', 'def', or 'else' should end with ':'. "
            f"Try removing that trailing ':'!",
        )

    # 2. Indentation / Tab errors
    if isinstance(err, TabError):
        return (
            'Mixed tabs and spaces',
            f"Line {lineno} mixes Tab characters and spaces for indentation. Use 4 spaces consistently.",
        )
    if isinstance(err, IndentationError):
        if 'expected an indented block' in msg:
            return (
                'Expected an indented block',
                f"Python expected line {lineno} to be indented (4 spaces) inside the block above it!",
            )
        if 'unexpected indent' in msg:
            return (
                'Unexpected extra indentation',
                f"Line {lineno} is indented farther than the lines above it, but there isn't a block header (like 'if' or 'while') before it.",
            )
        return (
            'Indentation mismatch',
            f"Line {lineno} doesn't line up with the indentation level of its surrounding block ({msg}).",
        )

    # 3. Single '=' inside if/while condition
    if "Maybe you meant '=='" in msg or "cannot assign to" in msg:
        return (
            "Single '=' used where '==' was expected",
            f"On line {lineno}, Python says: {msg}. Remember: single '=' stores a value in a variable, while double '==' compares two values!",
        )

    # 4. Missing colon
    if msg == "expected ':'":
        return (
            "Missing colon ':' at end of line",
            f"Line {lineno} starts a Python block ('{first_word}'), so it needs a colon ':' at the very end!",
        )

    # 5. Unterminated string
    if 'unterminated string' in msg or 'EOL while scanning string' in msg:
        return (
            'Unclosed string quote',
            f"You started a text string on line {lineno} but forgot the matching closing quote at the end!",
        )

    # 6. Unclosed parentheses / brackets / braces
    if 'was never closed' in msg:
        return (
            f"Unclosed bracket: {msg}",
            f"On line {lineno}, {msg}. Check that every opening '(', '[', or '{{' has a matching closing partner!",
        )

    if 'closing parenthesis' in msg and 'does not match' in msg:
        return (
            'Mismatched brackets',
            f"On line {lineno}, {msg}. Make sure '(' closes with ')' and '[' closes with ']'.",
        )

    # 7. Default accurate CPython syntax message with exact token & column
    token_hint = f" near '{bad_token}'" if bad_token and bad_token.strip() else ''
    return (
        f"SyntaxError{token_hint}: {msg}",
        f"Python couldn't parse line {lineno} at column {offset}{token_hint}: {msg}. Double-check punctuation, quotes, and spelling on that line.",
    )


class _ScopeAndCoachVisitor(ast.NodeVisitor):
    def __init__(self, code_lines):
        self.code_lines = code_lines
        self.builtin_names = set(dir(builtins)) | _PYWLET_EXTRA_BUILTINS
        self.scopes = [set()]
        self.diagnostics = []
        self.has_pygame_import = False
        self.used_names = []  # (name, lineno, col, end_col, scope_snapshot_index)

    def _define(self, name):
        self.scopes[-1].add(name)

    def _define_target(self, node):
        if isinstance(node, ast.Name):
            self._define(node.id)
        elif isinstance(node, (ast.Tuple, ast.List)):
            for elt in node.elts:
                self._define_target(elt)
        elif isinstance(node, ast.Starred):
            self._define_target(node.value)

    def _is_defined(self, name):
        if name in self.builtin_names:
            return True
        for scope in reversed(self.scopes):
            if name in scope:
                return True
        return False

    def _all_known_names(self):
        names = set(self.builtin_names)
        for scope in self.scopes:
            names |= scope
        return names

    def visit_Import(self, node):
        for alias in node.names:
            top = alias.name.split('.')[0]
            if top == 'pygame':
                self.has_pygame_import = True
            self._define(alias.asname or top)

    def visit_ImportFrom(self, node):
        if node.module and node.module.split('.')[0] == 'pygame':
            self.has_pygame_import = True
        for alias in node.names:
            if alias.name == '*':
                # Wildcard import can bring arbitrary symbols
                self.scopes[-1].add('*')
            else:
                self._define(alias.asname or alias.name)

    def visit_Assign(self, node):
        self.visit(node.value)
        for target in node.targets:
            self._define_target(target)
            # Also visit subscript/attribute targets (e.g. a[i] = 1)
            if not isinstance(target, ast.Name):
                self._visit_store_subexprs(target)

    def visit_AnnAssign(self, node):
        if node.value is not None:
            self.visit(node.value)
        self._define_target(node.target)

    def visit_AugAssign(self, node):
        # e.g. x += 1 reads x before assigning
        if isinstance(node.target, ast.Name):
            self._check_name_load(node.target)
        else:
            self._visit_store_subexprs(node.target)
        self.visit(node.value)
        self._define_target(node.target)

    def _visit_store_subexprs(self, target):
        if isinstance(target, ast.Subscript):
            self.visit(target.value)
            self.visit(target.slice)
        elif isinstance(target, ast.Attribute):
            self.visit(target.value)
        elif isinstance(target, (ast.Tuple, ast.List)):
            for elt in target.elts:
                if not isinstance(elt, ast.Name):
                    self._visit_store_subexprs(elt)

    def visit_For(self, node):
        self.visit(node.iter)
        self._define_target(node.target)
        for stmt in node.body:
            self.visit(stmt)
        for stmt in node.orelse:
            self.visit(stmt)

    def visit_With(self, node):
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars is not None:
                self._define_target(item.optional_vars)
        for stmt in node.body:
            self.visit(stmt)

    def visit_ExceptHandler(self, node):
        if node.type is not None:
            self.visit(node.type)
        if node.name:
            self._define(node.name)
        for stmt in node.body:
            self.visit(stmt)

    def visit_FunctionDef(self, node):
        self._define(node.name)
        for dec in node.decorator_list:
            self.visit(dec)
        for d in node.args.defaults:
            self.visit(d)
        for d in node.args.kw_defaults:
            if d is not None:
                self.visit(d)
        self.scopes.append(set())
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            self._define(arg.arg)
        if node.args.vararg:
            self._define(node.args.vararg.arg)
        if node.args.kwarg:
            self._define(node.args.kwarg.arg)
        # Pre-register nested defs & global declarations inside function
        for stmt in node.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                self._define(stmt.name)
            elif isinstance(stmt, ast.Global):
                for n in stmt.names:
                    self._define(n)
        for stmt in node.body:
            self.visit(stmt)
        self.scopes.pop()

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_ClassDef(self, node):
        self._define(node.name)
        for base in node.bases:
            self.visit(base)
        self.scopes.append(set())
        for stmt in node.body:
            if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._define(stmt.name)
        for stmt in node.body:
            self.visit(stmt)
        self.scopes.pop()

    def visit_Lambda(self, node):
        self.scopes.append(set())
        for arg in node.args.posonlyargs + node.args.args + node.args.kwonlyargs:
            self._define(arg.arg)
        if node.args.vararg:
            self._define(node.args.vararg.arg)
        if node.args.kwarg:
            self._define(node.args.kwarg.arg)
        self.visit(node.body)
        self.scopes.pop()

    def _visit_comp(self, generators, exprs):
        self.scopes.append(set())
        for gen in generators:
            self.visit(gen.iter)
            self._define_target(gen.target)
            for cond in gen.ifs:
                self.visit(cond)
        for e in exprs:
            self.visit(e)
        self.scopes.pop()

    def visit_ListComp(self, node):
        self._visit_comp(node.generators, [node.elt])

    def visit_SetComp(self, node):
        self._visit_comp(node.generators, [node.elt])

    def visit_GeneratorExp(self, node):
        self._visit_comp(node.generators, [node.elt])

    def visit_DictComp(self, node):
        self._visit_comp(node.generators, [node.key, node.value])

    def visit_Name(self, node):
        if isinstance(node.ctx, ast.Load):
            self._check_name_load(node)

    def _check_name_load(self, node):
        name = node.id
        if self._is_defined(name) or any('*' in s for s in self.scopes):
            return
        lineno = node.lineno
        col = (node.col_offset or 0) + 1
        end_col = (node.end_col_offset or (col + len(name) - 1)) + 1

        if name in ('true', 'false', 'none'):
            proper = {'true': 'True', 'false': 'False', 'none': 'None'}[name]
            self.diagnostics.append({
                'line': lineno,
                'column': col,
                'endColumn': end_col,
                'severity': 'error',
                'title': f"Use capital '{proper}' in Python",
                'friendlyExplanation': f"In Python, '{proper}' starts with a capital letter! Try changing '{name}' to '{proper}'.",
            })
            return

        matches = difflib.get_close_matches(name, list(self._all_known_names()), n=1, cutoff=0.72)
        suggestion = f" Did you mean '{matches[0]}'?" if matches else ''
        self.diagnostics.append({
            'line': lineno,
            'column': col,
            'endColumn': end_col,
            'severity': 'error',
            'title': f"Undefined name '{name}'",
            'friendlyExplanation': f"Python doesn't know what '{name}' is on line {lineno} yet.{suggestion} Make sure it's spelled the same way and defined before you use it!",
        })

    def visit_While(self, node):
        self.visit(node.test)
        for stmt in node.body:
            self.visit(stmt)
        for stmt in node.orelse:
            self.visit(stmt)

        # Pygame loop coaching on real AST
        if self.has_pygame_import:
            has_draw = False
            has_flip = False
            first_draw_line = None
            fill_line = None
            for sub in ast.walk(node):
                if isinstance(sub, ast.Call):
                    call_name = _get_call_name(sub.func)
                    if call_name in ('pygame.display.flip', 'pygame.display.update'):
                        has_flip = True
                    elif (
                        call_name.startswith('pygame.draw.')
                        or call_name.endswith('.blit')
                        or call_name in ('draw_sprite', 'draw_tilemap', 'draw_text')
                    ):
                        has_draw = True
                        if first_draw_line is None or sub.lineno < first_draw_line:
                            first_draw_line = sub.lineno
                    elif call_name.endswith('.fill'):
                        if fill_line is None or sub.lineno > fill_line:
                            fill_line = sub.lineno

            if has_draw and not has_flip:
                self.diagnostics.append({
                    'line': node.lineno,
                    'column': 1,
                    'endColumn': len(self.code_lines[node.lineno - 1]) + 1 if node.lineno <= len(self.code_lines) else 20,
                    'severity': 'warning',
                    'title': "Missing 'pygame.display.flip()' in game loop",
                    'friendlyExplanation': "You draw inside this 'while' loop, but 'pygame.display.flip()' is never called! Without flipping the display each frame, your drawings won't appear on screen.",
                })
            if first_draw_line is not None and fill_line is not None and fill_line > first_draw_line:
                self.diagnostics.append({
                    'line': fill_line,
                    'column': 1,
                    'endColumn': len(self.code_lines[fill_line - 1]) + 1 if fill_line <= len(self.code_lines) else 20,
                    'severity': 'warning',
                    'title': "'screen.fill()' called AFTER drawing",
                    'friendlyExplanation': f"Line {fill_line} fills the whole screen with a background color *after* you drew on line {first_draw_line}, painting right over it! Try moving 'screen.fill(...)' before your draw calls.",
                })


def _get_call_name(func_node):
    parts = []
    cur = func_node
    while isinstance(cur, ast.Attribute):
        parts.append(cur.attr)
        cur = cur.value
    if isinstance(cur, ast.Name):
        parts.append(cur.id)
    return '.'.join(reversed(parts))


def _pywlet_lint(code, filename='main.py'):
    try:
        tree = ast.parse(code, filename=filename)
    except SyntaxError as err:
        lineno = err.lineno or 1
        col = err.offset or 1
        end_col = err.end_offset or (col + 1)
        if end_col <= col:
            end_col = col + 1
        title, explanation = _friendly_syntax_error(err, code)
        return json.dumps([{
            'line': lineno,
            'column': col,
            'endColumn': end_col,
            'severity': 'error',
            'title': title,
            'friendlyExplanation': explanation,
        }])

    visitor = _ScopeAndCoachVisitor(code.splitlines())
    # Pre-register top-level functions & classes so mutual/forward calls work
    for stmt in tree.body:
        if isinstance(stmt, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            visitor._define(stmt.name)
    visitor.visit(tree)
    return json.dumps(visitor.diagnostics)


# =============================================================================
# 2. REAL PYTHON PYGAME MODULE BRIDGED TO HTML5 CANVAS + WORKSPACE ASSETS
# =============================================================================

_pywlet_frame_cmds = []
_pywlet_screen_size = [400, 280]
_pywlet_start_ms = time.monotonic() * 1000.0
_pywlet_last_flip = 0.0
_pywlet_clock_used = False

def _norm_color(color):
    if isinstance(color, str):
        return color
    if hasattr(color, 'r') and hasattr(color, 'g') and hasattr(color, 'b'):
        return [int(color.r), int(color.g), int(color.b), int(getattr(color, 'a', 255))]
    if isinstance(color, (tuple, list)):
        if len(color) >= 4:
            return [int(color[0]), int(color[1]), int(color[2]), int(color[3])]
        if len(color) >= 3:
            return [int(color[0]), int(color[1]), int(color[2]), 255]
    return [255, 255, 255, 255]

def _norm_rect(rect):
    if isinstance(rect, _PyRect):
        return [float(rect.x), float(rect.y), float(rect.width), float(rect.height)]
    if isinstance(rect, (tuple, list)):
        if len(rect) == 2 and isinstance(rect[0], (tuple, list)) and isinstance(rect[1], (tuple, list)):
            return [float(rect[0][0]), float(rect[0][1]), float(rect[1][0]), float(rect[1][1])]
        return [float(rect[0]), float(rect[1]), float(rect[2]), float(rect[3])]
    raise TypeError(f"Expected a Rect or (x, y, width, height) tuple, got {type(rect).__name__}")


class _PyColor:
    def __init__(self, r, g=0, b=0, a=255):
        if isinstance(r, str):
            s = r.lstrip('#')
            if len(s) >= 6:
                self.r, self.g, self.b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
                self.a = int(s[6:8], 16) if len(s) >= 8 else 255
            else:
                self.r, self.g, self.b, self.a = 255, 255, 255, 255
        elif isinstance(r, (tuple, list)):
            self.r = int(r[0])
            self.g = int(r[1])
            self.b = int(r[2])
            self.a = int(r[3]) if len(r) > 3 else 255
        else:
            self.r, self.g, self.b, self.a = int(r), int(g), int(b), int(a)

    def __iter__(self):
        return iter((self.r, self.g, self.b, self.a))

    def __getitem__(self, idx):
        return (self.r, self.g, self.b, self.a)[idx]

    def __len__(self):
        return 4


class _PyRect:
    def __init__(self, x, y=None, w=None, h=None):
        if y is None and isinstance(x, _PyRect):
            self.x, self.y, self.width, self.height = float(x.x), float(x.y), float(x.width), float(x.height)
        elif y is None and isinstance(x, (tuple, list)):
            self.x, self.y, self.width, self.height = float(x[0]), float(x[1]), float(x[2]), float(x[3])
        elif w is None and isinstance(x, (tuple, list)) and isinstance(y, (tuple, list)):
            self.x, self.y, self.width, self.height = float(x[0]), float(x[1]), float(y[0]), float(y[1])
        else:
            self.x = float(x)
            self.y = float(y or 0)
            self.width = float(w or 0)
            self.height = float(h or 0)

    @property
    def w(self): return self.width
    @w.setter
    def w(self, v): self.width = float(v)
    @property
    def h(self): return self.height
    @h.setter
    def h(self, v): self.height = float(v)
    @property
    def left(self): return self.x
    @left.setter
    def left(self, v): self.x = float(v)
    @property
    def right(self): return self.x + self.width
    @right.setter
    def right(self, v): self.x = float(v) - self.width
    @property
    def top(self): return self.y
    @top.setter
    def top(self, v): self.y = float(v)
    @property
    def bottom(self): return self.y + self.height
    @bottom.setter
    def bottom(self, v): self.y = float(v) - self.height
    @property
    def centerx(self): return self.x + self.width / 2
    @centerx.setter
    def centerx(self, v): self.x = float(v) - self.width / 2
    @property
    def centery(self): return self.y + self.height / 2
    @centery.setter
    def centery(self, v): self.y = float(v) - self.height / 2
    @property
    def center(self): return (self.centerx, self.centery)
    @center.setter
    def center(self, v): self.centerx, self.centery = float(v[0]), float(v[1])
    @property
    def topleft(self): return (self.x, self.y)
    @topleft.setter
    def topleft(self, v): self.x, self.y = float(v[0]), float(v[1])
    @property
    def size(self): return (self.width, self.height)
    @size.setter
    def size(self, v): self.width, self.height = float(v[0]), float(v[1])

    def copy(self):
        return _PyRect(self.x, self.y, self.width, self.height)

    def move(self, dx, dy):
        return _PyRect(self.x + dx, self.y + dy, self.width, self.height)

    def move_ip(self, dx, dy):
        self.x += dx
        self.y += dy

    def inflate(self, dw, dh):
        return _PyRect(self.x - dw / 2, self.y - dh / 2, self.width + dw, self.height + dh)

    def colliderect(self, other):
        o = other if isinstance(other, _PyRect) else _PyRect(other)
        return (
            self.left < o.right
            and self.right > o.left
            and self.top < o.bottom
            and self.bottom > o.top
        )

    def collidepoint(self, x, y=None):
        if y is None and isinstance(x, (tuple, list)):
            x, y = x[0], x[1]
        return self.left <= x < self.right and self.top <= y < self.bottom

    def __iter__(self):
        return iter((self.x, self.y, self.width, self.height))

    def __repr__(self):
        return f"<rect({self.x}, {self.y}, {self.width}, {self.height})>"


class _PySurface:
    def __init__(self, size=(400, 280), is_screen=False, kind='blank', payload=None):
        self._w = int(size[0])
        self._h = int(size[1])
        self._is_screen = is_screen
        self._kind = kind
        self._payload = payload or {}

    def get_width(self): return self._w
    def get_height(self): return self._h
    def get_size(self): return (self._w, self._h)

    def get_rect(self, **kwargs):
        r = _PyRect(0, 0, self._w, self._h)
        for k, v in kwargs.items():
            setattr(r, k, v)
        return r

    def convert(self): return self
    def convert_alpha(self): return self

    def fill(self, color, rect=None):
        c = _norm_color(color)
        if self._is_screen:
            if rect is not None:
                rx, ry, rw, rh = _norm_rect(rect)
                _pywlet_frame_cmds.append(['rect', c, rx, ry, rw, rh, 0, 0])
            else:
                _pywlet_frame_cmds.append(['fill', c])
        else:
            self._kind = 'solid'
            self._payload = {'color': c}

    def blit(self, source, dest):
        if not self._is_screen:
            return
        if isinstance(dest, _PyRect):
            x, y = dest.x, dest.y
        else:
            x, y = float(dest[0]), float(dest[1])
        if source._kind == 'text':
            p = source._payload
            _pywlet_frame_cmds.append(['text', p['text'], x, y, p['size'], p['color'], p['family']])
        elif source._kind == 'image':
            p = source._payload
            _pywlet_frame_cmds.append([
                'image',
                p['path'],
                x,
                y,
                source._w,
                source._h,
                bool(p.get('flip_x', False)),
                bool(p.get('flip_y', False)),
                float(p.get('angle', 0.0)),
            ])
        elif source._kind == 'solid':
            _pywlet_frame_cmds.append(['rect', source._payload['color'], x, y, source._w, source._h, 0, 0])


class _PyFont:
    def __init__(self, family, size):
        self.family = family or 'monospace'
        self.size = int(size) if size else 18

    def render(self, text, antialias, color, background=None):
        s = str(text)
        est_w = max(8, int(len(s) * self.size * 0.62))
        est_h = max(10, int(self.size * 1.2))
        return _PySurface(
            (est_w, est_h),
            is_screen=False,
            kind='text',
            payload={'text': s, 'size': self.size, 'color': _norm_color(color), 'family': self.family},
        )


class _PySound:
    def __init__(self, path):
        self.path = str(path)
        self.volume = 0.7

    def set_volume(self, v):
        self.volume = max(0.0, min(1.0, float(v)))

    def play(self, loops=0):
        _pywlet_host.play_sound(self.path, self.volume)

    def stop(self):
        pass


class _PyEvent:
    def __init__(self, event_type, **kwargs):
        self.type = event_type
        for k, v in kwargs.items():
            setattr(self, k, v)


class _PyKeyState:
    def __getitem__(self, key_code):
        return bool(_pywlet_host.is_key_down(int(key_code)))


class _PyClock:
    def __init__(self):
        self._last = time.monotonic()
        self._fps = 60.0

    def tick(self, framerate=60):
        global _pywlet_clock_used
        _pywlet_clock_used = True
        fps = max(1.0, float(framerate or 60))
        target = 1.0 / fps
        now = time.monotonic()
        elapsed = now - self._last
        remain_ms = max(1, int((target - elapsed) * 1000))
        _pywlet_host.sleep_ms(remain_ms)
        after = time.monotonic()
        dt = after - self._last
        self._last = after
        if dt > 0:
            self._fps = 1.0 / dt
        return int(dt * 1000)

    def get_fps(self):
        return self._fps


def _build_pygame_module():
    pg = types.ModuleType('pygame')
    pg.Rect = _PyRect
    pg.Surface = _PySurface
    pg.Color = _PyColor

    # Event types
    pg.QUIT = 256
    pg.KEYDOWN = 768
    pg.KEYUP = 769
    pg.MOUSEBUTTONDOWN = 1025
    pg.MOUSEBUTTONUP = 1026
    pg.MOUSEMOTION = 1024

    # Key constants (mapped to shared input buffer slots)
    key_map = {
        'K_LEFT': 1, 'K_RIGHT': 2, 'K_UP': 3, 'K_DOWN': 4, 'K_SPACE': 5,
        'K_RETURN': 6, 'K_ESCAPE': 7, 'K_LSHIFT': 8, 'K_RSHIFT': 9,
        'K_BACKSPACE': 10, 'K_TAB': 11,
    }
    for i, ch in enumerate('abcdefghijklmnopqrstuvwxyz'):
        key_map[f'K_{ch}'] = 20 + i
    for i in range(10):
        key_map[f'K_{i}'] = 50 + i
    for k, v in key_map.items():
        setattr(pg, k, v)

    pg._initialized = False
    pg._screen = _PySurface((400, 280), is_screen=True)

    def init():
        pg._initialized = True
        return (6, 0)

    def quit_pg():
        pg._initialized = False

    def get_init():
        return pg._initialized

    pg.init = init
    pg.quit = quit_pg
    pg.get_init = get_init

    # pygame.display
    display = types.ModuleType('pygame.display')
    def set_mode(size=(400, 280), flags=0):
        w, h = int(size[0]), int(size[1])
        _pywlet_screen_size[0] = w
        _pywlet_screen_size[1] = h
        pg._screen = _PySurface((w, h), is_screen=True)
        _pywlet_frame_cmds.append(['resize', w, h])
        return pg._screen

    def set_caption(title):
        pass

    def flip():
        global _pywlet_frame_cmds, _pywlet_last_flip
        if _pywlet_frame_cmds:
            _pywlet_host.flush_frame(json.dumps(_pywlet_frame_cmds))
            _pywlet_frame_cmds = []
        _pywlet_host.check_stop()
        # Pace to ~60 FPS even if learner forgot clock.tick(60)
        if not _pywlet_clock_used:
            now = time.monotonic()
            if _pywlet_last_flip > 0.0:
                remain_ms = int((1.0 / 60.0 - (now - _pywlet_last_flip)) * 1000)
                if remain_ms > 0:
                    _pywlet_host.sleep_ms(remain_ms)
            _pywlet_last_flip = time.monotonic()

    display.set_mode = set_mode
    display.set_caption = set_caption
    display.flip = flip
    display.update = flip
    display.get_surface = lambda: pg._screen
    pg.display = display
    sys.modules['pygame.display'] = display

    # pygame.draw
    draw = types.ModuleType('pygame.draw')
    def draw_circle(surface, color, center, radius, width=0):
        _pywlet_frame_cmds.append(['circle', _norm_color(color), float(center[0]), float(center[1]), float(radius), int(width)])
        r = float(radius)
        return _PyRect(float(center[0]) - r, float(center[1]) - r, r * 2, r * 2)

    def draw_rect(surface, color, rect, width=0, border_radius=0):
        rx, ry, rw, rh = _norm_rect(rect)
        _pywlet_frame_cmds.append(['rect', _norm_color(color), rx, ry, rw, rh, int(width), int(border_radius)])
        return _PyRect(rx, ry, rw, rh)

    def draw_line(surface, color, start_pos, end_pos, width=1):
        _pywlet_frame_cmds.append(['line', _norm_color(color), float(start_pos[0]), float(start_pos[1]), float(end_pos[0]), float(end_pos[1]), int(width)])

    def draw_lines(surface, color, closed, points, width=1):
        pts = [[float(p[0]), float(p[1])] for p in points]
        _pywlet_frame_cmds.append(['polygon' if closed else 'lines', _norm_color(color), pts, int(width)])

    def draw_polygon(surface, color, points, width=0):
        pts = [[float(p[0]), float(p[1])] for p in points]
        _pywlet_frame_cmds.append(['polygon', _norm_color(color), pts, int(width)])

    def draw_ellipse(surface, color, rect, width=0):
        rx, ry, rw, rh = _norm_rect(rect)
        _pywlet_frame_cmds.append(['ellipse', _norm_color(color), rx, ry, rw, rh, int(width)])
        return _PyRect(rx, ry, rw, rh)

    draw.circle = draw_circle
    draw.rect = draw_rect
    draw.line = draw_line
    draw.lines = draw_lines
    draw.polygon = draw_polygon
    draw.ellipse = draw_ellipse
    pg.draw = draw
    sys.modules['pygame.draw'] = draw

    # pygame.key
    key_mod = types.ModuleType('pygame.key')
    key_state = _PyKeyState()
    key_mod.get_pressed = lambda: key_state
    pg.key = key_mod
    sys.modules['pygame.key'] = key_mod

    # pygame.mouse
    mouse_mod = types.ModuleType('pygame.mouse')
    mouse_mod.get_pos = lambda: tuple(_pywlet_host.get_mouse_pos())
    mouse_mod.get_pressed = lambda: tuple(_pywlet_host.get_mouse_buttons())
    pg.mouse = mouse_mod
    sys.modules['pygame.mouse'] = mouse_mod

    # pygame.event
    event_mod = types.ModuleType('pygame.event')
    def get_events():
        _pywlet_host.check_stop()
        raw = json.loads(_pywlet_host.drain_events())
        return [_PyEvent(ev['type'], **{k: v for k, v in ev.items() if k != 'type'}) for ev in raw]
    event_mod.get = get_events
    event_mod.pump = lambda: _pywlet_host.check_stop()
    pg.event = event_mod
    sys.modules['pygame.event'] = event_mod

    # pygame.time
    time_mod = types.ModuleType('pygame.time')
    time_mod.Clock = _PyClock
    time_mod.get_ticks = lambda: int(time.monotonic() * 1000.0 - _pywlet_start_ms)
    time_mod.delay = lambda ms: _pywlet_host.sleep_ms(max(1, int(ms)))
    time_mod.wait = time_mod.delay
    pg.time = time_mod
    sys.modules['pygame.time'] = time_mod

    # pygame.font
    font_mod = types.ModuleType('pygame.font')
    font_mod.init = lambda: None
    font_mod.SysFont = lambda name, size, bold=False, italic=False: _PyFont(name or 'monospace', size)
    font_mod.Font = lambda name, size: _PyFont(name or 'monospace', size)
    pg.font = font_mod
    sys.modules['pygame.font'] = font_mod

    # pygame.image
    image_mod = types.ModuleType('pygame.image')
    def load_image(path):
        dims = json.loads(_pywlet_host.get_image_size(str(path)))
        return _PySurface((dims[0], dims[1]), is_screen=False, kind='image', payload={'path': str(path)})
    image_mod.load = load_image
    pg.image = image_mod
    sys.modules['pygame.image'] = image_mod

    # pygame.transform
    transform_mod = types.ModuleType('pygame.transform')
    def scale_surf(surf, size):
        return _PySurface(size, is_screen=False, kind=surf._kind, payload=dict(surf._payload))
    def flip_surf(surf, fx, fy):
        p = dict(surf._payload)
        p['flip_x'] = bool(fx) ^ bool(p.get('flip_x', False))
        p['flip_y'] = bool(fy) ^ bool(p.get('flip_y', False))
        return _PySurface(surf.get_size(), is_screen=False, kind=surf._kind, payload=p)
    def rotate_surf(surf, angle):
        p = dict(surf._payload)
        p['angle'] = float(p.get('angle', 0.0)) + float(angle)
        return _PySurface(surf.get_size(), is_screen=False, kind=surf._kind, payload=p)
    transform_mod.scale = scale_surf
    transform_mod.flip = flip_surf
    transform_mod.rotate = rotate_surf
    pg.transform = transform_mod
    sys.modules['pygame.transform'] = transform_mod

    # pygame.mixer
    mixer_mod = types.ModuleType('pygame.mixer')
    mixer_mod.init = lambda *a, **kw: None
    mixer_mod.Sound = _PySound
    pg.mixer = mixer_mod
    sys.modules['pygame.mixer'] = mixer_mod

    return pg


_pygame_mod = _build_pygame_module()
sys.modules['pygame'] = _pygame_mod


# Built-in Pywlet convenience helpers available globally in learner scripts
def _pywlet_draw_sprite(screen, sprite_idx, x, y, scale=4, sheet_name=None):
    _pywlet_frame_cmds.append([
        'sprite', int(sprite_idx), float(x), float(y), max(1, float(scale)), sheet_name
    ])

def _pywlet_draw_tilemap(screen, scale=4, map_name=None):
    _pywlet_frame_cmds.append(['tilemap', max(1, float(scale)), map_name])

def _pywlet_draw_text(screen, text, x, y, size=18, color=(248, 250, 252), font_name='monospace'):
    _pywlet_frame_cmds.append(['text', str(text), float(x), float(y), int(size), _norm_color(color), str(font_name)])

def _pywlet_play_sound(path, volume=0.7):
    _pywlet_host.play_sound(str(path), float(volume))

builtins.draw_sprite = _pywlet_draw_sprite
builtins.draw_tilemap = _pywlet_draw_tilemap
builtins.draw_text = _pywlet_draw_text
builtins.play_sound = _pywlet_play_sound


def _pywlet_reset_runtime_state():
    global _pywlet_frame_cmds, _pywlet_start_ms, _pywlet_last_flip, _pywlet_clock_used
    _pywlet_frame_cmds = []
    _pywlet_start_ms = time.monotonic() * 1000.0
    _pywlet_last_flip = 0.0
    _pywlet_clock_used = False


# =============================================================================
# 3. COOPERATIVE ASYNC FALLBACK (WHEN SharedArrayBuffer IS UNAVAILABLE)
# =============================================================================
import asyncio

async def _pywlet_async_frame_yield():
    _pywlet_host.check_stop()
    await asyncio.sleep(0.016)
    _pywlet_host.check_stop()


class _AsyncYieldTransformer(ast.NodeTransformer):
    def __init__(self):
        self.async_funcs = set()

    def _make_yield_stmt(self, lineno):
        stmt = ast.Expr(
            value=ast.Await(
                value=ast.Call(
                    func=ast.Name(id='_pywlet_async_frame_yield', ctx=ast.Load()),
                    args=[],
                    keywords=[],
                )
            )
        )
        stmt.lineno = lineno
        stmt.col_offset = 0
        return stmt

    def _contains_while(self, nodes):
        for n in nodes:
            for sub in ast.walk(n):
                if isinstance(sub, ast.While):
                    return True
        return False

    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        if self._contains_while(node.body):
            self.async_funcs.add(node.name)
            async_fn = ast.AsyncFunctionDef(
                name=node.name,
                args=node.args,
                body=node.body,
                decorator_list=node.decorator_list,
                returns=node.returns,
                type_comment=node.type_comment,
                type_params=getattr(node, 'type_params', []),
            )
            return ast.copy_location(async_fn, node)
        return node

    def visit_While(self, node):
        self.generic_visit(node)
        node.body.append(self._make_yield_stmt(node.lineno))
        return node

    def visit_Call(self, node):
        self.generic_visit(node)
        if isinstance(node.func, ast.Name) and node.func.id in self.async_funcs:
            return ast.copy_location(ast.Await(value=node), node)
        return node


async def _pywlet_run_async_fallback(code, filename='main.py'):
    tree = ast.parse(code, filename=filename)
    transformer = _AsyncYieldTransformer()
    tree = transformer.visit(tree)

    wrapper = ast.Module(
        body=[
            ast.AsyncFunctionDef(
                name='__pywlet_main__',
                args=ast.arguments(
                    posonlyargs=[],
                    args=[],
                    vararg=None,
                    kwonlyargs=[],
                    kw_defaults=[],
                    kwarg=None,
                    defaults=[],
                ),
                body=tree.body or [ast.Pass()],
                decorator_list=[],
                returns=None,
                type_params=[],
            )
        ],
        type_ignores=[],
    )
    ast.fix_missing_locations(wrapper)
    ns = {
        '__name__': '__main__',
        '__file__': filename,
        '_pywlet_async_frame_yield': _pywlet_async_frame_yield,
    }
    compiled = compile(wrapper, filename, 'exec')
    exec(compiled, ns, ns)
    await ns['__pywlet_main__']()
`;
