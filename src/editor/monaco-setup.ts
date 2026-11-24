import * as monaco from 'monaco-editor';
import type { PythonDiagnostic } from '../diagnostics/python-coach';

export interface EditorCursorContext {
  selectedText: string;
  cursorWord: string;
  lineNumber: number;
  lineText: string;
}

export class CodeEditorController {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private model: monaco.editor.ITextModel;
  private onCodeChangeCallback?: (code: string) => void;
  private onAskTutorCallback?: (ctx: EditorCursorContext) => void;
  private onToggleBreakpointCallback?: (lineNumber: number) => void;
  private breakpointDecorations: monaco.editor.IEditorDecorationsCollection;
  private executionLineDecorations: monaco.editor.IEditorDecorationsCollection;
  private suppressChangeEvent = false;
  private readOnly = false;

  constructor(
    container: HTMLElement,
    initialCode: string,
    onCodeChange?: (code: string) => void,
    onAskTutor?: (ctx: EditorCursorContext) => void,
    onToggleBreakpoint?: (lineNumber: number) => void
  ) {
    this.onCodeChangeCallback = onCodeChange;
    this.onAskTutorCallback = onAskTutor;
    this.onToggleBreakpointCallback = onToggleBreakpoint;

    this.model = monaco.editor.createModel(initialCode, 'python');

    this.editor = monaco.editor.create(container, {
      model: this.model,
      theme: 'vs-dark',
      fontSize: 15,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      lineNumbers: 'on',
      glyphMargin: true,
      roundedSelection: true,
      scrollBeyondLastLine: false,
      minimap: { enabled: false },
      automaticLayout: true,
      tabSize: 4,
      insertSpaces: true,
      padding: { top: 12, bottom: 12 },
      // Disable aggressive ghost-text completions; keep simple keyword discovery
      inlineSuggest: { enabled: false },
      quickSuggestions: { other: true, comments: false, strings: false },
    });

    this.breakpointDecorations = this.editor.createDecorationsCollection();
    this.executionLineDecorations = this.editor.createDecorationsCollection();

    // Clicking the left glyph margin toggles a red breakpoint dot on that line
    this.editor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN ||
        e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS
      ) {
        const line = e.target.position?.lineNumber;
        if (line && line > 0) {
          this.onToggleBreakpointCallback?.(line);
        }
      }
    });

    this.model.onDidChangeContent(() => {
      if (this.suppressChangeEvent) return;
      this.onCodeChangeCallback?.(this.model.getValue());
    });

    // Register Context Menu Action: "🦉 Ask Pywlet Tutor to Explain This"
    this.editor.addAction({
      id: 'pywlet.explainUnderCursor',
      label: '🦉 Ask Pywlet Tutor: Explain This Code',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyE],
      contextMenuGroupId: 'navigation',
      contextMenuOrder: 1.5,
      run: () => {
        this.onAskTutorCallback?.(this.getCursorContext());
      },
    });
  }

  getValue(): string {
    return this.model.getValue();
  }

  setValue(code: string): void {
    this.suppressChangeEvent = true;
    try {
      this.model.setValue(code);
    } finally {
      this.suppressChangeEvent = false;
    }
  }

  setReadOnly(readOnly: boolean, message?: string): void {
    this.readOnly = readOnly;
    this.editor.updateOptions({
      readOnly,
      readOnlyMessage: {
        value:
          message ||
          '🔒 sprites_data.py is write-protected so the Visual Sprite Editor can always parse it. Click "🔓 Unlock Manual Edit" above to edit by hand.',
      },
    });
  }

  isReadOnly(): boolean {
    return this.readOnly;
  }

  layout(): void {
    this.editor.layout();
  }

  setTheme(themeName: string): void {
    monaco.editor.setTheme(themeName);
  }

  getCursorContext(): EditorCursorContext {
    const pos = this.editor.getPosition() || new monaco.Position(1, 1);
    const selection = this.editor.getSelection();
    const selectedText =
      selection && !selection.isEmpty() ? this.model.getValueInRange(selection) : '';
    const wordAtPos = this.model.getWordAtPosition(pos);
    const lineText = this.model.getLineContent(pos.lineNumber);

    return {
      selectedText,
      cursorWord: wordAtPos?.word || '',
      lineNumber: pos.lineNumber,
      lineText,
    };
  }

  insertSnippetAtCursor(snippet: string): void {
    const selection = this.editor.getSelection();
    if (!selection) return;
    this.editor.executeEdits('asset-insert', [
      {
        range: selection,
        text: snippet,
        forceMoveMarkers: true,
      },
    ]);
    this.editor.focus();
  }

  /**
   * Renders red/amber squiggles in Monaco from our learner diagnostic engine.
   */
  setDiagnostics(diagnostics: PythonDiagnostic[]): void {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map((d) => ({
      severity:
        d.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : d.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : monaco.MarkerSeverity.Info,
      message: `${d.title}\n\n💡 ${d.friendlyExplanation}`,
      startLineNumber: d.line,
      startColumn: d.column,
      endLineNumber: d.line,
      endColumn: d.endColumn,
    }));

    monaco.editor.setModelMarkers(this.model, 'pywlet-coach', markers);
  }

  /**
   * Renders red breakpoint dots in the Monaco glyph margin for the currently open file.
   */
  setBreakpointLines(lines: number[]): void {
    const lineCount = this.model.getLineCount();
    const decorations: monaco.editor.IModelDeltaDecoration[] = lines
      .filter((ln) => ln >= 1 && ln <= lineCount)
      .map((ln) => ({
        range: new monaco.Range(ln, 1, ln, 1),
        options: {
          isWholeLine: false,
          glyphMarginClassName: 'debug-breakpoint-glyph',
          glyphMarginHoverMessage: { value: `Breakpoint on line ${ln} (click to remove)` },
        },
      }));
    this.breakpointDecorations.set(decorations);
  }

  /**
   * Highlights the active paused execution line in Monaco and scrolls it into view.
   */
  setDebugExecutionLine(lineNumber: number | null): void {
    if (!lineNumber || lineNumber < 1 || lineNumber > this.model.getLineCount()) {
      this.executionLineDecorations.clear();
      return;
    }
    this.executionLineDecorations.set([
      {
        range: new monaco.Range(lineNumber, 1, lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'debug-current-line',
          glyphMarginClassName: 'debug-current-line-glyph',
          glyphMarginHoverMessage: { value: `Paused before running line ${lineNumber}` },
        },
      },
    ]);
    this.editor.revealLineInCenterIfOutsideViewport(lineNumber);
  }

  revealLine(lineNumber: number): void {
    if (lineNumber < 1 || lineNumber > this.model.getLineCount()) return;
    this.editor.revealLineInCenter(lineNumber);
    this.editor.setPosition({ lineNumber, column: 1 });
  }
}
