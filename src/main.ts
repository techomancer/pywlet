import { CodeEditorController } from './editor/monaco-setup';
import { analyzePythonCodeForLearners, type PythonDiagnostic } from './diagnostics/python-coach';
import { PythonPygameRuntime } from './runtime/python-runtime';
import { TutorService } from './llm/tutor-service';
import type { LLMBackendId, LLMDebugEvent, TutorCodeContext } from './llm/types';
import { CHEATSHEETS, WorkspaceStore } from './workspace/templates';
import { SpriteEditorController } from './sprite-editor/sprite-editor';
import { initPwa } from './pwa/register-pwa';

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

function bootstrapPywlet(): void {
  const workspace = new WorkspaceStore();
  let currentDiagnostics: PythonDiagnostic[] = [];
  let activeBannerDiagnostic: PythonDiagnostic | null = null;

  // DOM Elements
  const workspaceEl = document.querySelector('.workspace') as HTMLElement;
  const monacoContainer = document.getElementById('monaco-container')!;
  const spriteStudioContainer = document.getElementById('sprite-studio-container')!;
  const tabCodeEditor = document.getElementById('tab-code-editor')!;
  const tabSpriteStudio = document.getElementById('tab-sprite-studio')!;
  const fileListEl = document.getElementById('file-list')!;
  const activeFilenameEl = document.getElementById('active-filename')!;
  const syntaxBadgeEl = document.getElementById('syntax-badge')!;
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
  const templateSelect = document.getElementById('template-select') as HTMLSelectElement;
  const btnOpenFolder = document.getElementById('btn-open-folder')!;
  const btnSaveProject = document.getElementById('btn-save-project')!;
  const btnNewFile = document.getElementById('btn-new-file')!;
  const btnRun = document.getElementById('btn-run') as HTMLButtonElement;
  const btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
  const btnExplainSelection = document.getElementById('btn-explain-selection')!;
  const btnAskDiagnostic = document.getElementById('btn-ask-diagnostic')!;
  const btnClearConsole = document.getElementById('btn-clear-console')!;

  // Tutor & AI Debug UI
  const llmBackendSelect = document.getElementById('llm-backend-select') as HTMLSelectElement;
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

  function appendDebugLog(event: LLMDebugEvent): void {
    if (event.data?.device) {
      const isGpu = event.data.device === 'webgpu';
      gpuDeviceBadgeEl.textContent = isGpu
        ? `⚡ WebGPU: ${event.data.adapterInfo || 'Hardware Active'}`
        : `⚙️ ${event.data.adapterInfo || 'SIMD WASM'}`;
      gpuDeviceBadgeEl.className = isGpu ? 'badge badge-ok' : 'badge badge-warn';

      // Auto-expand the Chrome WebGPU flags tip if WebGPU fell back to SwiftShader or WASM
      if (event.stage === 'gpu-probe' && event.data.webgpuAvailable === false) {
        chromeFlagsHelpDrawerEl.classList.remove('hidden');
      }
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

  // 1. Initialize Modular Local AI Tutor Service with Progress + Debug Telemetry
  const tutor = new TutorService(
    (progress) => {
      llmStatusTextEl.textContent = progress.message;
    },
    (debugEvent) => {
      appendDebugLog(debugEvent);
    }
  );

  // Probe WebGPU immediately on startup so the debug panel shows GPU status right away
  tutor.probeGPU();

  // 2. Initialize Monaco Code Editor
  const editor = new CodeEditorController(
    monacoContainer,
    workspace.getActiveFileContent(),
    (updatedCode) => {
      workspace.updateActiveFileContent(updatedCode);
      runLiveDiagnostics(updatedCode);
    },
    (cursorCtx) => {
      const target = cursorCtx.selectedText || cursorCtx.cursorWord || cursorCtx.lineText.trim();
      askTutorQuestion(`Can you explain what \`${target}\` on line ${cursorCtx.lineNumber} does in my code?`);
    }
  );

  // 2b. Initialize Sprite & Tilemap Studio (reads/writes `sprites_data.py` Python arrays)
  const spriteEditor = new SpriteEditorController(spriteStudioContainer, {
    onSaveToPythonFile: (filename, pyCode) => {
      workspace.setFileContent(filename, pyCode);
      if (workspace.getActiveFileName() === filename) {
        editor.setValue(pyCode);
      }
      renderFileList();
      consoleOutputEl.textContent += `\n🎨 Saved PALETTE, SPRITES, and TILEMAP arrays to ${filename}!`;
      consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
    },
    onReadPythonFile: (filename) => {
      return workspace.getFileContent(filename);
    },
  });

  // Load initial `sprites_data.py` if present in workspace
  const initialSpritePy = workspace.getFileContent('sprites_data.py');
  if (initialSpritePy) {
    spriteEditor.loadFromPythonString(initialSpritePy);
  }

  function switchCenterView(mode: 'code' | 'sprite'): void {
    if (mode === 'code') {
      tabCodeEditor.classList.add('active');
      tabSpriteStudio.classList.remove('active');
      monacoContainer.classList.remove('hidden');
      spriteStudioContainer.classList.add('hidden');
    } else {
      // Sync latest `sprites_data.py` edits if the student edited the numbers in Monaco!
      const pyFromWorkspace = workspace.getFileContent('sprites_data.py');
      if (pyFromWorkspace) {
        spriteEditor.loadFromPythonString(pyFromWorkspace);
      }
      tabCodeEditor.classList.remove('active');
      tabSpriteStudio.classList.add('active');
      monacoContainer.classList.add('hidden');
      spriteStudioContainer.classList.remove('hidden');
      spriteEditor.renderAll();
    }
  }

  tabCodeEditor.addEventListener('click', () => switchCenterView('code'));
  tabSpriteStudio.addEventListener('click', () => switchCenterView('sprite'));

  // 3. Initialize Python + Pygame Canvas Runtime
  const runtime = new PythonPygameRuntime(canvasEl, {
    getSpriteProjectData: () => spriteEditor.getProjectData(),
    onStdout: (line) => {
      consoleOutputEl.textContent += `\n${line}`;
      consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
    },
    onStderr: (line, friendly) => {
      consoleOutputEl.textContent += `\n❌ ${line}`;
      consoleOutputEl.scrollTop = consoleOutputEl.scrollHeight;
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
        runtimeStatusEl.textContent = 'Game Running (60 FPS)';
        runtimeStatusEl.className = 'status-pill status-running';
        btnStop.disabled = false;
        canvasOverlayEl.classList.add('hidden');
      } else {
        runtimeStatusEl.textContent = 'Python Ready';
        runtimeStatusEl.className = 'status-pill status-ready';
        btnStop.disabled = true;
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

  function runLiveDiagnostics(code: string): void {
    currentDiagnostics = analyzePythonCodeForLearners(code);
    editor.setDiagnostics(currentDiagnostics);

    if (currentDiagnostics.length === 0) {
      syntaxBadgeEl.textContent = '✓ No Syntax Issues';
      syntaxBadgeEl.className = 'badge badge-ok';
      showDiagnosticBanner(null);
    } else {
      const first = currentDiagnostics[0];
      syntaxBadgeEl.textContent = `${currentDiagnostics.length} Hint${
        currentDiagnostics.length > 1 ? 's' : ''
      } (Line ${first.line})`;
      syntaxBadgeEl.className =
        first.severity === 'error' ? 'badge badge-err' : 'badge badge-warn';
      showDiagnosticBanner(first);
    }
  }

  // 5. File List & Cheatsheets Rendering
  function renderFileList(): void {
    fileListEl.innerHTML = '';
    const active = workspace.getActiveFileName();
    activeFilenameEl.textContent = active;

    for (const filename of workspace.getFileNames()) {
      const li = document.createElement('li');
      li.className = `file-item ${filename === active ? 'active' : ''}`;
      li.innerHTML = `<span>📄 ${filename}</span>`;
      li.addEventListener('click', () => {
        const content = workspace.setActiveFile(filename);
        editor.setValue(content);
        renderFileList();
        runLiveDiagnostics(content);
        switchCenterView('code');
      });
      fileListEl.appendChild(li);
    }
  }

  function buildTutorContext(): TutorCodeContext {
    const cursor = editor.getCursorContext();
    const firstDiag = activeBannerDiagnostic || currentDiagnostics[0];
    return {
      activeFile: workspace.getActiveFileName(),
      fullCode: editor.getValue(),
      selectedText: cursor.selectedText,
      cursorWord: cursor.cursorWord,
      cursorLineNumber: cursor.lineNumber,
      cursorLineText: cursor.lineText,
      projectFiles: workspace.getFileNames(),
      activeError: firstDiag
        ? {
            line: firstDiag.line,
            title: firstDiag.title,
            friendlyExplanation: firstDiag.friendlyExplanation,
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

  // 6. Wire UI Events & Focus Mode / Game Full Window & Fullscreen Toggles
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
  });

  btnToggleRightPanel.addEventListener('click', () => {
    workspaceEl.classList.toggle('hide-right');
    updateLayoutToggleButtons();
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
  });

  function setTheaterMode(enabled: boolean): void {
    canvasWrapperEl.classList.toggle('theater-mode', enabled);
    theaterToolbarEl.classList.toggle('hidden', !enabled);
    if (enabled) {
      // Auto-start game if not running yet so the player can immediately play!
      if (!runtime.isRunning()) {
        consoleOutputEl.textContent = `▶ Running ${workspace.getActiveFileName()}...`;
        runtime.runCode(editor.getValue());
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
    consoleOutputEl.textContent = `▶ Restarting ${workspace.getActiveFileName()}...`;
    runtime.runCode(editor.getValue());
    canvasEl.focus();
  });

  btnFullscreenGame.addEventListener('click', async () => {
    if (!runtime.isRunning()) {
      consoleOutputEl.textContent = `▶ Running ${workspace.getActiveFileName()}...`;
      runtime.runCode(editor.getValue());
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
      // Fallback to Full Window Theater Mode if browser blocks Fullscreen API
      setTheaterMode(true);
    }
  });

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && !canvasWrapperEl.classList.contains('theater-mode')) {
      theaterToolbarEl.classList.add('hidden');
    }
  });

  window.addEventListener('keydown', (e) => {
    // Esc exits Full Window Theater Mode
    if (e.key === 'Escape' && canvasWrapperEl.classList.contains('theater-mode')) {
      setTheaterMode(false);
    }
    // Ctrl+B toggles Focus Mode
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      btnFocusMode.click();
    }
  });

  btnToggleDebug.addEventListener('click', () => {
    aiDebugPanelEl.classList.toggle('hidden');
  });

  btnAiSetupHelp.addEventListener('click', () => {
    chromeFlagsHelpDrawerEl.classList.toggle('hidden');
  });

  btnCloseFlagsHelp.addEventListener('click', () => {
    chromeFlagsHelpDrawerEl.classList.add('hidden');
  });

  btnWebgpuHelp.addEventListener('click', () => {
    chromeFlagsHelpDrawerEl.classList.toggle('hidden');
  });

  btnClearDebug.addEventListener('click', () => {
    aiDebugLogEl.textContent = 'Waiting for AI activity...';
    aiDebugStreamEl.textContent = '(No tokens generated yet)';
  });

  btnRun.addEventListener('click', () => {
    consoleOutputEl.textContent = `▶ Running ${workspace.getActiveFileName()}...`;
    runtime.runCode(editor.getValue());
  });

  btnStop.addEventListener('click', () => {
    runtime.stop();
    consoleOutputEl.textContent += '\n⏹ Game stopped.';
  });

  btnClearConsole.addEventListener('click', () => {
    consoleOutputEl.textContent = '';
  });

  templateSelect.addEventListener('change', () => {
    runtime.stop();
    workspace.loadFromStorageOrTemplate(templateSelect.value);
    editor.setValue(workspace.getActiveFileContent());
    renderFileList();
    runLiveDiagnostics(editor.getValue());
  });

  btnOpenFolder.addEventListener('click', async () => {
    const ok = await workspace.openLocalDirectory();
    if (ok) {
      editor.setValue(workspace.getActiveFileContent());
      renderFileList();
      runLiveDiagnostics(editor.getValue());
    }
  });

  btnSaveProject.addEventListener('click', () => {
    workspace.saveToStorage();
    consoleOutputEl.textContent += `\n💾 Saved ${workspace.getActiveFileName()} to local workspace.`;
  });

  btnNewFile.addEventListener('click', () => {
    const name = prompt('Enter a name for your new Python file:', 'helper.py');
    if (name && name.trim()) {
      workspace.createFile(name.trim());
      editor.setValue(workspace.getActiveFileContent());
      renderFileList();
    }
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
      // Make sure the right Tutor panel is visible if the user was in Focus Mode
      if (workspaceEl.classList.contains('hide-right')) {
        workspaceEl.classList.remove('hide-right');
        updateLayoutToggleButtons();
      }
      askTutorQuestion(
        `I got an error on line ${diag.line}: "${diag.friendlyExplanation}". Can you explain why this happened and give me a hint to fix it without writing the code for me?`
      );
    }
  });

  llmBackendSelect.addEventListener('change', async () => {
    const id = llmBackendSelect.value as LLMBackendId;
    await tutor.setBackend(id);
  });

  btnLoadModel.addEventListener('click', async () => {
    try {
      await tutor.initActiveBackend();
    } catch {
      // Status bar already updated via progress callback
    }
  });

  tutorForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = tutorInput.value.trim();
    if (!q) return;
    tutorInput.value = '';
    await askTutorQuestion(q);
  });

  document.querySelectorAll('.asset-item').forEach((item) => {
    item.addEventListener('click', () => {
      const snippet = item.getAttribute('data-snippet');
      if (snippet) {
        editor.insertSnippetAtCursor(snippet);
      }
    });
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
      switchCenterView('code');
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
        // Fallback if clipboard permission denied
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

  cheatsheetContentEl.innerHTML = CHEATSHEETS.coords;
  renderFileList();
  runLiveDiagnostics(editor.getValue());
  initPwa(document.getElementById('btn-install-pwa'));
}

bootstrapPywlet();
