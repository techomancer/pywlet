import { CodeEditorController } from './editor/monaco-setup';
import { analyzePythonCodeForLearners, type PythonDiagnostic } from './diagnostics/python-coach';
import { PythonPygameRuntime } from './runtime/python-runtime';
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
  let workspaceBrowserOpen = false;
  let spriteSheetViewMode: 'visual' | 'code' = 'visual';
  let spriteDataWriteProtected = true;

  // DOM Elements
  const workspaceEl = document.querySelector('.workspace') as HTMLElement;
  const monacoContainer = document.getElementById('monaco-container')!;
  const spriteStudioContainer = document.getElementById('sprite-studio-container')!;
  const wavEditorContainer = document.getElementById('wav-editor-container')!;

  const topbarWorkspaceNameEl = document.getElementById('topbar-workspace-name')!;
  const btnActiveWorkspacePill = document.getElementById('btn-active-workspace-pill')!;
  const sidebarWorkspaceNameEl = document.getElementById('sidebar-workspace-name')!;
  const btnToggleWorkspaceBrowser = document.getElementById('btn-toggle-workspace-browser')!;
  const workspaceBrowserPanel = document.getElementById('workspace-browser-panel')!;
  const workspaceFilesPanel = document.getElementById('workspace-files-panel')!;
  const savedWorkspacesListEl = document.getElementById('saved-workspaces-list')!;
  const savedWorkspacesCountEl = document.getElementById('saved-workspaces-count')!;
  const exampleWorkspacesListEl = document.getElementById('example-workspaces-list')!;
  const btnNewEmptyWorkspace = document.getElementById('btn-new-empty-workspace')!;

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
  const btnSaveProject = document.getElementById('btn-save-project') as HTMLButtonElement;
  const btnStartTour = document.getElementById('btn-start-tour')!;
  const btnNewPy = document.getElementById('btn-new-py')!;
  const btnNewPng = document.getElementById('btn-new-png')!;
  const btnNewWav = document.getElementById('btn-new-wav')!;
  const btnNewSpritesSheet = document.getElementById('btn-new-sprites-sheet')!;
  const inputImportFile = document.getElementById('input-import-workspace-file') as HTMLInputElement;
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
    }
  );

  const spriteEditor = new SpriteEditorController(spriteStudioContainer, {
    onSaveToPythonFile: (filename, pyCode) => {
      workspace.setFileContent(filename, pyCode);
      if (workspace.getActiveFileName() === filename && spriteSheetViewMode === 'code') {
        editor.setValue(pyCode);
      }
      renderFileList();
    },
    onReadPythonFile: (filename) => workspace.getFileContent(filename),
    onSavePngFile: (filename, dataUrl) => {
      workspace.setFileContent(filename, dataUrl);
      renderFileList();
    },
  });

  const wavEditor = new WavEditorController(wavEditorContainer, {
    onSaveWavFile: (filename, dataUrl) => {
      workspace.setFileContent(filename, dataUrl);
      renderFileList();
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

    // Sync workspace read-only state across banners and editors
    readonlyWorkspaceBannerEl.classList.toggle('hidden', !isWsReadOnly);
    btnSaveProject.disabled = isWsReadOnly;
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
        isWsReadOnly,
        '📖 This is a read-only Example Workspace. Click "📋 Clone to Edit" above to create your own editable copy!'
      );
      editor.setValue(content);
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
            ? '📖 This is a read-only Example Workspace. Click "📋 Clone to Edit" above to create your own editable copy!'
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

  // 6. Left Sidebar: Workspace Browser & File List Rendering
  function setWorkspaceBrowserOpen(open: boolean): void {
    workspaceBrowserOpen = open;
    workspaceBrowserPanel.classList.toggle('hidden', !open);
    workspaceFilesPanel.classList.toggle('hidden', open);
    btnToggleWorkspaceBrowser.textContent = open ? '← Back to Files' : '📚 Workspaces';
    btnToggleWorkspaceBrowser.classList.toggle('active-toggle', open);
    if (open) {
      renderWorkspaceBrowser();
    }
  }

  function updateWorkspaceHeaders(): void {
    const ws = workspace.getActiveWorkspace();
    const isRo = workspace.isActiveWorkspaceReadOnly();
    topbarWorkspaceNameEl.textContent = isRo ? `📖 ${ws.name}` : ws.name;
    sidebarWorkspaceNameEl.textContent = isRo ? `📖 ${ws.name}` : ws.name;
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
          <button class="icon-btn ws-rename-btn" title="Rename workspace">✏️</button>
          <button class="icon-btn ws-dup-btn" title="Duplicate workspace">📋</button>
          <button class="icon-btn ws-del-btn" title="Delete workspace">🗑</button>
        </div>
      `;
      li.querySelector('.ws-card-title span')!.textContent = ws.name;

      li.querySelector('.ws-card-main')!.addEventListener('click', () => {
        runtime.stop();
        workspace.openWorkspace(ws.id);
        syncSpriteProjectFromWorkspace();
        updateWorkspaceHeaders();
        setWorkspaceBrowserOpen(false);
        openActiveFileInEditor(true);
      });

      li.querySelector('.ws-rename-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextName = prompt('Rename workspace:', ws.name);
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
        updateWorkspaceHeaders();
        setWorkspaceBrowserOpen(false);
        openActiveFileInEditor(true);
      });

      li.querySelector('.ws-del-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete workspace "${ws.name}" from browser storage?`)) return;
        runtime.stop();
        workspace.deleteWorkspace(ws.id);
        syncSpriteProjectFromWorkspace();
        updateWorkspaceHeaders();
        renderWorkspaceBrowser();
        openActiveFileInEditor(true);
      });

      savedWorkspacesListEl.appendChild(li);
    }

    // Example workspaces (click card to preview read-only, click Clone to clone & switch)
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
        <button class="btn btn-small btn-Ask ws-clone-btn" title="Clone this example into your saved workspaces and switch to it">Clone</button>
      `;
      li.querySelector('.ws-card-title span')!.textContent = tpl.name;
      li.querySelector('.ws-card-meta')!.textContent = tpl.description;

      li.querySelector('.ws-card-main')!.addEventListener('click', () => {
        runtime.stop();
        workspace.openExampleWorkspaceReadOnly(tpl.id);
        syncSpriteProjectFromWorkspace();
        updateWorkspaceHeaders();
        setWorkspaceBrowserOpen(false);
        openActiveFileInEditor(true);
        appendConsole(`📖 Opened example "${tpl.name}" in read-only mode. Click "Clone to Edit" to make your own copy!`);
      });

      li.querySelector('.ws-clone-btn')!.addEventListener('click', (e) => {
        e.stopPropagation();
        runtime.stop();
        const created = workspace.cloneExampleWorkspace(tpl.id);
        syncSpriteProjectFromWorkspace();
        updateWorkspaceHeaders();
        setWorkspaceBrowserOpen(false);
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
          if (!confirm(`Delete "${filename}" from this workspace?`)) return;
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
    return {
      activeFile: isCodeVisible ? activeName : runnable?.filename || activeName,
      fullCode: isCodeVisible ? editor.getValue() : runnable?.code || '',
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

  function runActiveGame(): void {
    const runnable = workspace.getRunnablePythonFile();
    if (!runnable) {
      appendConsole('❌ No runnable Python file found in this workspace.');
      return;
    }
    syncSpriteProjectFromWorkspace();
    consoleOutputEl.textContent = `▶ Running ${runnable.filename}...`;
    runtime.runCode(runnable.code);
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

  btnToggleWorkspaceBrowser.addEventListener('click', () => {
    setWorkspaceBrowserOpen(!workspaceBrowserOpen);
  });

  btnActiveWorkspacePill.addEventListener('click', () => {
    if (workspaceEl.classList.contains('hide-left')) {
      workspaceEl.classList.remove('hide-left');
      updateLayoutToggleButtons();
    }
    setWorkspaceBrowserOpen(!workspaceBrowserOpen);
  });

  btnNewEmptyWorkspace.addEventListener('click', () => {
    const name = prompt('Name your new empty workspace:', 'My Cool Game');
    if (!name || !name.trim()) return;
    runtime.stop();
    workspace.createEmptyWorkspace(name.trim());
    updateWorkspaceHeaders();
    setWorkspaceBrowserOpen(false);
    openActiveFileInEditor(true);
    appendConsole(`✨ Created empty workspace "${name.trim()}".`);
  });

  btnOpenFolder.addEventListener('click', async () => {
    const ok = await workspace.openLocalDirectory();
    if (ok) {
      runtime.stop();
      syncSpriteProjectFromWorkspace();
      updateWorkspaceHeaders();
      setWorkspaceBrowserOpen(false);
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
    appendConsole(`🌟 Cloned example into editable workspace "${created.name}".`);
  }

  btnCloneActiveExample.addEventListener('click', handleCloneActiveExample);
  btnCloneExampleSidebar.addEventListener('click', handleCloneActiveExample);

  btnSaveProject.addEventListener('click', () => {
    if (workspace.isActiveWorkspaceReadOnly()) {
      handleCloneActiveExample();
      return;
    }
    workspace.saveToStorage();
    appendConsole(`💾 Saved workspace "${workspace.getActiveWorkspace().name}" to browser storage.`);
  });

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
      appendConsole(`📤 Imported ${file.name} into workspace.`);
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
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      workspace.saveToStorage();
      appendConsole(`💾 Saved workspace "${workspace.getActiveWorkspace().name}".`);
    }
  });

  btnToggleDebug.addEventListener('click', () => aiDebugPanelEl.classList.toggle('hidden'));
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

  llmBackendSelect.addEventListener('change', async () => {
    const id = llmBackendSelect.value as LLMBackendId;
    await tutor.setBackend(id);
  });

  btnLoadModel.addEventListener('click', async () => {
    try {
      await tutor.initActiveBackend();
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

  // Initial Startup Sync
  cheatsheetContentEl.innerHTML = CHEATSHEETS.coords;
  syncSpriteProjectFromWorkspace();
  updateWorkspaceHeaders();
  openActiveFileInEditor(true);
  initPwa(document.getElementById('btn-install-pwa'));

  // Optional kid-friendly UI walkthrough overlay (auto-shows once on first visit)
  const uiTour = new UiTourOverlay(() => {
    // Ensure both sidebars are visible during the walkthrough
    workspaceEl.classList.remove('hide-left', 'hide-right');
    updateLayoutToggleButtons();
    setWorkspaceBrowserOpen(false);
  });
  btnStartTour.addEventListener('click', () => uiTour.start());
  uiTour.startIfFirstVisit();
}

void bootstrapPywlet();
