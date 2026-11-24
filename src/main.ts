import { CodeEditorController } from './editor/monaco-setup';
import { analyzePythonCodeForLearners, type PythonDiagnostic } from './diagnostics/python-coach';
import { PythonPygameRuntime } from './runtime/python-runtime';
import type {
  DebugEvalResult,
  DebugPausePayload,
  DebugVariableNode,
} from './runtime/debug-types';
import { TutorService } from './llm/tutor-service';
import type { LLMBackendId, LLMDebugEvent, TutorCodeContext } from './llm/types';
import {
  CHEATSHEETS,
  classifyWorkspaceFile,
  fileToDataUrl,
  getDefaultSpritesDataPy,
  STARTER_TEMPLATES,
  WorkspaceStore,
} from './workspace/templates';
import { createBlankPngDataUrl } from './workspace/starter-assets';
import { createStarterSoundWav } from './audio-editor/wav-codec';
import { SpriteEditorController } from './sprite-editor/sprite-editor';
import { WavEditorController } from './audio-editor/wav-editor';
import { initPwa } from './pwa/register-pwa';
import { UiTourOverlay } from './ui/tour-overlay';
import { AppearanceController, type PywletThemeId } from './ui/appearance';

function formatSimpleMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

async function bootstrapPywlet(): Promise<void> {
  const workspace = new WorkspaceStore();
  await workspace.init();

  let currentDiagnostics: PythonDiagnostic[] = [];
  let activeBannerDiagnostic: PythonDiagnostic | null = null;
  let lintDebounceTimer: number | null = null;
  let lintRequestCounter = 0;
  let sidebarMode: 'files' | 'browser' | 'history' | 'debug' = 'files';
  let spriteSheetViewMode: 'visual' | 'code' = 'visual';
  let spriteDataWriteProtected = true;

  // Step Debugger UI state
  let breakpointsByFile: Record<string, number[]> = {};
  let activeDebugPause: DebugPausePayload | null = null;
  let prevDebugVarMap: Map<string, string> = new Map();
  let lastDebugChangedMap: Map<string, string> = new Map();
  const expandedDebugPaths = new Set<string>();
  let slowMoActive = false;
  let slowMoTimer: number | null = null;

  // DOM Elements
  const workspaceEl = document.querySelector('.workspace') as HTMLElement;
  const resizerLeftEl = document.getElementById('resizer-left')!;
  const resizerRightEl = document.getElementById('resizer-right')!;
  const monacoContainer = document.getElementById('monaco-container')!;
  const spriteStudioContainer = document.getElementById('sprite-studio-container')!;
  const wavEditorContainer = document.getElementById('wav-editor-container')!;

  const themeSelect = document.getElementById('theme-select') as HTMLSelectElement;
  const btnToggleIcons = document.getElementById('btn-toggle-icons')!;
  const sidebarWorkspaceNameEl = document.getElementById('sidebar-workspace-name')!;
  const btnTabFiles = document.getElementById('btn-tab-files')!;
  const btnToggleWorkspaceBrowser = document.getElementById('btn-toggle-workspace-browser')!;
  const btnToggleCheckpoints = document.getElementById('btn-toggle-checkpoints')!;
  const btnTabDebug = document.getElementById('btn-tab-debug')!;
  const workspaceBrowserPanel = document.getElementById('workspace-browser-panel')!;
  const workspaceHistoryPanel = document.getElementById('workspace-history-panel')!;
  const workspaceDebugPanel = document.getElementById('workspace-debug-panel')!;
  const workspaceFilesPanel = document.getElementById('workspace-files-panel')!;
  const cheatsheetSectionEl = document.getElementById('cheatsheet-section')!;
  const savedWorkspacesListEl = document.getElementById('saved-workspaces-list')!;
  const savedWorkspacesCountEl = document.getElementById('saved-workspaces-count')!;
  const exampleWorkspacesListEl = document.getElementById('example-workspaces-list')!;
  const btnNewEmptyWorkspace = document.getElementById('btn-new-empty-workspace')!;
  const checkpointForm = document.getElementById('checkpoint-form') as HTMLFormElement;
  const inputCheckpointLabel = document.getElementById('input-checkpoint-label') as HTMLInputElement;
  const checkpointsCountEl = document.getElementById('checkpoints-count')!;
  const checkpointsListEl = document.getElementById('checkpoints-list')!;

  // Step Debugger DOM elements
  const debugToolbarEl = document.getElementById('debug-toolbar')!;
  const debugToolbarStatusEl = document.getElementById('debug-toolbar-status')!;
  const btnDbgContinue = document.getElementById('btn-dbg-continue') as HTMLButtonElement;
  const btnDbgStepOver = document.getElementById('btn-dbg-step-over') as HTMLButtonElement;
  const btnDbgStepInto = document.getElementById('btn-dbg-step-into') as HTMLButtonElement;
  const btnDbgStepOut = document.getElementById('btn-dbg-step-out') as HTMLButtonElement;
  const btnDbgSlowMo = document.getElementById('btn-dbg-slowmo') as HTMLButtonElement;
  const debugLocationMetaEl = document.getElementById('debug-location-meta')!;
  const debugVarsContainerEl = document.getElementById('debug-vars-container')!;
  const debugEvalSectionEl = document.getElementById('debug-eval-section')!;
  const debugEvalForm = document.getElementById('debug-eval-form') as HTMLFormElement;
  const inputDebugEval = document.getElementById('input-debug-eval') as HTMLInputElement;
  const debugEvalOutputEl = document.getElementById('debug-eval-output')!;
  const debugStackSectionEl = document.getElementById('debug-stack-section')!;
  const debugStackListEl = document.getElementById('debug-stack-list')!;
  const debugBreakpointsListEl = document.getElementById('debug-breakpoints-list')!;
  const btnClearBreakpoints = document.getElementById('btn-clear-breakpoints')!;

  const fileListEl = document.getElementById('file-list')!;
  const newFileToolbarEl = document.getElementById('new-file-toolbar')!;
  const labelImportFileEl = document.getElementById('label-import-workspace-file')!;
  const btnCloneExampleSidebar = document.getElementById('btn-clone-example-sidebar')!;
  const readonlyWorkspaceBannerEl = document.getElementById('readonly-workspace-banner')!;
  const btnCloneActiveExample = document.getElementById('btn-clone-active-example')!;
  const activeFileIconEl = document.getElementById('active-file-icon')!;
  const activeFilenameEl = document.getElementById('active-filename')!;
  const spriteSheetSubtabsEl = document.getElementById('sprite-sheet-subtabs')!;
  const tabSpriteVisual = document.getElementById('tab-sprite-visual')!;
  const tabSpriteCode = document.getElementById('tab-sprite-code')!;
  const protectedFileBannerEl = document.getElementById('protected-file-banner')!;
  const protectedBannerTitleEl = document.getElementById('protected-banner-title')!;
  const protectedBannerDescEl = document.getElementById('protected-banner-desc')!;
  const btnToggleWriteProtect = document.getElementById('btn-toggle-write-protect')!;

  const syntaxBadgeEl = document.getElementById('syntax-badge')!;
  const codeEditorActionsEl = document.getElementById('code-editor-actions')!;
  const diagnosticBannerEl = document.getElementById('live-diagnostic-banner')!;
  const diagnosticTitleEl = document.getElementById('diagnostic-title')!;
  const diagnosticMessageEl = document.getElementById('diagnostic-message')!;
  const consoleOutputEl = document.getElementById('console-output')!;
  const canvasWrapperEl = document.getElementById('canvas-wrapper')!;
  const theaterToolbarEl = document.getElementById('theater-toolbar')!;
  const canvasEl = document.getElementById('pygame-canvas') as HTMLCanvasElement;
  const canvasOverlayEl = document.getElementById('canvas-overlay')!;
  const canvasCoordsEl = document.getElementById('canvas-coords')!;
  const runtimeStatusEl = document.getElementById('runtime-status')!;
  const cheatsheetContentEl = document.getElementById('cheatsheet-content')!;

  // Layout & Full Window / Fullscreen Controls
  const btnToggleLeftPanel = document.getElementById('btn-toggle-left-panel')!;
  const btnFocusMode = document.getElementById('btn-focus-mode')!;
  const btnToggleRightPanel = document.getElementById('btn-toggle-right-panel')!;
  const btnExpandGame = document.getElementById('btn-expand-game')!;
  const btnFullscreenGame = document.getElementById('btn-fullscreen-game')!;
  const btnTheaterRestart = document.getElementById('btn-theater-restart')!;
  const btnTheaterExit = document.getElementById('btn-theater-exit')!;

  // Buttons & Controls
  const btnOpenFolder = document.getElementById('btn-open-folder')!;
  const btnStartTour = document.getElementById('btn-start-tour')!;
  const btnNewPy = document.getElementById('btn-new-py')!;
  const btnNewPng = document.getElementById('btn-new-png')!;
  const btnNewWav = document.getElementById('btn-new-wav')!;
  const btnNewSpritesSheet = document.getElementById('btn-new-sprites-sheet')!;
  const inputImportFile = document.getElementById('input-import-workspace-file') as HTMLInputElement;
  const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
  const btnDebug = document.getElementById('btn-debug') as HTMLButtonElement;
  const btnPause = document.getElementById('btn-pause') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
  const btnExplainSelection = document.getElementById('btn-explain-selection')!;
  const btnAskDiagnostic = document.getElementById('btn-ask-diagnostic')!;
  const btnClearConsole = document.getElementById('btn-clear-console')!;

  // Tutor & AI Debug UI
  const btnToggleAiSetup = document.getElementById('btn-toggle-ai-setup')!;
  const aiSetupDrawerEl = document.getElementById('ai-setup-drawer')!;
  const tutorMiniStatusEl = document.getElementById('tutor-mini-status')!;
  const llmBackendSelect = document.getElementById('llm-backend-select') as HTMLSelectElement;
  const localServerConfigRow = document.getElementById('local-server-config-row')!;
  const inputLocalServerUrl = document.getElementById('input-local-server-url') as HTMLInputElement;
  const inputLocalServerKey = document.getElementById('input-local-server-key') as HTMLInputElement;
  const btnLoadModel = document.getElementById('btn-load-model')!;
  const llmStatusTextEl = document.getElementById('llm-status-text')!;
  const tutorMessagesEl = document.getElementById('tutor-messages')!;
  const tutorForm = document.getElementById('tutor-form') as HTMLFormElement;
  const tutorInput = document.getElementById('tutor-input') as HTMLInputElement;

  const btnToggleDebug = document.getElementById('btn-toggle-debug')!;
  const aiDebugPanelEl = document.getElementById('ai-debug-panel')!;
  const gpuDeviceBadgeEl = document.getElementById('gpu-device-badge')!;
  const llmPerfBadgeEl = document.getElementById('llm-perf-badge')!;
  const btnAiSetupHelp = document.getElementById('btn-ai-setup-help')!;
  const btnCloseFlagsHelp = document.getElementById('btn-close-flags-help')!;
  const btnWebgpuHelp = document.getElementById('btn-webgpu-help')!;
  const chromeFlagsHelpDrawerEl = document.getElementById('chrome-flags-help-drawer')!;
  const btnClearDebug = document.getElementById('btn-clear-debug')!;
  const aiDebugLogEl = document.getElementById('ai-debug-log')!;
  const aiDebugStreamEl = document.getElementById('ai-debug-stream')!;

  function appendConsole(line: string): void {
    consoleOutputEl.textContent += `\n${line}`;
    consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
  }

  function appendDebugLog(event: LLMDebugEvent): void {
    if (event.data?.device) {
      const isGpu = event.data.device === 'webgpu';
      gpuDeviceBadgeEl.textContent = isGpu
        ? `⚡ WebGPU: ${event.data.adapterInfo || 'Hardware Active'}`
        : `⚙️ ${event.data.adapterInfo || 'SIMD WASM'}`;
      gpuDeviceBadgeEl.className = isGpu ? 'badge badge-ok' : 'badge badge-warn';
    }

    if (event.data?.tokensPerSec) {
      llmPerfBadgeEl.textContent = `${event.data.tokensPerSec} tok/s (${event.data.tokenCount || 0} tok)`;
    } else if (event.stage === 'prefill' && event.data?.elapsedMs) {
      llmPerfBadgeEl.textContent = `Prefill: ${event.data.elapsedMs}ms`;
    }

    if (event.stage === 'prompt-sent') {
      aiDebugStreamEl.textContent = '⏳ Waiting for first token from model...';
      const preview = event.data?.promptPreview || '';
      const line = `[${event.timestamp}] 📤 ${event.detail}\n--- Prompt Sent ---\n${preview}\n-------------------\n`;
      aiDebugLogEl.textContent =
        aiDebugLogEl.textContent === 'Waiting for AI activity...'
          ? line
          : `${aiDebugLogEl.textContent}\n${line}`;
      aiDebugLogEl.scrollTop = aiDebugLogEl.scrollHeight;
      return;
    }

    if (event.stage === 'token-stream') {
      if (event.data?.rawReply !== undefined) {
        aiDebugStreamEl.textContent = event.data.rawReply;
        aiDebugStreamEl.scrollTop = aiDebugStreamEl.scrollHeight;
      }
      return;
    }

    const entry = `[${event.timestamp}] [${event.stage}] ${event.detail}`;
    aiDebugLogEl.textContent =
      aiDebugLogEl.textContent === 'Waiting for AI activity...'
        ? entry
        : `${aiDebugLogEl.textContent}\n${entry}`;
    aiDebugLogEl.scrollTop = aiDebugLogEl.scrollHeight;
  }

  // 1. Initialize Modular Local AI Tutor Service
  const tutor = new TutorService(
    (progress) => {
      llmStatusTextEl.textContent = progress.message;
      if (progress.status === 'ready') {
        tutorMiniStatusEl.textContent = '⚡ AI Ready';
        tutorMiniStatusEl.className = 'badge badge-ok';
      } else if (progress.status === 'downloading') {
        tutorMiniStatusEl.textContent =
          typeof progress.percent === 'number' ? `⬇ ${progress.percent}%` : '⬇ Downloading…';
        tutorMiniStatusEl.className = 'badge badge-warn';
      } else if (progress.status === 'loading') {
        tutorMiniStatusEl.textContent = '⏳ Loading…';
        tutorMiniStatusEl.className = 'badge badge-warn';
      } else if (progress.status === 'generating') {
        tutorMiniStatusEl.textContent = '✨ Thinking…';
        tutorMiniStatusEl.className = 'badge badge-ok';
      } else if (progress.status === 'error') {
        tutorMiniStatusEl.textContent = '⚠️ AI Setup';
        tutorMiniStatusEl.className = 'badge badge-err';
      } else {
        tutorMiniStatusEl.textContent = 'Instant Coach';
        tutorMiniStatusEl.className = 'badge badge-ok';
      }
    },
    (debugEvent) => {
      appendDebugLog(debugEvent);
    }
  );
  tutor.probeGPU();

  // 2. Initialize Editors (Monaco, Sprite/PNG Studio, WAV Audio Studio)
  const editor = new CodeEditorController(
    monacoContainer,
    '',
    (updatedCode) => {
      if (workspace.isActiveWorkspaceReadOnly()) {
        return;
      }
      const activeName = workspace.getActiveFileName();
      const kind = classifyWorkspaceFile(activeName, workspace.getFileContent(activeName));
      if (kind === 'sprite-sheet' && spriteDataWriteProtected) {
        return;
      }
      workspace.updateActiveFileContent(updatedCode);
      if (sidebarMode === 'history') {
        renderCheckpointsPanel();
      }
      if (kind === 'python') {
        runLiveDiagnostics(updatedCode);
      } else if (kind === 'sprite-sheet') {
        // Keep Sprite Studio synced when manually unlocked
        spriteEditor.loadFromPythonString(updatedCode, activeName);
      }
    },
    (cursorCtx) => {
      const target = cursorCtx.selectedText || cursorCtx.cursorWord || cursorCtx.lineText.trim();
      askTutorQuestion(`Can you explain what \`${target}\` on line ${cursorCtx.lineNumber} does in my code?`);
    },
    (lineNumber) => {
      toggleBreakpointOnActiveFile(lineNumber);
    }
  );

  const spriteEditor = new SpriteEditorController(spriteStudioContainer, {
    onSaveToPythonFile: (filename, pyCode) => {
      workspace.setFileContent(filename, pyCode);
      if (workspace.getActiveFileName() === filename && spriteSheetViewMode === 'code') {
        editor.setValue(pyCode);
      }
      renderFileList();
      if (sidebarMode === 'history') renderCheckpointsPanel();
    },
    onReadPythonFile: (filename) => workspace.getFileContent(filename),
    onSavePngFile: (filename, dataUrl) => {
      workspace.setFileContent(filename, dataUrl);
      renderFileList();
      if (sidebarMode === 'history') renderCheckpointsPanel();
    },
  });

  const wavEditor = new WavEditorController(wavEditorContainer, {
    onSaveWavFile: (filename, dataUrl) => {
      workspace.setFileContent(filename, dataUrl);
      renderFileList();
      if (sidebarMode === 'history') renderCheckpointsPanel();
    },
  });

  function syncSpriteProjectFromWorkspace(): void {
    const files = workspace.getFiles();
    const spriteFile = Object.keys(files).find(
      (f) => classifyWorkspaceFile(f, files[f]) === 'sprite-sheet'
    );
    if (spriteFile && files[spriteFile]) {
      spriteEditor.loadFromPythonString(files[spriteFile], spriteFile);
    }
  }

  // 3. Initialize Python + Pygame Canvas Runtime
  const runtime = new PythonPygameRuntime(canvasEl, {
    getSpriteProjectData: () => spriteEditor.getProjectData(),
    getWorkspaceFile: (filename) => workspace.getFileContent(filename),
    onStdout: (line) => appendConsole(line),
    onStderr: (line, friendly) => {
      appendConsole(`❌ ${line}`);
      if (friendly) {
        showDiagnosticBanner({
          line: friendly.line,
          column: 1,
          endColumn: 20,
          severity: 'error',
          title: `Runtime Error on Line ${friendly.line}`,
          friendlyExplanation: friendly.message,
        });
      }
    },
    onStatusChange: (status) => {
      if (status === 'running') {
        runtimeStatusEl.textContent = 'Python 3.14 Running (60 FPS)';
        runtimeStatusEl.className = 'status-pill status-running';
        btnStop.disabled = false;
        btnPause.classList.toggle('hidden', !runtime.isDebugSupported());
        canvasOverlayEl.classList.add('hidden');
      } else if (status === 'paused') {
        runtimeStatusEl.textContent = '⏸ Paused (Debug)';
        runtimeStatusEl.className = 'status-pill status-paused';
        btnStop.disabled = false;
        btnPause.classList.add('hidden');
        canvasOverlayEl.classList.add('hidden');
      } else if (status === 'loading') {
        runtimeStatusEl.textContent = 'Loading Python (Pyodide)...';
        runtimeStatusEl.className = 'status-pill status-ready';
        btnStop.disabled = !runtime.isRunning();
        btnPause.classList.add('hidden');
      } else {
        runtimeStatusEl.textContent = runtime.isPyodideReady() ? 'Python 3.14 Ready' : 'Python Ready';
        runtimeStatusEl.className = 'status-pill status-ready';
        btnStop.disabled = true;
        btnPause.classList.add('hidden');
      }
    },
    onDebugPaused: (payload) => {
      handleDebugPaused(payload);
    },
    onDebugResumed: () => {
      handleDebugResumed();
    },
    onDebugEvalResult: (res) => {
      renderDebugEvalResult(res);
    },
    onPyodideReady: () => {
      // Immediately run authentic CPython AST lint on the currently open Python file
      const activeName = workspace.getActiveFileName();
      if (classifyWorkspaceFile(activeName, workspace.getFileContent(activeName)) === 'python') {
        runLiveDiagnostics(editor.getValue(), true);
      }
    },
  });

  // 4. Live Diagnostics & Friendly Error Coach
  function showDiagnosticBanner(diag: PythonDiagnostic | null): void {
    activeBannerDiagnostic = diag;
    if (!diag) {
      diagnosticBannerEl.classList.add('hidden');
      return;
    }
    diagnosticBannerEl.classList.remove('hidden');
    diagnosticTitleEl.textContent = `🐞 Line ${diag.line} (${diag.title}):`;
    diagnosticMessageEl.textContent = diag.friendlyExplanation;
  }

  function applyDiagnosticsToUI(diags: PythonDiagnostic[]): void {
    currentDiagnostics = diags;
    editor.setDiagnostics(diags);

    if (diags.length === 0) {
      syntaxBadgeEl.textContent = '✓ No Syntax Issues';
      syntaxBadgeEl.className = 'badge badge-ok';
      showDiagnosticBanner(null);
    } else {
      const first = diags[0];
      syntaxBadgeEl.textContent = `${diags.length} Issue${
        diags.length > 1 ? 's' : ''
      } (Line ${first.line})`;
      syntaxBadgeEl.className =
        first.severity === 'error' ? 'badge badge-err' : 'badge badge-warn';
      showDiagnosticBanner(first);
    }
  }

  function runLiveDiagnostics(code: string, immediate = false): void {
    const filename = workspace.getActiveFileName();
    if (lintDebounceTimer !== null) {
      window.clearTimeout(lintDebounceTimer);
      lintDebounceTimer = null;
    }

    // While Pyodide is still booting (first ~1s) or running a 60 FPS game loop,
    // keep instant feedback via the lightweight fallback coach.
    if (!runtime.isPyodideReady() || runtime.isRunning()) {
      applyDiagnosticsToUI(analyzePythonCodeForLearners(code));
      return;
    }

    const reqToken = ++lintRequestCounter;
    const execLint = async () => {
      const diags = await runtime.lintCode(code, filename);
      if (reqToken !== lintRequestCounter) return;
      if (diags !== null) {
        applyDiagnosticsToUI(diags);
      }
    };

    if (immediate) {
      void execLint();
    } else {
      lintDebounceTimer = window.setTimeout(() => {
        lintDebounceTimer = null;
        void execLint();
      }, 160);
    }
  }

  // 5. Center Pane Unified File Router
  function updateProtectedBannerUI(): void {
    if (spriteDataWriteProtected) {
      protectedFileBannerEl.classList.remove('unlocked');
      protectedBannerTitleEl.textContent = '🔒 Write-Protected (Read-Only):';
      protectedBannerDescEl.innerHTML =
        '<code>sprites_data.py</code> is protected so the Visual Sprite &amp; Map Studio can always parse it safely.';
      btnToggleWriteProtect.textContent = '🔓 Unlock Manual Editing';
      tabSpriteCode.textContent = '🔒 Code View';
    } else {
      protectedFileBannerEl.classList.add('unlocked');
      protectedBannerTitleEl.textContent = '⚠️ Manual Editing Unlocked:';
      protectedBannerDescEl.innerHTML =
        'Be careful to keep <code>PALETTE</code>, <code>SPRITE_SHEETS</code>, and <code>TILEMAPS</code> valid Python so Visual Studio can parse them.';
      btnToggleWriteProtect.textContent = '🔒 Re-lock Protection';
      tabSpriteCode.textContent = '🔓 Code View (Unlocked)';
    }
  }

  function openActiveFileInEditor(resetSpriteSubtab = true): void {
    const filename = workspace.getActiveFileName();
    const content = workspace.getActiveFileContent();
    const kind = classifyWorkspaceFile(filename, content);
    const isWsReadOnly = workspace.isActiveWorkspaceReadOnly();

    wavEditor.stopPlayback();
    activeFilenameEl.textContent = filename;

    // Sync playspace read-only state across banners and editors
    readonlyWorkspaceBannerEl.classList.toggle('hidden', !isWsReadOnly);
    spriteEditor.setReadOnly(isWsReadOnly);
    wavEditor.setReadOnly(isWsReadOnly);

    // Reset all editor containers
    monacoContainer.classList.add('hidden');
    spriteStudioContainer.classList.add('hidden');
    wavEditorContainer.classList.add('hidden');
    spriteSheetSubtabsEl.classList.add('hidden');
    protectedFileBannerEl.classList.add('hidden');
    syntaxBadgeEl.classList.add('hidden');
    codeEditorActionsEl.classList.add('hidden');
    showDiagnosticBanner(null);

    if (kind === 'python') {
      activeFileIconEl.textContent = '🐍';
      monacoContainer.classList.remove('hidden');
      syntaxBadgeEl.classList.remove('hidden');
      codeEditorActionsEl.classList.remove('hidden');
      editor.setReadOnly(
        isWsReadOnly || Boolean(activeDebugPause),
        activeDebugPause
          ? '⏸ Paused in Step Debugger — click ⏹ Stop to edit your code!'
          : '📖 This is a read-only Example Playspace. Click "📋 Clone to Edit" above to create your own editable copy!'
      );
      editor.setValue(content);
      editor.setBreakpointLines(breakpointsByFile[filename] || []);
      editor.setDebugExecutionLine(
        activeDebugPause && activeDebugPause.filename === filename ? activeDebugPause.lineno : null
      );
      editor.layout();
      runLiveDiagnostics(content);
    } else if (kind === 'sprite-sheet') {
      activeFileIconEl.textContent = '🎨';
      spriteSheetSubtabsEl.classList.remove('hidden');

      if (resetSpriteSubtab) {
        spriteSheetViewMode = 'visual';
        spriteDataWriteProtected = true;
      }

      tabSpriteVisual.classList.toggle('active', spriteSheetViewMode === 'visual');
      tabSpriteCode.classList.toggle('active', spriteSheetViewMode === 'code');
      updateProtectedBannerUI();

      if (spriteSheetViewMode === 'visual') {
        spriteStudioContainer.classList.remove('hidden');
        spriteEditor.loadFromPythonString(content, filename);
        spriteEditor.setReadOnly(isWsReadOnly);
      } else {
        if (!isWsReadOnly) {
          protectedFileBannerEl.classList.remove('hidden');
        }
        codeEditorActionsEl.classList.remove('hidden');
        monacoContainer.classList.remove('hidden');
        editor.setReadOnly(
          isWsReadOnly || spriteDataWriteProtected,
          isWsReadOnly
            ? '📖 This is a read-only Example Playspace. Click "📋 Clone to Edit" above to create your own editable copy!'
            : undefined
        );
        editor.setValue(content);
        editor.layout();
      }
    } else if (kind === 'png') {
      activeFileIconEl.textContent = '🖼️';
      spriteStudioContainer.classList.remove('hidden');
      spriteEditor.loadPngFile(filename, content);
      spriteEditor.setReadOnly(isWsReadOnly);
    } else if (kind === 'wav') {
      activeFileIconEl.textContent = '🔊';
      wavEditorContainer.classList.remove('hidden');
      wavEditor.loadWavFile(filename, content);
      wavEditor.setReadOnly(isWsReadOnly);
    }

    renderFileList();
    resetDebugIfWorkspaceChanged();
  }

  tabSpriteVisual.addEventListener('click', () => {
    spriteSheetViewMode = 'visual';
    // Re-engage write protection automatically when returning to visual mode
    spriteDataWriteProtected = true;
    openActiveFileInEditor(false);
  });

  tabSpriteCode.addEventListener('click', () => {
    spriteSheetViewMode = 'code';
    openActiveFileInEditor(false);
  });

  btnToggleWriteProtect.addEventListener('click', () => {
    if (spriteDataWriteProtected) {
      const ok = confirm(
        'Unlock manual editing for sprites_data.py?\n\nEditing the raw Python arrays by hand can break Visual Sprite Studio parsing if the syntax becomes invalid. You can re-lock protection at any time.'
      );
      if (!ok) return;
      spriteDataWriteProtected = false;
    } else {
      spriteDataWriteProtected = true;
      const activeName = workspace.getActiveFileName();
      const latest = workspace.getFileContent(activeName);
      if (latest) {
        spriteEditor.loadFromPythonString(latest, activeName);
      }
    }
    editor.setReadOnly(spriteDataWriteProtected);
    updateProtectedBannerUI();
  });

  // 6. Left Sidebar: Playspace Browser, Version History & File List Rendering
  function formatCheckpointTime(ts: number): string {
    const diffSec = Math.floor((Date.now() - ts) / 1000);
    if (diffSec < 45) return 'Just now';
    if (diffSec < 3600) return `${Math.max(1, Math.floor(diffSec / 60))}m ago`;
    const d = new Date(ts);
    const today = new Date();
    const isToday =
      d.getFullYear() === today.getFullYear() &&
      d.getMonth() === today.getMonth() &&
      d.getDate() === today.getDate();
    return isToday
      ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function setSidebarMode(mode: 'files' | 'browser' | 'history' | 'debug'): void {
    const isRo = workspace.isActiveWorkspaceReadOnly();
    if (mode === 'history' && isRo) {
      mode = 'files';
    }
    sidebarMode = mode;

    workspaceFilesPanel.classList.toggle('hidden', mode !== 'files');
    workspaceBrowserPanel.classList.toggle('hidden', mode !== 'browser');
    workspaceHistoryPanel.classList.toggle('hidden', mode !== 'history');
    workspaceDebugPanel.classList.toggle('hidden', mode !== 'debug');
    cheatsheetSectionEl.classList.toggle('hidden', mode === 'debug');

    btnTabFiles.classList.toggle('active', mode === 'files');
    btnTabFiles.setAttribute('aria-selected', String(mode === 'files'));

    btnToggleWorkspaceBrowser.classList.toggle('active', mode === 'browser');
    btnToggleWorkspaceBrowser.setAttribute('aria-selected', String(mode === 'browser'));

    const cpCount = workspace.listCheckpoints().length;
    btnToggleCheckpoints.classList.toggle('hidden', isRo);
    btnToggleCheckpoints.textContent = cpCount > 0 ? `🕰️ History (${cpCount})` : '🕰️ History';
    btnToggleCheckpoints.classList.toggle('active', mode === 'history');
    btnToggleCheckpoints.setAttribute('aria-selected', String(mode === 'history'));

    const totalBps = Object.values(breakpointsByFile).reduce((sum, arr) => sum + arr.length, 0);
    btnTabDebug.textContent = activeDebugPause
      ? '⏸ Debug'
      : totalBps > 0
      ? `🐛 Debug (${totalBps})`
      : '🐛 Debug';
    btnTabDebug.classList.toggle('active', mode === 'debug');
    btnTabDebug.classList.toggle('has-alert', Boolean(activeDebugPause));
    btnTabDebug.setAttribute('aria-selected', String(mode === 'debug'));

    if (mode === 'browser') {
      renderWorkspaceBrowser();
    } else if (mode === 'history') {
      renderCheckpointsPanel();
    } else if (mode === 'debug') {
      renderDebugPanel();
    }
  }

  // ---- Step Debugger UI Helpers ----

  function clearSlowMoTimer(): void {
    if (slowMoTimer !== null) {
      window.clearTimeout(slowMoTimer);
      slowMoTimer = null;
    }
  }

  function setSlowMo(enabled: boolean): void {
    slowMoActive = enabled;
    btnDbgSlowMo.classList.toggle('active-toggle', enabled);
    btnDbgSlowMo.textContent = enabled ? '🐢 Slow-Mo: On' : '🐢 Slow-Mo';
    clearSlowMoTimer();
    if (enabled && runtime.isPaused()) {
      slowMoTimer = window.setTimeout(() => {
        slowMoTimer = null;
        if (slowMoActive && runtime.isPaused()) {
          runtime.stepOver();
        }
      }, 380);
    }
  }

  function clearAllBreakpoints(): void {
    breakpointsByFile = {};
    runtime.setBreakpoints(breakpointsByFile);
    editor.setBreakpointLines([]);
    renderDebugBreakpointsList();
    setSidebarMode(sidebarMode);
  }

  function toggleBreakpointOnActiveFile(lineNumber: number): void {
    const filename = workspace.getActiveFileName();
    if (classifyWorkspaceFile(filename, workspace.getFileContent(filename)) !== 'python') return;
    const cur = new Set(breakpointsByFile[filename] || []);
    if (cur.has(lineNumber)) {
      cur.delete(lineNumber);
    } else {
      cur.add(lineNumber);
    }
    const sorted = Array.from(cur).sort((a, b) => a - b);
    if (sorted.length > 0) {
      breakpointsByFile[filename] = sorted;
    } else {
      delete breakpointsByFile[filename];
    }
    editor.setBreakpointLines(sorted);
    runtime.setBreakpoints(breakpointsByFile);
    renderDebugBreakpointsList();
    setSidebarMode(sidebarMode);
  }

  function renderDebugBreakpointsList(): void {
    debugBreakpointsListEl.innerHTML = '';
    const entries: Array<{ file: string; line: number }> = [];
    for (const [file, lines] of Object.entries(breakpointsByFile)) {
      for (const line of lines) entries.push({ file, line });
    }
    btnClearBreakpoints.classList.toggle('hidden', entries.length === 0);

    if (entries.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'debug-empty-note';
      empty.textContent = 'No breakpoints set. Click next to any line number in the editor to add a red dot!';
      debugBreakpointsListEl.appendChild(empty);
      return;
    }

    for (const { file, line } of entries) {
      const li = document.createElement('li');
      li.className = 'debug-bp-item';
      li.innerHTML = `
        <span><span class="debug-bp-dot"></span><span></span></span>
        <button class="icon-btn file-mini-btn" title="Remove breakpoint">✕</button>
      `;
      li.querySelector('span span:last-child')!.textContent = `${file}:${line}`;
      li.addEventListener('click', () => {
        if (workspace.getFileContent(file) !== null) {
          workspace.setActiveFile(file);
          openActiveFileInEditor(true);
          editor.revealLine(line);
        }
      });
      li.querySelector('button')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = (breakpointsByFile[file] || []).filter((n) => n !== line);
        if (next.length > 0) breakpointsByFile[file] = next;
        else delete breakpointsByFile[file];
        if (workspace.getActiveFileName() === file) {
          editor.setBreakpointLines(next);
        }
        runtime.setBreakpoints(breakpointsByFile);
        renderDebugBreakpointsList();
        setSidebarMode(sidebarMode);
      });
      debugBreakpointsListEl.appendChild(li);
    }
  }

  function buildDebugVarTreeEl(
    node: DebugVariableNode,
    path: string,
    isTopLevel: boolean
  ): HTMLElement {
    const row = document.createElement('div');
    const prevVal = isTopLevel ? lastDebugChangedMap.get(node.name) : undefined;
    row.className = `debug-var-row ${prevVal !== undefined ? 'changed' : ''}`;

    const main = document.createElement('div');
    main.className = 'debug-var-main';

    const hasChildren = Boolean(node.expandable && node.children && node.children.length > 0);
    const isExpanded = hasChildren && expandedDebugPaths.has(path);

    if (hasChildren) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'debug-var-expand';
      btn.textContent = isExpanded ? '▾' : '▸';
      btn.title = isExpanded ? 'Collapse' : 'Expand';
      btn.addEventListener('click', () => {
        if (expandedDebugPaths.has(path)) expandedDebugPaths.delete(path);
        else expandedDebugPaths.add(path);
        renderDebugPanel();
      });
      main.appendChild(btn);
    }

    const nameEl = document.createElement('span');
    nameEl.className = 'debug-var-name';
    nameEl.textContent = `${node.name}:`;
    main.appendChild(nameEl);

    if (node.colorHex) {
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = node.colorHex;
      dot.title = `RGB color ${node.colorHex}`;
      main.appendChild(dot);
    }

    const valEl = document.createElement('span');
    valEl.className = 'debug-var-val';
    valEl.textContent = node.preview;
    valEl.title = `${node.name} (${node.type}) = ${node.preview}`;
    main.appendChild(valEl);

    const typeEl = document.createElement('span');
    typeEl.className = 'debug-var-type';
    typeEl.textContent = node.type;
    main.appendChild(typeEl);

    row.appendChild(main);

    if (prevVal !== undefined) {
      const diffEl = document.createElement('div');
      diffEl.className = 'debug-var-diff';
      diffEl.textContent = `changed: ${prevVal} → ${node.preview}`;
      row.appendChild(diffEl);
    }

    if (isExpanded && node.children) {
      const childrenWrap = document.createElement('div');
      childrenWrap.className = 'debug-var-children';
      for (const child of node.children) {
        childrenWrap.appendChild(buildDebugVarTreeEl(child, `${path}.${child.name}`, false));
      }
      row.appendChild(childrenWrap);
    }

    return row;
  }

  function renderDebugPanel(): void {
    renderDebugBreakpointsList();

    if (!activeDebugPause) {
      debugLocationMetaEl.textContent = runtime.isRunning() ? 'Running…' : 'Idle';
      debugEvalSectionEl.classList.add('hidden');
      debugStackSectionEl.classList.add('hidden');
      debugVarsContainerEl.innerHTML = runtime.isRunning()
        ? `<p class="debug-empty-note">Game is running! Click <strong>⏸ Pause</strong> at the top or click next to a line number to set a breakpoint and inspect variables.</p>`
        : `<p class="debug-empty-note">Click <strong>🐛 Debug</strong> at the top—or click next to any line number to set a red breakpoint dot—to watch your code and variables line by line!</p>`;
      return;
    }

    debugLocationMetaEl.textContent = `${activeDebugPause.filename}:${activeDebugPause.lineno}`;
    debugEvalSectionEl.classList.remove('hidden');
    debugVarsContainerEl.innerHTML = '';

    const hasLocals = activeDebugPause.locals.length > 0;
    const hasGlobals = activeDebugPause.globals.length > 0;

    if (!hasLocals && !hasGlobals) {
      const empty = document.createElement('p');
      empty.className = 'debug-empty-note';
      empty.textContent = 'No variables defined yet—click Step Over to execute this line!';
      debugVarsContainerEl.appendChild(empty);
    } else {
      if (hasLocals) {
        if (hasGlobals) {
          const h = document.createElement('div');
          h.className = 'debug-scope-heading';
          h.textContent = 'LOCAL VARIABLES';
          debugVarsContainerEl.appendChild(h);
        }
        for (const v of activeDebugPause.locals) {
          debugVarsContainerEl.appendChild(buildDebugVarTreeEl(v, `local:${v.name}`, true));
        }
      }
      if (hasGlobals) {
        const h = document.createElement('div');
        h.className = 'debug-scope-heading';
        h.textContent = 'GLOBAL VARIABLES';
        debugVarsContainerEl.appendChild(h);
        for (const v of activeDebugPause.globals) {
          debugVarsContainerEl.appendChild(buildDebugVarTreeEl(v, `global:${v.name}`, false));
        }
      }
    }

    // Call Stack
    debugStackSectionEl.classList.toggle('hidden', activeDebugPause.stack.length <= 1);
    debugStackListEl.innerHTML = '';
    for (const frame of activeDebugPause.stack) {
      const li = document.createElement('li');
      li.className = `debug-stack-item ${
        frame.index === activeDebugPause.selectedFrameIndex ? 'active' : ''
      }`;
      const fnName = frame.funcName === '<module>' ? '(top level)' : `${frame.funcName}()`;
      li.textContent = `${fnName} — ${frame.filename}:${frame.lineno}`;
      li.addEventListener('click', () => {
        runtime.selectDebugFrame(frame.index);
      });
      debugStackListEl.appendChild(li);
    }
  }

  function renderDebugEvalResult(res: DebugEvalResult): void {
    debugEvalOutputEl.classList.remove('hidden');
    debugEvalOutputEl.classList.toggle('is-err', !res.ok);
    debugEvalOutputEl.innerHTML = '';
    if (!res.ok) {
      debugEvalOutputEl.textContent = `❌ ${res.error || 'Error'}`;
      return;
    }
    if (res.colorHex) {
      const dot = document.createElement('span');
      dot.className = 'color-dot';
      dot.style.background = res.colorHex;
      debugEvalOutputEl.appendChild(dot);
    }
    const text = document.createElement('span');
    text.textContent = `${res.expr} ⇒ ${res.value} (${res.type})`;
    debugEvalOutputEl.appendChild(text);
  }

  function handleDebugPaused(payload: DebugPausePayload): void {
    // Track which top-level local variables changed since the previous pause
    const nextChanged = new Map<string, string>();
    const nextPrev = new Map<string, string>();
    for (const v of payload.locals) {
      nextPrev.set(v.name, v.preview);
      const old = prevDebugVarMap.get(v.name);
      if (old !== undefined && old !== v.preview) {
        nextChanged.set(v.name, old);
      }
    }
    if (payload.selectedFrameIndex === 0) {
      lastDebugChangedMap = nextChanged;
      prevDebugVarMap = nextPrev;
    } else {
      lastDebugChangedMap = new Map();
    }

    activeDebugPause = payload;

    // Show slim stepping bar above Monaco
    debugToolbarEl.classList.remove('hidden');
    const reasonTag =
      payload.reason === 'breakpoint'
        ? '🔴 Breakpoint'
        : payload.reason === 'pause'
        ? '⏸ Paused'
        : '⏸ Step';
    debugToolbarStatusEl.textContent = `${reasonTag} · ${payload.filename}:${payload.lineno}`;

    // Auto-switch to the paused Python file if stepping entered another workspace file
    if (
      workspace.getActiveFileName() !== payload.filename &&
      workspace.getFileContent(payload.filename) !== null
    ) {
      workspace.setActiveFile(payload.filename);
      openActiveFileInEditor(true);
    } else {
      editor.setReadOnly(
        true,
        '⏸ Paused in Step Debugger — click ⏹ Stop to edit your code!'
      );
      editor.setDebugExecutionLine(payload.lineno);
    }

    // Unhide left sidebar and switch to Debug view automatically on first pause
    if (workspaceEl.classList.contains('hide-left')) {
      workspaceEl.classList.remove('hide-left');
      updateLayoutToggleButtons();
    }
    setSidebarMode('debug');

    // Schedule next automatic step if Slow-Mo is active
    clearSlowMoTimer();
    if (slowMoActive && runtime.isPaused()) {
      slowMoTimer = window.setTimeout(() => {
        slowMoTimer = null;
        if (slowMoActive && runtime.isPaused()) {
          runtime.stepOver();
        }
      }, 380);
    }
  }

  function handleDebugResumed(): void {
    clearSlowMoTimer();
    editor.setDebugExecutionLine(null);

    if (!runtime.isRunning()) {
      activeDebugPause = null;
      prevDebugVarMap.clear();
      lastDebugChangedMap.clear();
      setSlowMo(false);
      debugToolbarEl.classList.add('hidden');
      debugEvalOutputEl.classList.add('hidden');

      // Restore normal editor write permissions
      const activeName = workspace.getActiveFileName();
      const kind = classifyWorkspaceFile(activeName, workspace.getFileContent(activeName));
      const isWsReadOnly = workspace.isActiveWorkspaceReadOnly();
      if (kind === 'python') {
        editor.setReadOnly(
          isWsReadOnly,
          '📖 This is a read-only Example Playspace. Click "📋 Clone to Edit" above to create your own editable copy!'
        );
      }
      setSidebarMode(sidebarMode);
    } else {
      // Resumed running (Continue / stepping briefly)
      debugToolbarStatusEl.textContent = '▶ Running…';
    }
  }

  function updateWorkspaceHeaders(): void {
    const ws = workspace.getActiveWorkspace();
    const isRo = workspace.isActiveWorkspaceReadOnly();
    sidebarWorkspaceNameEl.textContent = isRo ? `📖 ${ws.name}` : ws.name;
    // Keep sidebar tab states & counts in sync
    setSidebarMode(isRo && sidebarMode === 'history' ? 'files' : sidebarMode);
  }

  let lastWorkspaceId = workspace.getActiveWorkspace().id;
  function resetDebugIfWorkspaceChanged(): void {
    const curId = workspace.getActiveWorkspace().id;
    if (curId !== lastWorkspaceId) {
      lastWorkspaceId = curId;
      clearAllBreakpoints();
    }
  }

  function renderCheckpointsPanel(): void {
    const cps = workspace.listCheckpoints();
    checkpointsCountEl.textContent = String(cps.length);
    checkpointsListEl.innerHTML = '';

    if (cps.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'cp-empty-state';
      empty.textContent = 'No checkpoints yet. Type a short note above and click "Save Checkpoint" when your game works!';
      checkpointsListEl.appendChild(empty);
      return;
    }

    for (const cp of cps) {
      const diff = workspace.compareCheckpointWithCurrent(cp);
      const totalDiffs = diff.changed + diff.added + diff.removed;
      const fileCount = Object.keys(cp.files).length;

      const li = document.createElement('li');
      li.className = `cp-card ${diff.identical ? 'is-current' : ''} ${cp.auto ? 'is-auto' : ''}`;

      const diffLabel = diff.identical
        ? 'Matches current'
        : `${totalDiffs} file${totalDiffs === 1 ? '' : 's'} differ`;

      li.innerHTML = `
        <div class="cp-card-top">
          <div class="cp-card-title">${cp.auto ? '🛡️ ' : '📌 '}<span></span></div>
          <div class="cp-card-mini-actions">
            <button class="icon-btn cp-rename-btn" title="Rename checkpoint">✏️</button>
            <button class="icon-btn cp-del-btn" title="Delete checkpoint">✕</button>
          </div>
        </div>
        <div class="cp-card-meta">
          <span>${formatCheckpointTime(cp.createdAt)} · ${fileCount} file${fileCount === 1 ? '' : 's'}</span>
          <span class="cp-diff-pill ${diff.identical ? 'is-match' : ''}">${diffLabel}</span>
        </div>
        <div class="cp-card-footer">
          <button class="btn btn-small btn-Ask cp-restore-btn" ${diff.identical ? 'disabled' : ''}>
            ${diff.identical ? '✓ Current Version' : '↩ Restore This Version'}
          </button>
        </div>
      `;
      li.querySelector('.cp-card-title span')!.textContent = cp.label;

      li.querySelector('.cp-restore-btn')!.addEventListener('click', () => {
        if (diff.identical) return;
        const ok = confirm(
          `Restore checkpoint "${cp.label}"?\n\nDon't worry — if you have unsaved changes since your last checkpoint, Pywlet will automatically save a safety backup first so you can undo this!`
        );
        if (!ok) return;
        runtime.stop();
        const res = workspace.restoreCheckpoint(cp.id);
        if (res) {
          syncSpriteProjectFromWorkspace();
          openActiveFileInEditor(true);
          updateWorkspaceHeaders();
          renderCheckpointsPanel();
          appendConsole(
            `🕰️ Restored checkpoint "${res.restored.label}"${
              res.backupCreated ? ' (saved an automatic safety backup of your previous code first!)' : ''
            }.`
          );
        }
      });

      li.querySelector('.cp-rename-btn')!.addEventListener('click', () => {
        const next = prompt('Rename checkpoint:', cp.label);
        if (next && next.trim()) {
          workspace.renameCheckpoint(cp.id, next.trim());
          renderCheckpointsPanel();
        }
      });

      li.querySelector('.cp-del-btn')!.addEventListener('click', () => {
        if (!confirm(`Delete checkpoint "${cp.label}"?`)) return;
        workspace.deleteCheckpoint(cp.id);
        updateWorkspaceHeaders();
        renderCheckpointsPanel();
      });

      checkpointsListEl.appendChild(li);
    }
  }

  function renderWorkspaceBrowser(): void {
    const saved = workspace.listWorkspaces();
    const activeId = workspace.getActiveWorkspace().id;
    savedWorkspacesCountEl.textContent = String(saved.length);
    savedWorkspacesListEl.innerHTML = '';

    for (const ws of saved) {
      const li = document.createElement('li');
      li.className = `ws-card ${ws.id === activeId ? 'active' : ''}`;
      const fileCount = Object.keys(ws.files).length;
      const dateLabel = new Date(ws.updatedAt).toLocaleDateString();

      li.innerHTML = `
        <div class="ws-card-main">
          <div class="ws-card-title">${ws.id === activeId ? '🟢 ' : '📁 '}<span></span></div>
          <div class="ws-card-meta">${fileCount} file${fileCount === 1 ? '' : 's'} · ${dateLabel}</div>
        </div>
        <div class="ws-card-actions">
          <button class="icon-btn ws-rename-btn" title="Rename playspace">✏️</button>
          <button class="icon-btn ws-dup-btn" title="Duplicate playspace">📋</button>
          <button class="icon-btn ws-del-btn" title="Delete playspace">🗑</button>
        </div>
      `;
      li.querySelector('.ws-card-title span')!.textContent = ws.name;

      li.querySelector('.ws-card-main')!.addEventListener('click', () => {
        runtime.stop();
        workspace.openWorkspace(ws.id);
        syncSpriteProjectFromWorkspace();
        setSidebarMode('files');
        updateWorkspaceHeaders();
        openActiveFileInEditor(true);
      });

      li.querySelector('.ws-rename-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextName = prompt('Rename playspace:', ws.name);
        if (nextName && nextName.trim()) {
          workspace.renameWorkspace(ws.id, nextName.trim());
          updateWorkspaceHeaders();
          renderWorkspaceBrowser();
        }
      });

      li.querySelector('.ws-dup-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        runtime.stop();
        workspace.duplicateWorkspace(ws.id);
        syncSpriteProjectFromWorkspace();
        setSidebarMode('files');
        updateWorkspaceHeaders();
        openActiveFileInEditor(true);
      });

      li.querySelector('.ws-del-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete playspace "${ws.name}" from browser storage?`)) return;
        runtime.stop();
        workspace.deleteWorkspace(ws.id);
        syncSpriteProjectFromWorkspace();
        updateWorkspaceHeaders();
        renderWorkspaceBrowser();
        openActiveFileInEditor(true);
      });

      savedWorkspacesListEl.appendChild(li);
    }

    // Example playspaces (click card to preview read-only, click Clone to clone & switch)
    exampleWorkspacesListEl.innerHTML = '';
    const activeExampleId = workspace.getActiveExampleTemplateId();
    for (const tpl of Object.values(STARTER_TEMPLATES)) {
      const li = document.createElement('li');
      li.className = `ws-card ws-example-card ${activeExampleId === tpl.id ? 'active' : ''}`;
      li.innerHTML = `
        <div class="ws-card-main" title="Open example in read-only preview mode">
          <div class="ws-card-title">${tpl.icon} <span></span></div>
          <div class="ws-card-meta"></div>
        </div>
        <button class="btn btn-small btn-Ask ws-clone-btn" title="Clone this example into your saved playspaces and switch to it">Clone</button>
      `;
      li.querySelector('.ws-card-title span')!.textContent = tpl.name;
      li.querySelector('.ws-card-meta')!.textContent = tpl.description;

      li.querySelector('.ws-card-main')!.addEventListener('click', () => {
        runtime.stop();
        workspace.openExampleWorkspaceReadOnly(tpl.id);
        syncSpriteProjectFromWorkspace();
        setSidebarMode('files');
        updateWorkspaceHeaders();
        openActiveFileInEditor(true);
        appendConsole(`📖 Opened example "${tpl.name}" in read-only mode. Click "Clone to Edit" to make your own copy!`);
      });

      li.querySelector('.ws-clone-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        runtime.stop();
        const created = workspace.cloneExampleWorkspace(tpl.id);
        syncSpriteProjectFromWorkspace();
        setSidebarMode('files');
        updateWorkspaceHeaders();
        openActiveFileInEditor(true);
        appendConsole(`🌟 Cloned example "${tpl.name}" as "${created.name}".`);
      });

      exampleWorkspacesListEl.appendChild(li);
    }
  }

  function renderFileList(): void {
    fileListEl.innerHTML = '';
    const active = workspace.getActiveFileName();
    const files = workspace.getFiles();
    const isWsReadOnly = workspace.isActiveWorkspaceReadOnly();

    // Toggle file-creation controls vs "Clone Example to Edit" button
    newFileToolbarEl.classList.toggle('hidden', isWsReadOnly);
    labelImportFileEl.classList.toggle('hidden', isWsReadOnly);
    btnCloneExampleSidebar.classList.toggle('hidden', !isWsReadOnly);

    // Hide "+ Sheet" button if sprites_data.py already exists
    const hasSpriteSheet = Object.keys(files).some(
      (f) => classifyWorkspaceFile(f, files[f]) === 'sprite-sheet'
    );
    btnNewSpritesSheet.classList.toggle('hidden', hasSpriteSheet || isWsReadOnly);

    for (const filename of workspace.getFileNames()) {
      const content = files[filename];
      const kind = classifyWorkspaceFile(filename, content);
      const li = document.createElement('li');
      li.className = `file-item ${filename === active ? 'active' : ''}`;

      const leftWrap = document.createElement('div');
      leftWrap.className = 'file-item-label';

      if (kind === 'png' && content.startsWith('data:image')) {
        const thumb = document.createElement('img');
        thumb.className = 'file-thumb';
        thumb.src = content;
        thumb.alt = filename;
        leftWrap.appendChild(thumb);
      } else {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'ui-icon';
        iconSpan.textContent =
          kind === 'sprite-sheet' ? '🎨' : kind === 'wav' ? '🔊' : kind === 'png' ? '🖼️' : '🐍';
        leftWrap.appendChild(iconSpan);
      }

      const nameSpan = document.createElement('span');
      nameSpan.className = 'file-item-name';
      nameSpan.textContent = filename;
      nameSpan.title = filename;
      leftWrap.appendChild(nameSpan);

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'file-item-actions';

      if (kind === 'png' || kind === 'wav') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'icon-btn file-mini-btn';
        copyBtn.textContent = '📋';
        copyBtn.title = `Copy path "${filename}"`;
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const snippet = `"${filename}"`;
          if (navigator.clipboard) {
            navigator.clipboard.writeText(snippet).catch(() => {});
          }
          appendConsole(`📋 Copied ${snippet} to clipboard.`);
        });
        actionsWrap.appendChild(copyBtn);
      }

      if (!isWsReadOnly && Object.keys(files).length > 1) {
        const delBtn = document.createElement('button');
        delBtn.className = 'icon-btn file-mini-btn';
        delBtn.textContent = '✕';
        delBtn.title = `Delete ${filename}`;
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm(`Delete "${filename}" from this playspace?`)) return;
          workspace.deleteFile(filename);
          openActiveFileInEditor(true);
        });
        actionsWrap.appendChild(delBtn);
      }

      li.appendChild(leftWrap);
      li.appendChild(actionsWrap);

      li.addEventListener('click', () => {
        workspace.setActiveFile(filename);
        openActiveFileInEditor(true);
      });

      fileListEl.appendChild(li);
    }
  }

  function buildTutorContext(): TutorCodeContext {
    const activeName = workspace.getActiveFileName();
    const runnable = workspace.getRunnablePythonFile();
    const isCodeVisible = !monacoContainer.classList.contains('hidden');
    const cursor = isCodeVisible
      ? editor.getCursorContext()
      : { selectedText: '', cursorWord: '', lineNumber: 1, lineText: '' };
    const firstDiag = activeBannerDiagnostic || currentDiagnostics[0];
    const consoleLines = (consoleOutputEl.textContent || '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const recentConsole = consoleLines.slice(-6).join('\n');

    return {
      activeFile: isCodeVisible ? activeName : runnable?.filename || activeName,
      fullCode: isCodeVisible ? editor.getValue() : runnable?.code || '',
      selectedText: cursor.selectedText,
      cursorWord: cursor.cursorWord,
      cursorLineNumber: cursor.lineNumber,
      cursorLineText: cursor.lineText,
      projectFiles: workspace.getFileNames(),
      recentConsole,
      activeError: firstDiag
        ? {
            line: firstDiag.line,
            column: firstDiag.column,
            endColumn: firstDiag.endColumn,
            title: firstDiag.title,
            friendlyExplanation: firstDiag.friendlyExplanation,
          }
        : undefined,
      allDiagnostics: currentDiagnostics.slice(0, 5),
      debugState: activeDebugPause
        ? {
            filename: activeDebugPause.filename,
            line: activeDebugPause.lineno,
            variables: activeDebugPause.locals.map((v) => ({
              name: v.name,
              type: v.type,
              preview: v.preview,
            })),
          }
        : undefined,
    };
  }

  async function askTutorQuestion(questionText: string): Promise<void> {
    const userBubble = document.createElement('div');
    userBubble.className = 'tutor-msg tutor-msg-user';
    userBubble.textContent = questionText;
    tutorMessagesEl.appendChild(userBubble);

    const assistantBubble = document.createElement('div');
    assistantBubble.className = 'tutor-msg tutor-msg-assistant';
    assistantBubble.innerHTML = '<em>🦉 Thinking...</em>';
    tutorMessagesEl.appendChild(assistantBubble);
    tutorMessagesEl.scrollTop = tutorMessagesEl.scrollHeight;

    const ctx = buildTutorContext();
    await tutor.askSocratic(questionText, ctx, (markdown) => {
      assistantBubble.innerHTML = formatSimpleMarkdown(markdown);
      tutorMessagesEl.scrollTop = tutorMessagesEl.scrollHeight;
    });
  }

  function runActiveGame(debugMode = false): void {
    const runnable = workspace.getRunnablePythonFile();
    if (!runnable) {
      appendConsole('❌ No runnable Python file found in this playspace.');
      return;
    }
    if (debugMode && !runtime.isDebugSupported()) {
      appendConsole(
        '⚠️ Step Debugger requires Cross-Origin Isolation (SharedArrayBuffer), which works on localhost and HTTPS (GitHub Pages / installed app).'
      );
      return;
    }
    prevDebugVarMap.clear();
    lastDebugChangedMap.clear();
    syncSpriteProjectFromWorkspace();
    if (debugMode) {
      if (workspace.getActiveFileName() !== runnable.filename) {
        workspace.setActiveFile(runnable.filename);
        openActiveFileInEditor(true);
      }
      if (workspaceEl.classList.contains('hide-left')) {
        workspaceEl.classList.remove('hide-left');
        updateLayoutToggleButtons();
      }
      setSidebarMode('debug');
      consoleOutputEl.textContent = `🐛 Stepping ${runnable.filename} (Python 3.14 Debugger)...`;
    } else {
      consoleOutputEl.textContent = `▶ Running ${runnable.filename} (Python 3.14)...`;
    }
    void runtime.runCode(runnable.code, runnable.filename, workspace.getFiles(), { debugMode });
  }

  // 7. Wire UI Events & Layout Toggles
  function updateLayoutToggleButtons(): void {
    const leftHidden = workspaceEl.classList.contains('hide-left');
    const rightHidden = workspaceEl.classList.contains('hide-right');
    const isFocus = leftHidden && rightHidden;

    btnToggleLeftPanel.textContent = leftHidden ? '▶ Files' : '◀ Files';
    btnToggleLeftPanel.classList.toggle('active-toggle', leftHidden);

    btnToggleRightPanel.textContent = rightHidden ? '◀ Stage' : 'Stage ▶';
    btnToggleRightPanel.classList.toggle('active-toggle', rightHidden);

    btnFocusMode.classList.toggle('active-toggle', isFocus);
  }

  btnToggleLeftPanel.addEventListener('click', () => {
    workspaceEl.classList.toggle('hide-left');
    updateLayoutToggleButtons();
    applyPanelWidths(false);
  });

  btnToggleRightPanel.addEventListener('click', () => {
    workspaceEl.classList.toggle('hide-right');
    updateLayoutToggleButtons();
    applyPanelWidths(false);
  });

  btnFocusMode.addEventListener('click', () => {
    const isFocus =
      workspaceEl.classList.contains('hide-left') &&
      workspaceEl.classList.contains('hide-right');
    if (isFocus) {
      workspaceEl.classList.remove('hide-left', 'hide-right');
    } else {
      workspaceEl.classList.add('hide-left', 'hide-right');
    }
    updateLayoutToggleButtons();
    applyPanelWidths(false);
  });

  // Sidebar Top Tabs
  btnTabFiles.addEventListener('click', () => {
    setSidebarMode('files');
  });

  btnToggleWorkspaceBrowser.addEventListener('click', () => {
    setSidebarMode('browser');
  });

  btnToggleCheckpoints.addEventListener('click', () => {
    setSidebarMode('history');
    if (sidebarMode === 'history') {
      inputCheckpointLabel.focus();
    }
  });

  btnTabDebug.addEventListener('click', () => {
    setSidebarMode('debug');
  });

  // Step Debugger Toolbar & Eval Controls
  btnDebug.addEventListener('click', () => runActiveGame(true));
  btnPause.addEventListener('click', () => runtime.pause());
  btnDbgContinue.addEventListener('click', () => {
    setSlowMo(false);
    runtime.continueDebug();
  });
  btnDbgStepOver.addEventListener('click', () => {
    setSlowMo(false);
    runtime.stepOver();
  });
  btnDbgStepInto.addEventListener('click', () => {
    setSlowMo(false);
    runtime.stepInto();
  });
  btnDbgStepOut.addEventListener('click', () => {
    setSlowMo(false);
    runtime.stepOut();
  });
  btnDbgSlowMo.addEventListener('click', () => {
    setSlowMo(!slowMoActive);
  });
  btnClearBreakpoints.addEventListener('click', () => {
    clearAllBreakpoints();
  });
  debugEvalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const expr = inputDebugEval.value.trim();
    if (!expr || !runtime.isPaused()) return;
    runtime.evaluateDebugExpression(expr);
  });

  // Draggable Left & Right Panel Resizers with Proportional Defaults & Minimum Widths
  const PANEL_WIDTHS_KEY = 'pywlet_panel_widths_v1';
  const MIN_LEFT_W = 210;
  const MIN_RIGHT_W = 420;
  const MIN_CENTER_W = 300;
  let customLeftW: number | null = null;
  let customRightW: number | null = null;

  const getDefaultLeftW = () => Math.round(Math.max(235, Math.min(310, window.innerWidth * 0.19)));
  const getDefaultRightW = () => Math.round(Math.max(428, Math.min(540, window.innerWidth * 0.30)));

  const applyPanelWidths = (persist = false): void => {
    const vw = Math.max(960, window.innerWidth);
    const rightHidden = workspaceEl.classList.contains('hide-right');
    const leftHidden = workspaceEl.classList.contains('hide-left');

    const activeRight = rightHidden ? 0 : customRightW ?? getDefaultRightW();
    const maxLeft = Math.max(MIN_LEFT_W, Math.min(480, vw - MIN_CENTER_W - activeRight - 10));
    const finalLeft = Math.round(
      Math.max(MIN_LEFT_W, Math.min(maxLeft, customLeftW ?? getDefaultLeftW()))
    );

    const activeLeft = leftHidden ? 0 : finalLeft;
    const maxRight = Math.max(MIN_RIGHT_W, Math.min(680, vw - MIN_CENTER_W - activeLeft - 10));
    const finalRight = Math.round(
      Math.max(MIN_RIGHT_W, Math.min(maxRight, customRightW ?? getDefaultRightW()))
    );

    workspaceEl.style.setProperty('--left-col-w', `${finalLeft}px`);
    workspaceEl.style.setProperty('--right-col-w', `${finalRight}px`);
    editor.layout();

    if (persist) {
      try {
        localStorage.setItem(
          PANEL_WIDTHS_KEY,
          JSON.stringify({ left: customLeftW, right: customRightW })
        );
      } catch {
        // Ignore storage errors
      }
    }
  };

  try {
    const raw = localStorage.getItem(PANEL_WIDTHS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { left?: number | null; right?: number | null };
      if (typeof parsed.left === 'number' && parsed.left >= MIN_LEFT_W) customLeftW = parsed.left;
      if (typeof parsed.right === 'number' && parsed.right >= MIN_RIGHT_W) customRightW = parsed.right;
    }
  } catch {
    // Ignore
  }
  applyPanelWidths(false);

  const attachPanelResizer = (handleEl: HTMLElement, side: 'left' | 'right'): void => {
    handleEl.addEventListener('pointerdown', (startEvt: PointerEvent) => {
      startEvt.preventDefault();
      handleEl.setPointerCapture(startEvt.pointerId);
      handleEl.classList.add('dragging');
      workspaceEl.classList.add('is-resizing');
      document.body.classList.add('resizing-panels');

      const onMove = (moveEvt: PointerEvent) => {
        const rect = workspaceEl.getBoundingClientRect();
        if (side === 'left') {
          customLeftW = Math.max(MIN_LEFT_W, Math.round(moveEvt.clientX - rect.left));
        } else {
          customRightW = Math.max(MIN_RIGHT_W, Math.round(rect.right - moveEvt.clientX));
        }
        applyPanelWidths(false);
      };

      const onUp = () => {
        handleEl.classList.remove('dragging');
        workspaceEl.classList.remove('is-resizing');
        document.body.classList.remove('resizing-panels');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        applyPanelWidths(true);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    });

    handleEl.addEventListener('dblclick', () => {
      if (side === 'left') customLeftW = null;
      else customRightW = null;
      applyPanelWidths(true);
    });
  };

  attachPanelResizer(resizerLeftEl, 'left');
  attachPanelResizer(resizerRightEl, 'right');
  window.addEventListener('resize', () => applyPanelWidths(false));

  checkpointForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const label = inputCheckpointLabel.value.trim();
    const cp = workspace.createCheckpoint(label || undefined);
    if (!cp) return;
    inputCheckpointLabel.value = '';
    updateWorkspaceHeaders();
    renderCheckpointsPanel();
    appendConsole(`📌 Saved checkpoint "${cp.label}".`);
  });

  btnNewEmptyWorkspace.addEventListener('click', () => {
    const name = prompt('Name your new empty playspace:', 'My Cool Game');
    if (!name || !name.trim()) return;
    runtime.stop();
    workspace.createEmptyWorkspace(name.trim());
    setSidebarMode('files');
    updateWorkspaceHeaders();
    openActiveFileInEditor(true);
    appendConsole(`✨ Created empty playspace "${name.trim()}".`);
  });

  btnOpenFolder.addEventListener('click', async () => {
    const ok = await workspace.openLocalDirectory();
    if (ok) {
      runtime.stop();
      syncSpriteProjectFromWorkspace();
      setSidebarMode('files');
      updateWorkspaceHeaders();
      openActiveFileInEditor(true);
    }
  });

  function handleCloneActiveExample(): void {
    const created = workspace.cloneActiveExampleWorkspace();
    if (!created) return;
    runtime.stop();
    syncSpriteProjectFromWorkspace();
    updateWorkspaceHeaders();
    openActiveFileInEditor(true);
    appendConsole(`🌟 Cloned example into editable playspace "${created.name}".`);
  }

  btnCloneActiveExample.addEventListener('click', handleCloneActiveExample);
  btnCloneExampleSidebar.addEventListener('click', handleCloneActiveExample);

  btnNewPy.addEventListener('click', () => {
    const name = prompt('New Python file name:', 'helper.py');
    if (name && name.trim()) {
      const clean = name.trim().endsWith('.py') ? name.trim() : `${name.trim()}.py`;
      workspace.createFile(clean, '# New Python file\n');
      openActiveFileInEditor(true);
    }
  });

  btnNewPng.addEventListener('click', () => {
    const name = prompt('New PNG image path:', 'assets/hero.png');
    if (!name || !name.trim()) return;
    const rawSize = prompt('Pixel canvas size (8, 16, 24, 32, 48, or 64):', '16');
    const size = Math.max(8, Math.min(64, Number(rawSize) || 16));
    const clean = name.trim().toLowerCase().endsWith('.png') ? name.trim() : `${name.trim()}.png`;
    workspace.createFile(clean, createBlankPngDataUrl(size));
    openActiveFileInEditor(true);
  });

  btnNewWav.addEventListener('click', () => {
    const name = prompt('New WAV sound path:', 'assets/laser.wav');
    if (!name || !name.trim()) return;
    const clean = name.trim().toLowerCase().endsWith('.wav') ? name.trim() : `${name.trim()}.wav`;
    workspace.createFile(clean, createStarterSoundWav('boop'));
    openActiveFileInEditor(true);
  });

  btnNewSpritesSheet.addEventListener('click', () => {
    workspace.createFile('sprites_data.py', getDefaultSpritesDataPy());
    syncSpriteProjectFromWorkspace();
    openActiveFileInEditor(true);
  });

  inputImportFile.addEventListener('change', async () => {
    const file = inputImportFile.files?.[0];
    inputImportFile.value = '';
    if (!file) return;
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.py')) {
        const text = await file.text();
        workspace.createFile(file.name, text);
      } else if (lower.endsWith('.png') || lower.endsWith('.wav')) {
        const dataUrl = await fileToDataUrl(file);
        const targetPath = file.name.includes('/') ? file.name : `assets/${file.name}`;
        workspace.createFile(targetPath, dataUrl);
      } else {
        alert('Supported file types: .py, .png, .wav');
        return;
      }
      syncSpriteProjectFromWorkspace();
      openActiveFileInEditor(true);
      appendConsole(`📤 Imported ${file.name} into playspace.`);
    } catch (err: any) {
      appendConsole(`❌ Failed to import ${file.name}: ${err?.message || err}`);
    }
  });

  function setTheaterMode(enabled: boolean): void {
    canvasWrapperEl.classList.toggle('theater-mode', enabled);
    theaterToolbarEl.classList.toggle('hidden', !enabled);
    if (enabled) {
      if (!runtime.isRunning()) {
        runActiveGame();
      }
      canvasEl.focus();
    }
  }

  btnExpandGame.addEventListener('click', () => {
    const isTheater = canvasWrapperEl.classList.contains('theater-mode');
    setTheaterMode(!isTheater);
  });

  btnTheaterExit.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    setTheaterMode(false);
  });

  btnTheaterRestart.addEventListener('click', () => {
    runActiveGame();
    canvasEl.focus();
  });

  btnFullscreenGame.addEventListener('click', async () => {
    if (!runtime.isRunning()) {
      runActiveGame();
    }
    theaterToolbarEl.classList.remove('hidden');
    try {
      if (!document.fullscreenElement) {
        await canvasWrapperEl.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
      canvasEl.focus();
    } catch {
      setTheaterMode(true);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !canvasWrapperEl.classList.contains('theater-mode')) {
      theaterToolbarEl.classList.add('hidden');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && canvasWrapperEl.classList.contains('theater-mode')) {
      setTheaterMode(false);
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      btnFocusMode.click();
    }
    if (e.key === 'F5') {
      e.preventDefault();
      if (runtime.isPaused()) {
        setSlowMo(false);
        runtime.continueDebug();
      } else if (!runtime.isRunning()) {
        runActiveGame(false);
      }
      return;
    }
    if (e.key === 'F9') {
      e.preventDefault();
      if (!runtime.isRunning()) {
        runActiveGame(true);
      }
      return;
    }
    if (e.key === 'F10' && runtime.isPaused()) {
      e.preventDefault();
      setSlowMo(false);
      runtime.stepOver();
      return;
    }
    if (e.key === 'F11' && runtime.isPaused()) {
      e.preventDefault();
      setSlowMo(false);
      if (e.shiftKey) runtime.stepOut();
      else runtime.stepInto();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (!workspace.isActiveWorkspaceReadOnly()) {
        workspaceEl.classList.remove('hide-left');
        updateLayoutToggleButtons();
        setSidebarMode('history');
        inputCheckpointLabel.focus();
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      workspace.saveToStorage();
    }
  });

  btnToggleAiSetup.addEventListener('click', () => {
    const isNowHidden = aiSetupDrawerEl.classList.toggle('hidden');
    btnToggleAiSetup.textContent = isNowHidden ? '⚙️ AI Setup' : '✕ Hide Setup';
    btnToggleAiSetup.classList.toggle('active-toggle', !isNowHidden);
  });

  btnToggleDebug.addEventListener('click', () => {
    aiDebugPanelEl.classList.toggle('hidden');
    btnToggleDebug.classList.toggle('active-toggle', !aiDebugPanelEl.classList.contains('hidden'));
  });
  btnAiSetupHelp.addEventListener('click', () => chromeFlagsHelpDrawerEl.classList.toggle('hidden'));
  btnCloseFlagsHelp.addEventListener('click', () => chromeFlagsHelpDrawerEl.classList.add('hidden'));
  btnWebgpuHelp.addEventListener('click', () => chromeFlagsHelpDrawerEl.classList.toggle('hidden'));
  btnClearDebug.addEventListener('click', () => {
    aiDebugLogEl.textContent = 'Waiting for AI activity...';
    aiDebugStreamEl.textContent = '(No tokens generated yet)';
  });

  btnRun.addEventListener('click', () => runActiveGame());

  btnStop.addEventListener('click', () => {
    runtime.stop();
    appendConsole('⏹ Game stopped.');
  });

  btnClearConsole.addEventListener('click', () => {
    consoleOutputEl.textContent = '';
  });

  btnExplainSelection.addEventListener('click', () => {
    const cursor = editor.getCursorContext();
    const target = cursor.selectedText || cursor.cursorWord || cursor.lineText.trim();
    if (!target) {
      askTutorQuestion('Can you explain how my current Python file works?');
    } else {
      askTutorQuestion(
        `Can you explain what \`${target}\` on line ${cursor.lineNumber} does and how it works?`
      );
    }
  });

  btnAskDiagnostic.addEventListener('click', () => {
    const diag = activeBannerDiagnostic || currentDiagnostics[0];
    if (diag) {
      if (workspaceEl.classList.contains('hide-right')) {
        workspaceEl.classList.remove('hide-right');
        updateLayoutToggleButtons();
      }
      askTutorQuestion(
        `I got an error on line ${diag.line}: "${diag.friendlyExplanation}". Can you explain why this happened and give me a hint to fix it without writing the code for me?`
      );
    }
  });

  const AI_BACKEND_STORAGE_KEY = 'pywlet_ai_backend_v1';
  const LOCAL_SERVER_URL_KEY = 'pywlet_local_server_url_v1';
  const LOCAL_SERVER_KEY_KEY = 'pywlet_local_server_key_v1';

  const syncLocalServerRowVisibility = () => {
    localServerConfigRow.classList.toggle('hidden', llmBackendSelect.value !== 'ollama-local');
  };

  const applyLocalServerConfigFromInputs = () => {
    const url = inputLocalServerUrl.value.trim() || 'http://localhost:11434';
    const apiKey = inputLocalServerKey.value.trim();
    tutor.setLocalServerUrl(url);
    tutor.setLocalServerApiKey(apiKey);
    try {
      localStorage.setItem(LOCAL_SERVER_URL_KEY, url);
      if (apiKey) {
        localStorage.setItem(LOCAL_SERVER_KEY_KEY, apiKey);
      } else {
        localStorage.removeItem(LOCAL_SERVER_KEY_KEY);
      }
    } catch {
      // Ignore
    }
  };

  try {
    const savedUrl = localStorage.getItem(LOCAL_SERVER_URL_KEY);
    if (savedUrl) {
      inputLocalServerUrl.value = savedUrl;
      tutor.setLocalServerUrl(savedUrl);
    }
    const savedKey = localStorage.getItem(LOCAL_SERVER_KEY_KEY);
    if (savedKey) {
      inputLocalServerKey.value = savedKey;
      tutor.setLocalServerApiKey(savedKey);
    }
  } catch {
    // Ignore
  }

  inputLocalServerUrl.addEventListener('input', applyLocalServerConfigFromInputs);
  inputLocalServerUrl.addEventListener('change', applyLocalServerConfigFromInputs);
  inputLocalServerKey.addEventListener('input', applyLocalServerConfigFromInputs);
  inputLocalServerKey.addEventListener('change', applyLocalServerConfigFromInputs);

  llmBackendSelect.addEventListener('change', async () => {
    const id = llmBackendSelect.value as LLMBackendId;
    syncLocalServerRowVisibility();
    try {
      localStorage.setItem(AI_BACKEND_STORAGE_KEY, id);
    } catch {
      // Ignore storage error
    }
    await tutor.setBackend(id);
  });

  // Restore saved AI backend, or auto-prefer Chrome Built-in AI (Gemma 4 / Nano) when available
  const initPreferredBackend = async () => {
    let preferred: LLMBackendId | null = null;
    try {
      const savedRaw = localStorage.getItem(AI_BACKEND_STORAGE_KEY);
      const saved = (savedRaw === 'transformers-js-1.5b' ? 'transformers-js' : savedRaw) as LLMBackendId | null;
      if (saved && ['transformers-js', 'chrome-prompt', 'ollama-local'].includes(saved)) {
        preferred = saved;
      }
    } catch {
      // Ignore
    }
    if (!preferred) {
      const hasChromeBuiltInAI =
        typeof (globalThis as any).LanguageModel !== 'undefined' ||
        Boolean((window as any).ai?.languageModel);
      if (hasChromeBuiltInAI) {
        preferred = 'chrome-prompt';
      }
    }
    if (preferred && preferred !== llmBackendSelect.value) {
      llmBackendSelect.value = preferred;
      await tutor.setBackend(preferred);
    }
    syncLocalServerRowVisibility();
  };
  void initPreferredBackend();

  btnLoadModel.addEventListener('click', async () => {
    if (llmBackendSelect.value === 'ollama-local') {
      applyLocalServerConfigFromInputs();
    }
    try {
      await tutor.initActiveBackend();
      if (llmBackendSelect.value === 'ollama-local') {
        const discovered = tutor.getLocalServerUrl();
        if (discovered && discovered !== inputLocalServerUrl.value.trim()) {
          inputLocalServerUrl.value = discovered;
        }
      }
    } catch {
      // Status bar already updated
    }
  });

  tutorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = tutorInput.value.trim();
    if (!q) return;
    tutorInput.value = '';
    await askTutorQuestion(q);
  });

  function hexToRgbTuple(hex: string): string {
    const clean = hex.replace('#', '');
    const r = parseInt(clean.slice(0, 2), 16) || 0;
    const g = parseInt(clean.slice(2, 4), 16) || 0;
    const b = parseInt(clean.slice(4, 6), 16) || 0;
    return `(${r}, ${g}, ${b})`;
  }

  function bindCheatsheetInteractions(): void {
    const picker = cheatsheetContentEl.querySelector('#cheat-color-picker') as HTMLInputElement | null;
    const tupleEl = cheatsheetContentEl.querySelector('#cheat-rgb-tuple') as HTMLElement | null;
    const btnInsert = cheatsheetContentEl.querySelector('#btn-insert-rgb') as HTMLButtonElement | null;
    const btnCopy = cheatsheetContentEl.querySelector('#btn-copy-rgb') as HTMLButtonElement | null;

    if (!picker || !tupleEl) return;

    picker.addEventListener('input', () => {
      tupleEl.textContent = hexToRgbTuple(picker.value);
    });

    btnInsert?.addEventListener('click', () => {
      const tupleText = tupleEl.textContent || '(56, 189, 248)';
      if (monacoContainer.classList.contains('hidden') || editor.isReadOnly()) {
        const runnable = workspace.getRunnablePythonFile();
        if (runnable) {
          workspace.setActiveFile(runnable.filename);
          openActiveFileInEditor(true);
        }
      }
      editor.insertSnippetAtCursor(tupleText);
    });

    btnCopy?.addEventListener('click', async () => {
      const tupleText = tupleEl.textContent || '(56, 189, 248)';
      try {
        await navigator.clipboard.writeText(tupleText);
        if (btnCopy) {
          const orig = btnCopy.textContent;
          btnCopy.textContent = '✓ Copied!';
          setTimeout(() => {
            btnCopy.textContent = orig;
          }, 1200);
        }
      } catch {
        // Fallback
      }
    });

    cheatsheetContentEl.querySelectorAll('.rgb-preset-item').forEach((item) => {
      item.addEventListener('click', () => {
        const hex = item.getAttribute('data-hex') || '#38bdf8';
        const rgb = item.getAttribute('data-rgb') || hexToRgbTuple(hex);
        picker.value = hex;
        tupleEl.textContent = rgb;
      });
    });
  }

  document.querySelectorAll('[data-cheat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-cheat]').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const key = btn.getAttribute('data-cheat') || 'coords';
      cheatsheetContentEl.innerHTML = CHEATSHEETS[key] || CHEATSHEETS.coords;
      bindCheatsheetInteractions();
    });
  });

  canvasEl.addEventListener('mousemove', (e) => {
    const rect = canvasEl.getBoundingClientRect();
    const scaleX = canvasEl.width / Math.max(1, rect.width);
    const scaleY = canvasEl.height / Math.max(1, rect.height);
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    canvasCoordsEl.textContent = `Mouse: (${x}, ${y})`;
  });

  // Theme & Optional Button Icons
  const appearance = new AppearanceController((monacoTheme) => {
    editor.setTheme(monacoTheme);
  });
  themeSelect.value = appearance.getTheme();
  const syncIconsButtonLabel = () => {
    const on = appearance.getShowIcons();
    btnToggleIcons.textContent = on ? 'Icons: On' : 'Icons: Off';
    btnToggleIcons.classList.toggle('active-toggle', !on);
  };
  syncIconsButtonLabel();

  themeSelect.addEventListener('change', () => {
    appearance.applyTheme(themeSelect.value as PywletThemeId);
  });
  btnToggleIcons.addEventListener('click', () => {
    appearance.applyShowIcons(!appearance.getShowIcons());
    syncIconsButtonLabel();
  });

  // Initial Startup Sync
  cheatsheetContentEl.innerHTML = CHEATSHEETS.coords;
  syncSpriteProjectFromWorkspace();
  updateWorkspaceHeaders();
  openActiveFileInEditor(true);
  runtime.preload();
  initPwa(document.getElementById('btn-install-pwa'));

  // Optional kid-friendly UI walkthrough overlay (auto-shows once on first visit)
  const uiTour = new UiTourOverlay(() => {
    // Ensure both sidebars are visible during the walkthrough
    workspaceEl.classList.remove('hide-left', 'hide-right');
    updateLayoutToggleButtons();
    setSidebarMode('files');
  });
  btnStartTour.addEventListener('click', () => uiTour.start());
  uiTour.startIfFirstVisit();
}

void bootstrapPywlet();
