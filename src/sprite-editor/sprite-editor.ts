import {
  cloneGrid,
  createEmptyGrid,
  createEmptyRectGrid,
  createSpriteCell,
  createStarterSpriteProject,
  flattenSpriteLayers,
  parsePythonToSpriteProject,
  resizeSpriteSheet,
  resizeTileMap,
  serializeSpriteProjectToPython,
  type NamedSpriteSheet,
  type NamedTileMap,
  type PixelTool,
  type SpriteCell,
  type SpriteProjectData,
} from './sprite-data';

export interface SpriteEditorCallbacks {
  onSaveToPythonFile: (filename: string, pyCode: string) => void;
  onReadPythonFile: (filename: string) => string | null;
}

const NEIGHBOR_DIRECTIONS = ['NW', 'N', 'NE', 'W', 'E', 'SW', 'S', 'SE'] as const;

export class SpriteEditorController {
  private container: HTMLElement;
  private callbacks: SpriteEditorCallbacks;
  private data: SpriteProjectData;

  private activeSpriteIdx = 0;
  private activeLayerIdx = 0;
  private activeTool: PixelTool = 'pencil';
  private activeColorIdx = 9; // Grass green default
  private showGrid = true;

  private clipboardGrid: number[][] | null = null;
  private undoStack: number[][][] = [];

  private pixelCanvas!: HTMLCanvasElement;
  private pixelCtx!: CanvasRenderingContext2D;
  private sheetCanvas!: HTMLCanvasElement;
  private sheetCtx!: CanvasRenderingContext2D;
  private mapCanvas!: HTMLCanvasElement;
  private mapCtx!: CanvasRenderingContext2D;

  private isDrawing = false;
  private dragStartCell: { x: number; y: number } | null = null;
  private dragSnapshot: number[][] | null = null;
  private isPaintingMap = false;

  constructor(container: HTMLElement, callbacks: SpriteEditorCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.data = createStarterSpriteProject(8);

    this.buildDOM();
    this.renderAll();
  }

  public getProjectData(): SpriteProjectData {
    return this.data;
  }

  public loadFromPythonString(pyCode: string): void {
    this.data = parsePythonToSpriteProject(pyCode, this.data);
    this.activeSpriteIdx = 0;
    this.activeLayerIdx = 0;
    this.renderAll();
  }

  private getActiveSheet(): NamedSpriteSheet {
    const sheet = this.data.sheets[this.data.activeSheetName];
    if (sheet) return sheet;
    const firstKey = Object.keys(this.data.sheets)[0];
    this.data.activeSheetName = firstKey;
    return this.data.sheets[firstKey];
  }

  private getActiveMap(): NamedTileMap {
    const map = this.data.maps[this.data.activeMapName];
    if (map) return map;
    const firstKey = Object.keys(this.data.maps)[0];
    this.data.activeMapName = firstKey;
    return this.data.maps[firstKey];
  }

  private getActiveSprite(): SpriteCell {
    const sheet = this.getActiveSheet();
    if (this.activeSpriteIdx >= sheet.sprites.length) {
      this.activeSpriteIdx = 0;
    }
    return sheet.sprites[this.activeSpriteIdx] || sheet.sprites[0];
  }

  private getActiveLayerPixels(): number[][] {
    const sp = this.getActiveSprite();
    const layer = sp.layers[this.activeLayerIdx] || sp.layers[0];
    return layer.pixels;
  }

  private pushUndo(): void {
    this.undoStack.push(cloneGrid(this.getActiveLayerPixels()));
    if (this.undoStack.length > 30) {
      this.undoStack.shift();
    }
  }

  private buildDOM(): void {
    this.container.innerHTML = `
      <div class="sprite-studio">
        <!-- Studio Top Action Bar -->
        <div class="sprite-toolbar">
          <div class="sprite-toolbar-group">
            <label>Sheet:</label>
            <select id="sp-sheet-select" class="select-control select-small" title="Select Named Sprite Sheet"></select>
            <button id="sp-btn-new-sheet" class="icon-btn" title="Create a new named Sprite Sheet">+ Sheet</button>

            <label>Sprite Size:</label>
            <select id="sp-size-select" class="select-control select-small">
              <option value="8">8 × 8 px</option>
              <option value="16">16 × 16 px</option>
              <option value="32">32 × 32 px</option>
            </select>

            <label>Sheet Grid:</label>
            <select id="sp-sheet-dim-select" class="select-control select-small" title="Number of sprites in this sheet">
              <option value="4x4">4 × 4 (16 sprites)</option>
              <option value="6x6">6 × 6 (36 sprites)</option>
              <option value="8x8">8 × 8 (64 sprites)</option>
            </select>

            <label class="checkbox-label">
              <input type="checkbox" id="sp-seamless-toggle" checked />
              🔄 8-Way Seamless View
            </label>

            <label class="checkbox-label">
              <input type="checkbox" id="sp-grid-toggle" checked />
              # Grid
            </label>
          </div>

          <div class="sprite-toolbar-group">
            <button id="sp-btn-load-py" class="btn btn-small" title="Load PALETTE, SPRITE_SHEETS & TILEMAPS from sprites_data.py">
              📥 Load .py
            </button>
            <button id="sp-btn-save-py" class="btn btn-small btn-run" title="Save PALETTE, SPRITE_SHEETS & TILEMAPS into sprites_data.py">
              🐍 Save to sprites_data.py
            </button>
            <button id="sp-btn-export-png" class="btn btn-small" title="Download active Sprite Sheet as PNG">
              🖼 Export .PNG
            </button>
            <label class="btn btn-small" title="Import a PNG into current sprite">
              📂 Import .PNG
              <input type="file" id="sp-input-import-png" accept="image/png" class="hidden-file-input" />
            </label>
          </div>
        </div>

        <!-- 3-Column Studio Body -->
        <div class="sprite-studio-body">
          <!-- LEFT COLUMN: Tools, Expandable Palette, Layers & 8-Neighbor Selector -->
          <div class="sprite-left-col">
            <div class="sprite-card">
              <div class="section-header"><span>🛠 DRAWING TOOLS</span></div>
              <div class="tool-grid">
                <button class="tool-btn active" data-tool="pencil" title="Pencil (Draw pixel)">✏️ Pencil</button>
                <button class="tool-btn" data-tool="eraser" title="Eraser (Transparent pixel)">🧽 Eraser</button>
                <button class="tool-btn" data-tool="bucket" title="Flood Fill Bucket">🪣 Fill</button>
                <button class="tool-btn" data-tool="line" title="Line Tool (Drag)">📏 Line</button>
                <button class="tool-btn" data-tool="rect" title="Rectangle Tool (Drag)">⬛ Rect</button>
                <button class="tool-btn" data-tool="eyedropper" title="Pick color from canvas">🧪 Pick</button>
              </div>
              <div class="tool-actions-row">
                <button id="sp-btn-undo" class="icon-btn" title="Undo last stroke">↩ Undo</button>
                <button id="sp-btn-copy" class="icon-btn" title="Copy current sprite">📋 Copy</button>
                <button id="sp-btn-paste" class="icon-btn" title="Paste into current sprite">📥 Paste</button>
                <button id="sp-btn-flip-h" class="icon-btn" title="Flip Horizontally">↔ Flip H</button>
                <button id="sp-btn-clear" class="icon-btn" title="Clear active layer">🗑 Clear</button>
              </div>
            </div>

            <!-- Expandable Custom Color Palette Card -->
            <div class="sprite-card">
              <div class="section-header">
                <span>🎨 PALETTE (<span id="sp-palette-count">16</span> colors)</span>
                <div class="palette-header-controls">
                  <input type="color" id="sp-custom-color" value="#22c55e" title="Edit selected color or pick color to add" />
                  <button id="sp-btn-add-color" class="icon-btn" title="Add a new custom color slot to the palette">+ Add Color</button>
                </div>
              </div>
              <div id="sp-palette-grid" class="palette-grid"></div>
            </div>

            <!-- Layers Card -->
            <div class="sprite-card">
              <div class="section-header">
                <span>🧅 LAYERS</span>
                <button id="sp-btn-merge-layers" class="icon-btn" title="Merge Layer 2 down into Layer 1">Merge ↓</button>
              </div>
              <div id="sp-layer-list" class="layer-list"></div>
            </div>

            <!-- 8-Way Seamless Tiling Neighbor Selector -->
            <div class="sprite-card">
              <div class="section-header">
                <span>🧭 8-WAY SEAMLESS NEIGHBORS</span>
                <button id="sp-btn-neighbors-self" class="icon-btn" title="Set all 8 surrounding preview tiles to Self">All Self</button>
              </div>
              <p class="helper-note">Pick which sprite from the sheet borders each of the 8 sides:</p>
              <div id="sp-neighbor-compass" class="neighbor-compass"></div>
            </div>
          </div>

          <!-- CENTER COLUMN: 3x3 Seamless Tiling Pixel Canvas -->
          <div class="sprite-center-col">
            <div class="section-header">
              <span id="sp-active-label">🎯 EDITING SPRITE #0 (grass_tile)</span>
              <span id="sp-cursor-pos" class="coord-readout">Pixel: (0, 0)</span>
            </div>
            <div class="pixel-canvas-stage">
              <canvas id="sp-pixel-canvas" width="384" height="384"></canvas>
            </div>
            <div class="pixel-stage-legend">
              <span>Center square = <strong>Active Editable Sprite</strong></span>
              <span>Outer 8 squares = <strong>Live Seamless Tiling Neighbors</strong> (draw right across the borders!)</span>
            </div>
          </div>

          <!-- RIGHT COLUMN: Named Sprite Sheet Grid & Named Level Tilemap Editor -->
          <div class="sprite-right-col">
            <!-- Named Sprite Sheet Picker (4x4, 6x6, or 8x8) -->
            <div class="sprite-card">
              <div class="section-header">
                <span id="sp-sheet-title">📑 SHEET: overworld</span>
                <input id="sp-sprite-name" type="text" class="sprite-name-input" value="grass_tile" title="Rename active sprite" />
              </div>
              <div class="sheet-canvas-wrap">
                <canvas id="sp-sheet-canvas" width="240" height="240"></canvas>
              </div>
            </div>

            <!-- Named Level Map / Tilemap Editor with Selectable Dimensions -->
            <div class="sprite-card tilemap-card">
              <div class="section-header">
                <span>🗺️ LEVEL MAPS</span>
                <div class="map-header-controls">
                  <select id="sp-map-select" class="select-control select-small" title="Select Named Map"></select>
                  <button id="sp-btn-new-map" class="icon-btn" title="Create a new named Level Map">+ Map</button>
                </div>
              </div>
              <div class="map-subtoolbar">
                <label>Size:</label>
                <select id="sp-map-dim-select" class="select-control select-small" title="Select Map Grid Dimensions">
                  <option value="12x8">12 × 8 (Small)</option>
                  <option value="16x12">16 × 12 (Medium)</option>
                  <option value="24x16">24 × 16 (Large)</option>
                  <option value="32x24">32 × 24 (Huge World)</option>
                </select>
                <button id="sp-btn-fill-map" class="icon-btn" title="Fill active map with selected sprite">Fill All</button>
                <button id="sp-btn-clear-map" class="icon-btn" title="Clear active map">Clear</button>
              </div>
              <div class="map-canvas-wrap">
                <canvas id="sp-map-canvas" width="312" height="208"></canvas>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.pixelCanvas = this.container.querySelector('#sp-pixel-canvas') as HTMLCanvasElement;
    this.pixelCtx = this.pixelCanvas.getContext('2d')!;
    this.sheetCanvas = this.container.querySelector('#sp-sheet-canvas') as HTMLCanvasElement;
    this.sheetCtx = this.sheetCanvas.getContext('2d')!;
    this.mapCanvas = this.container.querySelector('#sp-map-canvas') as HTMLCanvasElement;
    this.mapCtx = this.mapCanvas.getContext('2d')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    // Tool buttons
    this.container.querySelectorAll('.tool-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.container.querySelectorAll('.tool-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = (btn.getAttribute('data-tool') as PixelTool) || 'pencil';
      });
    });

    // Named Sprite Sheet Selector & "+ Sheet" button
    const sheetSelect = this.container.querySelector('#sp-sheet-select') as HTMLSelectElement;
    sheetSelect.addEventListener('change', () => {
      if (sheetSelect.value in this.data.sheets) {
        this.data.activeSheetName = sheetSelect.value;
        this.activeSpriteIdx = 0;
        this.undoStack = [];
        // Also link active map to this sheet if desired
        this.getActiveMap().sheetName = this.data.activeSheetName;
        this.renderAll();
      }
    });

    this.container.querySelector('#sp-btn-new-sheet')?.addEventListener('click', () => {
      const rawName = prompt('Enter a name for the new Sprite Sheet (e.g. characters, space_tiles):', 'space_tiles');
      if (!rawName) return;
      const cleanName = rawName.trim().replace(/[^a-zA-Z0-9_]/g, '_') || 'sheet_new';
      if (!(cleanName in this.data.sheets)) {
        const cur = this.getActiveSheet();
        this.data.sheets[cleanName] = {
          name: cleanName,
          spriteSize: cur.spriteSize,
          cols: cur.cols,
          rows: cur.rows,
          sprites: Array.from({ length: cur.cols * cur.rows }, (_, i) =>
            createSpriteCell(i, cur.spriteSize, `${cleanName}_${i}`)
          ),
        };
      }
      this.data.activeSheetName = cleanName;
      this.activeSpriteIdx = 0;
      this.renderAll();
    });

    // Sprite Size (8x8, 16x16, 32x32)
    const sizeSelect = this.container.querySelector('#sp-size-select') as HTMLSelectElement;
    sizeSelect.addEventListener('change', () => {
      const nextSize = Number(sizeSelect.value) || 8;
      const sheet = this.getActiveSheet();
      if (nextSize !== sheet.spriteSize) {
        resizeSpriteSheet(sheet, nextSize, sheet.cols, sheet.rows);
        this.renderAll();
      }
    });

    // Sheet Grid Dimensions (4x4, 6x6, 8x8)
    const sheetDimSelect = this.container.querySelector('#sp-sheet-dim-select') as HTMLSelectElement;
    sheetDimSelect.addEventListener('change', () => {
      const [cStr, rStr] = sheetDimSelect.value.split('x');
      const nextCols = Number(cStr) || 4;
      const nextRows = Number(rStr) || 4;
      const sheet = this.getActiveSheet();
      if (nextCols !== sheet.cols || nextRows !== sheet.rows) {
        resizeSpriteSheet(sheet, sheet.spriteSize, nextCols, nextRows);
        if (this.activeSpriteIdx >= sheet.sprites.length) {
          this.activeSpriteIdx = 0;
        }
        this.renderAll();
      }
    });

    // Named Map Selector, "+ Map" button, and Map Dimensions (12x8 up to 32x24)
    const mapSelect = this.container.querySelector('#sp-map-select') as HTMLSelectElement;
    mapSelect.addEventListener('change', () => {
      if (mapSelect.value in this.data.maps) {
        this.data.activeMapName = mapSelect.value;
        const map = this.getActiveMap();
        if (map.sheetName in this.data.sheets) {
          this.data.activeSheetName = map.sheetName;
        }
        this.renderAll();
      }
    });

    this.container.querySelector('#sp-btn-new-map')?.addEventListener('click', () => {
      const rawName = prompt('Enter a name for the new Level Map (e.g. level_3, boss_room):', 'level_3');
      if (!rawName) return;
      const cleanName = rawName.trim().replace(/[^a-zA-Z0-9_]/g, '_') || 'map_new';
      if (!(cleanName in this.data.maps)) {
        const curMap = this.getActiveMap();
        this.data.maps[cleanName] = {
          name: cleanName,
          sheetName: this.data.activeSheetName,
          cols: curMap.cols,
          rows: curMap.rows,
          tiles: createEmptyRectGrid(curMap.rows, curMap.cols, 0),
        };
      }
      this.data.activeMapName = cleanName;
      this.renderAll();
    });

    const mapDimSelect = this.container.querySelector('#sp-map-dim-select') as HTMLSelectElement;
    mapDimSelect.addEventListener('change', () => {
      const [cStr, rStr] = mapDimSelect.value.split('x');
      const nextCols = Number(cStr) || 12;
      const nextRows = Number(rStr) || 8;
      const map = this.getActiveMap();
      if (nextCols !== map.cols || nextRows !== map.rows) {
        resizeTileMap(map, nextCols, nextRows);
        this.renderMapCanvas();
      }
    });

    // Toggles
    const seamlessToggle = this.container.querySelector('#sp-seamless-toggle') as HTMLInputElement;
    seamlessToggle.addEventListener('change', () => {
      this.data.showSeamlessNeighbors = seamlessToggle.checked;
      this.renderPixelCanvas();
    });

    const gridToggle = this.container.querySelector('#sp-grid-toggle') as HTMLInputElement;
    gridToggle.addEventListener('change', () => {
      this.showGrid = gridToggle.checked;
      this.renderPixelCanvas();
    });

    // Quick actions
    this.container.querySelector('#sp-btn-undo')?.addEventListener('click', () => {
      const prev = this.undoStack.pop();
      if (prev) {
        const sp = this.getActiveSprite();
        sp.layers[this.activeLayerIdx].pixels = prev;
        this.renderAll();
      }
    });

    this.container.querySelector('#sp-btn-copy')?.addEventListener('click', () => {
      const sheet = this.getActiveSheet();
      this.clipboardGrid = cloneGrid(flattenSpriteLayers(this.getActiveSprite(), sheet.spriteSize));
    });

    this.container.querySelector('#sp-btn-paste')?.addEventListener('click', () => {
      if (!this.clipboardGrid) return;
      this.pushUndo();
      const sheet = this.getActiveSheet();
      const sp = this.getActiveSprite();
      const next = createEmptyGrid(sheet.spriteSize, 0);
      for (let y = 0; y < Math.min(sheet.spriteSize, this.clipboardGrid.length); y++) {
        for (let x = 0; x < Math.min(sheet.spriteSize, this.clipboardGrid[y].length); x++) {
          next[y][x] = this.clipboardGrid[y][x];
        }
      }
      sp.layers[this.activeLayerIdx].pixels = next;
      this.renderAll();
    });

    this.container.querySelector('#sp-btn-flip-h')?.addEventListener('click', () => {
      this.pushUndo();
      const grid = this.getActiveLayerPixels();
      grid.forEach((row) => row.reverse());
      this.renderAll();
    });

    this.container.querySelector('#sp-btn-clear')?.addEventListener('click', () => {
      this.pushUndo();
      const sheet = this.getActiveSheet();
      const sp = this.getActiveSprite();
      sp.layers[this.activeLayerIdx].pixels = createEmptyGrid(sheet.spriteSize, 0);
      this.renderAll();
    });

    this.container.querySelector('#sp-btn-merge-layers')?.addEventListener('click', () => {
      this.pushUndo();
      const sheet = this.getActiveSheet();
      const sp = this.getActiveSprite();
      const flat = flattenSpriteLayers(sp, sheet.spriteSize);
      sp.layers[0].pixels = flat;
      if (sp.layers[1]) {
        sp.layers[1].pixels = createEmptyGrid(sheet.spriteSize, 0);
      }
      this.activeLayerIdx = 0;
      this.renderAll();
    });

    this.container.querySelector('#sp-btn-neighbors-self')?.addEventListener('click', () => {
      this.data.neighborSlots = [-1, -1, -1, -1, -1, -1, -1, -1];
      this.renderNeighborCompass();
      this.renderPixelCanvas();
    });

    // Custom Palette Color Picker & "+ Add Color" button
    const customColorInput = this.container.querySelector('#sp-custom-color') as HTMLInputElement;
    customColorInput.addEventListener('input', () => {
      if (this.activeColorIdx > 0) {
        this.data.palette[this.activeColorIdx] = customColorInput.value;
        this.renderAll();
      }
    });

    this.container.querySelector('#sp-btn-add-color')?.addEventListener('click', () => {
      const newHex = customColorInput.value || '#38bdf8';
      this.data.palette.push(newHex);
      this.activeColorIdx = this.data.palette.length - 1;
      this.renderPalette();
    });

    // Sprite Name Input
    const nameInput = this.container.querySelector('#sp-sprite-name') as HTMLInputElement;
    nameInput.addEventListener('input', () => {
      this.getActiveSprite().name = nameInput.value.trim() || `sprite_${this.activeSpriteIdx}`;
      this.updateActiveHeader();
    });

    // Save / Load Python Arrays (`sprites_data.py`)
    this.container.querySelector('#sp-btn-save-py')?.addEventListener('click', () => {
      const pyCode = serializeSpriteProjectToPython(this.data);
      this.callbacks.onSaveToPythonFile('sprites_data.py', pyCode);
    });

    this.container.querySelector('#sp-btn-load-py')?.addEventListener('click', () => {
      const pyCode = this.callbacks.onReadPythonFile('sprites_data.py');
      if (pyCode) {
        this.loadFromPythonString(pyCode);
      } else {
        alert('No sprites_data.py found in project yet! Click "🐍 Save to sprites_data.py" first.');
      }
    });

    // Export / Import PNG
    this.container.querySelector('#sp-btn-export-png')?.addEventListener('click', () => {
      this.exportSpriteSheetPng();
    });

    const importInput = this.container.querySelector('#sp-input-import-png') as HTMLInputElement;
    importInput.addEventListener('change', () => {
      const file = importInput.files?.[0];
      if (file) {
        this.importPngFile(file);
        importInput.value = '';
      }
    });

    // Pixel Canvas Pointer Events
    this.pixelCanvas.addEventListener('mousedown', (e) => this.handlePixelPointerDown(e));
    this.pixelCanvas.addEventListener('mousemove', (e) => this.handlePixelPointerMove(e));
    window.addEventListener('mouseup', () => {
      this.isDrawing = false;
      this.dragStartCell = null;
      this.dragSnapshot = null;
      this.isPaintingMap = false;
    });

    // Sprite Sheet Picker Click
    this.sheetCanvas.addEventListener('mousedown', (e) => {
      const sheet = this.getActiveSheet();
      const rect = this.sheetCanvas.getBoundingClientRect();
      const cellW = rect.width / sheet.cols;
      const cellH = rect.height / sheet.rows;
      const col = Math.floor((e.clientX - rect.left) / cellW);
      const row = Math.floor((e.clientY - rect.top) / cellH);
      const idx = row * sheet.cols + col;
      if (idx >= 0 && idx < sheet.sprites.length) {
        this.activeSpriteIdx = idx;
        this.undoStack = [];
        this.renderAll();
      }
    });

    // Tilemap Canvas Paint
    this.mapCanvas.addEventListener('mousedown', (e) => {
      this.isPaintingMap = true;
      this.paintTilemapAtEvent(e);
    });
    this.mapCanvas.addEventListener('mousemove', (e) => {
      if (this.isPaintingMap) {
        this.paintTilemapAtEvent(e);
      }
    });

    this.container.querySelector('#sp-btn-fill-map')?.addEventListener('click', () => {
      const map = this.getActiveMap();
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          map.tiles[r][c] = this.activeSpriteIdx;
        }
      }
      this.renderMapCanvas();
    });

    this.container.querySelector('#sp-btn-clear-map')?.addEventListener('click', () => {
      const map = this.getActiveMap();
      for (let r = 0; r < map.rows; r++) {
        for (let c = 0; c < map.cols; c++) {
          map.tiles[r][c] = -1;
        }
      }
      this.renderMapCanvas();
    });
  }

  private getSpriteCellFromEvent(e: MouseEvent): { x: number; y: number } | null {
    const rect = this.pixelCanvas.getBoundingClientRect();
    const normX = (e.clientX - rect.left) / rect.width;
    const normY = (e.clientY - rect.top) / rect.height;
    const size = this.getActiveSheet().spriteSize;

    if (this.data.showSeamlessNeighbors) {
      const totalCells = size * 3;
      const gx = Math.floor(normX * totalCells);
      const gy = Math.floor(normY * totalCells);
      if (gx < 0 || gx >= totalCells || gy < 0 || gy >= totalCells) return null;

      return {
        x: ((gx - size) % size + size) % size,
        y: ((gy - size) % size + size) % size,
      };
    } else {
      const x = Math.floor(normX * size);
      const y = Math.floor(normY * size);
      if (x < 0 || x >= size || y < 0 || y >= size) return null;
      return { x, y };
    }
  }

  private handlePixelPointerDown(e: MouseEvent): void {
    const cell = this.getSpriteCellFromEvent(e);
    if (!cell) return;

    const sheet = this.getActiveSheet();
    const pixels = this.getActiveLayerPixels();

    if (this.activeTool === 'eyedropper') {
      const picked = flattenSpriteLayers(this.getActiveSprite(), sheet.spriteSize)[cell.y][cell.x];
      this.activeColorIdx = picked;
      this.renderPalette();
      return;
    }

    this.pushUndo();
    this.isDrawing = true;
    this.dragStartCell = cell;
    this.dragSnapshot = cloneGrid(pixels);

    if (this.activeTool === 'pencil') {
      pixels[cell.y][cell.x] = this.activeColorIdx;
    } else if (this.activeTool === 'eraser') {
      pixels[cell.y][cell.x] = 0;
    } else if (this.activeTool === 'bucket') {
      this.floodFill(pixels, cell.x, cell.y, pixels[cell.y][cell.x], this.activeColorIdx);
      this.isDrawing = false;
    }

    this.renderAllCanvases();
  }

  private handlePixelPointerMove(e: MouseEvent): void {
    const cell = this.getSpriteCellFromEvent(e);
    const coordEl = this.container.querySelector('#sp-cursor-pos');
    if (cell && coordEl) {
      coordEl.textContent = `Pixel: (${cell.x}, ${cell.y})`;
    }
    if (!this.isDrawing || !cell) return;

    const pixels = this.getActiveLayerPixels();

    if (this.activeTool === 'pencil') {
      pixels[cell.y][cell.x] = this.activeColorIdx;
      this.renderAllCanvases();
    } else if (this.activeTool === 'eraser') {
      pixels[cell.y][cell.x] = 0;
      this.renderAllCanvases();
    } else if (this.activeTool === 'line' && this.dragStartCell && this.dragSnapshot) {
      this.restoreSnapshot(pixels, this.dragSnapshot);
      this.drawBresenhamLine(
        pixels,
        this.dragStartCell.x,
        this.dragStartCell.y,
        cell.x,
        cell.y,
        this.activeColorIdx
      );
      this.renderAllCanvases();
    } else if (this.activeTool === 'rect' && this.dragStartCell && this.dragSnapshot) {
      this.restoreSnapshot(pixels, this.dragSnapshot);
      const minX = Math.min(this.dragStartCell.x, cell.x);
      const maxX = Math.max(this.dragStartCell.x, cell.x);
      const minY = Math.min(this.dragStartCell.y, cell.y);
      const maxY = Math.max(this.dragStartCell.y, cell.y);
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          if (y === minY || y === maxY || x === minX || x === maxX) {
            pixels[y][x] = this.activeColorIdx;
          }
        }
      }
      this.renderAllCanvases();
    }
  }

  private restoreSnapshot(target: number[][], snap: number[][]): void {
    for (let y = 0; y < snap.length; y++) {
      for (let x = 0; x < snap[y].length; x++) {
        target[y][x] = snap[y][x];
      }
    }
  }

  private drawBresenhamLine(
    grid: number[][],
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorIdx: number
  ): void {
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      if (grid[y0] && grid[y0][x0] !== undefined) {
        grid[y0][x0] = colorIdx;
      }
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  private floodFill(
    grid: number[][],
    startX: number,
    startY: number,
    targetColor: number,
    replacementColor: number
  ): void {
    if (targetColor === replacementColor) return;
    const size = this.getActiveSheet().spriteSize;
    const stack: [number, number][] = [[startX, startY]];

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      if (x < 0 || x >= size || y < 0 || y >= size) continue;
      if (grid[y][x] !== targetColor) continue;

      grid[y][x] = replacementColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
  }

  private paintTilemapAtEvent(e: MouseEvent): void {
    const map = this.getActiveMap();
    const rect = this.mapCanvas.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * map.cols);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * map.rows);
    if (row >= 0 && row < map.rows && col >= 0 && col < map.cols) {
      map.tiles[row][col] = this.activeSpriteIdx;
      this.renderMapCanvas();
    }
  }

  public renderAll(): void {
    this.syncSelectors();
    this.updateActiveHeader();
    this.renderPalette();
    this.renderLayers();
    this.renderNeighborCompass();
    this.renderAllCanvases();
  }

  private syncSelectors(): void {
    const sheet = this.getActiveSheet();
    const map = this.getActiveMap();

    const sheetSelect = this.container.querySelector('#sp-sheet-select') as HTMLSelectElement;
    if (sheetSelect) {
      sheetSelect.innerHTML = '';
      for (const name of Object.keys(this.data.sheets)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `📑 ${name}`;
        sheetSelect.appendChild(opt);
      }
      sheetSelect.value = sheet.name;
    }

    const sizeSelect = this.container.querySelector('#sp-size-select') as HTMLSelectElement;
    if (sizeSelect) {
      sizeSelect.value = String(sheet.spriteSize);
    }

    const sheetDimSelect = this.container.querySelector('#sp-sheet-dim-select') as HTMLSelectElement;
    if (sheetDimSelect) {
      sheetDimSelect.value = `${sheet.cols}x${sheet.rows}`;
    }

    const mapSelect = this.container.querySelector('#sp-map-select') as HTMLSelectElement;
    if (mapSelect) {
      mapSelect.innerHTML = '';
      for (const name of Object.keys(this.data.maps)) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = `🗺️ ${name}`;
        mapSelect.appendChild(opt);
      }
      mapSelect.value = map.name;
    }

    const mapDimSelect = this.container.querySelector('#sp-map-dim-select') as HTMLSelectElement;
    if (mapDimSelect) {
      const dimKey = `${map.cols}x${map.rows}`;
      if (!Array.from(mapDimSelect.options).some((o) => o.value === dimKey)) {
        const customOpt = document.createElement('option');
        customOpt.value = dimKey;
        customOpt.textContent = `${map.cols} × ${map.rows}`;
        mapDimSelect.appendChild(customOpt);
      }
      mapDimSelect.value = dimKey;
    }
  }

  private renderAllCanvases(): void {
    this.renderPixelCanvas();
    this.renderSheetCanvas();
    this.renderMapCanvas();
  }

  private updateActiveHeader(): void {
    const sheet = this.getActiveSheet();
    const sp = this.getActiveSprite();
    const label = this.container.querySelector('#sp-active-label');
    if (label) {
      label.textContent = `🎯 [${sheet.name}] SPRITE #${this.activeSpriteIdx} (${sp.name}) — ${sheet.spriteSize}×${sheet.spriteSize}`;
    }
    const sheetTitle = this.container.querySelector('#sp-sheet-title');
    if (sheetTitle) {
      sheetTitle.textContent = `📑 SHEET: ${sheet.name} (${sheet.cols}×${sheet.rows})`;
    }
    const nameInput = this.container.querySelector('#sp-sprite-name') as HTMLInputElement;
    if (nameInput && document.activeElement !== nameInput) {
      nameInput.value = sp.name;
    }
  }

  private renderPalette(): void {
    const gridEl = this.container.querySelector('#sp-palette-grid')!;
    const countEl = this.container.querySelector('#sp-palette-count');
    if (countEl) {
      countEl.textContent = String(this.data.palette.length);
    }
    gridEl.innerHTML = '';

    this.data.palette.forEach((color, idx) => {
      const swatch = document.createElement('button');
      swatch.className = `palette-swatch ${idx === this.activeColorIdx ? 'active' : ''} ${
        idx === 0 ? 'swatch-transparent' : ''
      }`;
      if (idx > 0) {
        swatch.style.backgroundColor = color;
      }
      swatch.title = idx === 0 ? '0: Transparent (None)' : `${idx}: ${color}`;
      swatch.textContent = String(idx);
      swatch.addEventListener('click', () => {
        this.activeColorIdx = idx;
        const colorInput = this.container.querySelector('#sp-custom-color') as HTMLInputElement;
        if (idx > 0 && colorInput) {
          colorInput.value = color;
        }
        this.renderPalette();
      });
      gridEl.appendChild(swatch);
    });
  }

  private renderLayers(): void {
    const listEl = this.container.querySelector('#sp-layer-list')!;
    listEl.innerHTML = '';
    const sp = this.getActiveSprite();

    sp.layers.forEach((layer, idx) => {
      const row = document.createElement('div');
      row.className = `layer-item ${idx === this.activeLayerIdx ? 'active' : ''}`;
      row.innerHTML = `
        <span>${idx === this.activeLayerIdx ? '✏️' : '📄'} ${layer.name}</span>
        <button class="icon-btn layer-vis-btn" title="Toggle layer visibility">
          ${layer.visible ? '👁' : '🚫'}
        </button>
      `;
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('layer-vis-btn')) {
          layer.visible = !layer.visible;
          this.renderLayers();
          this.renderAllCanvases();
          return;
        }
        this.activeLayerIdx = idx;
        this.renderLayers();
      });
      listEl.appendChild(row);
    });
  }

  private renderNeighborCompass(): void {
    const compassEl = this.container.querySelector('#sp-neighbor-compass')!;
    compassEl.innerHTML = '';
    const sheet = this.getActiveSheet();

    let slotCursor = 0;
    for (let cellIdx = 0; cellIdx < 9; cellIdx++) {
      if (cellIdx === 4) {
        const centerBadge = document.createElement('div');
        centerBadge.className = 'compass-center';
        centerBadge.textContent = `🎯 #${this.activeSpriteIdx}`;
        compassEl.appendChild(centerBadge);
        continue;
      }

      const slotIdx = slotCursor++;
      const dirName = NEIGHBOR_DIRECTIONS[slotIdx];
      const currentVal = this.data.neighborSlots[slotIdx];

      const sel = document.createElement('select');
      sel.className = 'compass-select';
      sel.title = `${dirName} Neighbor Sprite`;

      const selfOpt = document.createElement('option');
      selfOpt.value = '-1';
      selfOpt.textContent = `${dirName}: Self`;
      sel.appendChild(selfOpt);

      sheet.sprites.forEach((_, spIdx) => {
        const opt = document.createElement('option');
        opt.value = String(spIdx);
        opt.textContent = `${dirName}: #${spIdx}`;
        sel.appendChild(opt);
      });

      sel.value = currentVal < sheet.sprites.length ? String(currentVal) : '-1';
      sel.addEventListener('change', () => {
        this.data.neighborSlots[slotIdx] = Number(sel.value);
        this.renderPixelCanvas();
      });

      compassEl.appendChild(sel);
    }
  }

  private drawCheckerboard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    step: number
  ): void {
    const safeStep = Math.max(4, Math.floor(step));
    for (let py = y; py < y + h; py += safeStep) {
      for (let px = x; px < x + w; px += safeStep) {
        const isEven =
          (Math.floor((px - x) / safeStep) + Math.floor((py - y) / safeStep)) % 2 === 0;
        ctx.fillStyle = isEven ? '#161f2c' : '#1e293b';
        ctx.fillRect(px, py, Math.min(safeStep, x + w - px), Math.min(safeStep, y + h - py));
      }
    }
  }

  private drawSpriteAt(
    ctx: CanvasRenderingContext2D,
    sheet: NamedSpriteSheet,
    spriteIdx: number,
    destX: number,
    destY: number,
    destW: number,
    destH: number,
    alpha = 1
  ): void {
    const sp = sheet.sprites[spriteIdx] || this.getActiveSprite();
    const size = sheet.spriteSize;
    const flat = flattenSpriteLayers(sp, size);
    const cellW = destW / size;
    const cellH = destH / size;

    ctx.save();
    ctx.globalAlpha = alpha;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const colorIdx = flat[y][x];
        if (colorIdx > 0 && this.data.palette[colorIdx]) {
          ctx.fillStyle = this.data.palette[colorIdx];
          ctx.fillRect(
            Math.floor(destX + x * cellW),
            Math.floor(destY + y * cellH),
            Math.ceil(cellW),
            Math.ceil(cellH)
          );
        }
      }
    }
    ctx.restore();
  }

  private renderPixelCanvas(): void {
    const ctx = this.pixelCtx;
    const W = this.pixelCanvas.width;
    const H = this.pixelCanvas.height;
    const sheet = this.getActiveSheet();
    const size = sheet.spriteSize;

    ctx.clearRect(0, 0, W, H);

    if (this.data.showSeamlessNeighbors) {
      const tileW = W / 3;
      const cellPx = tileW / size;
      this.drawCheckerboard(ctx, 0, 0, W, H, Math.max(4, cellPx / 2));

      let slotCursor = 0;
      for (let gy = 0; gy < 3; gy++) {
        for (let gx = 0; gx < 3; gx++) {
          const bx = gx * tileW;
          const by = gy * tileW;
          if (gx === 1 && gy === 1) {
            this.drawSpriteAt(ctx, sheet, this.activeSpriteIdx, bx, by, tileW, tileW, 1.0);
          } else {
            const rawSlot = this.data.neighborSlots[slotCursor++];
            const neighborSpriteIdx =
              rawSlot === -1 || rawSlot >= sheet.sprites.length ? this.activeSpriteIdx : rawSlot;
            this.drawSpriteAt(ctx, sheet, neighborSpriteIdx, bx, by, tileW, tileW, 0.72);
          }
        }
      }

      if (this.showGrid && cellPx >= 3) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        const totalCells = size * 3;
        for (let i = 1; i < totalCells; i++) {
          const pos = Math.floor(i * cellPx) + 0.5;
          ctx.beginPath();
          ctx.moveTo(pos, 0);
          ctx.lineTo(pos, H);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, pos);
          ctx.lineTo(W, pos);
          ctx.stroke();
        }
      }

      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.strokeRect(tileW, tileW, tileW, tileW);
    } else {
      const cellPx = W / size;
      this.drawCheckerboard(ctx, 0, 0, W, H, Math.max(4, cellPx / 2));
      this.drawSpriteAt(ctx, sheet, this.activeSpriteIdx, 0, 0, W, H, 1.0);

      if (this.showGrid) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
        ctx.lineWidth = 1;
        for (let i = 1; i < size; i++) {
          const pos = Math.floor(i * cellPx) + 0.5;
          ctx.beginPath();
          ctx.moveTo(pos, 0);
          ctx.lineTo(pos, H);
          ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(0, pos);
          ctx.lineTo(W, pos);
          ctx.stroke();
        }
      }
    }
  }

  private renderSheetCanvas(): void {
    const ctx = this.sheetCtx;
    const W = this.sheetCanvas.width;
    const H = this.sheetCanvas.height;
    const sheet = this.getActiveSheet();
    const cols = sheet.cols;
    const rows = sheet.rows;
    const cellW = W / cols;
    const cellH = H / rows;

    this.drawCheckerboard(ctx, 0, 0, W, H, 8);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const x = c * cellW;
        const y = r * cellH;
        this.drawSpriteAt(ctx, sheet, idx, x, y, cellW, cellH, 1.0);

        ctx.strokeStyle = idx === this.activeSpriteIdx ? '#38bdf8' : 'rgba(255,255,255,0.18)';
        ctx.lineWidth = idx === this.activeSpriteIdx ? 2.5 : 1;
        ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);

        if (cols <= 6 || idx === this.activeSpriteIdx) {
          ctx.fillStyle = 'rgba(15, 20, 28, 0.75)';
          ctx.fillRect(x + 1, y + 1, 18, 12);
          ctx.fillStyle = idx === this.activeSpriteIdx ? '#38bdf8' : '#cbd5e1';
          ctx.font = 'bold 9.5px monospace';
          ctx.fillText(String(idx), x + 3, y + 10);
        }
      }
    }
  }

  private renderMapCanvas(): void {
    const ctx = this.mapCtx;
    const W = this.mapCanvas.width;
    const H = this.mapCanvas.height;
    const map = this.getActiveMap();
    const sheet = this.data.sheets[map.sheetName] || this.getActiveSheet();
    const cols = map.cols;
    const rows = map.rows;
    const tileW = W / cols;
    const tileH = H / rows;

    this.drawCheckerboard(ctx, 0, 0, W, H, 12);

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const spIdx = map.tiles[r]?.[c] ?? -1;
        const x = c * tileW;
        const y = r * tileH;
        if (spIdx >= 0 && spIdx < sheet.sprites.length) {
          this.drawSpriteAt(ctx, sheet, spIdx, x, y, tileW, tileH, 1.0);
        }
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, tileW, tileH);
      }
    }
  }

  private exportSpriteSheetPng(): void {
    const sheet = this.getActiveSheet();
    const size = sheet.spriteSize;
    const offscreen = document.createElement('canvas');
    offscreen.width = sheet.cols * size;
    offscreen.height = sheet.rows * size;
    const ctx = offscreen.getContext('2d')!;

    for (let r = 0; r < sheet.rows; r++) {
      for (let c = 0; c < sheet.cols; c++) {
        const idx = r * sheet.cols + c;
        this.drawSpriteAt(ctx, sheet, idx, c * size, r * size, size, size, 1.0);
      }
    }

    const link = document.createElement('a');
    link.download = `${sheet.name}_${sheet.spriteSize}x${sheet.spriteSize}.png`;
    link.href = offscreen.toDataURL('image/png');
    link.click();
  }

  private importPngFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        this.pushUndo();
        const size = this.getActiveSheet().spriteSize;
        const off = document.createElement('canvas');
        off.width = size;
        off.height = size;
        const ctx = off.getContext('2d')!;
        ctx.drawImage(img, 0, 0, size, size);
        const imgData = ctx.getImageData(0, 0, size, size).data;

        const targetGrid = this.getActiveLayerPixels();
        for (let y = 0; y < size; y++) {
          for (let x = 0; x < size; x++) {
            const offset = (y * size + x) * 4;
            const r = imgData[offset];
            const g = imgData[offset + 1];
            const b = imgData[offset + 2];
            const a = imgData[offset + 3];
            if (a < 40) {
              targetGrid[y][x] = 0;
            } else {
              targetGrid[y][x] = this.findNearestPaletteIndex(r, g, b);
            }
          }
        }
        this.renderAll();
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  }

  private findNearestPaletteIndex(r: number, g: number, b: number): number {
    let bestIdx = 1;
    let bestDist = Infinity;
    for (let i = 1; i < this.data.palette.length; i++) {
      const hex = this.data.palette[i].replace('#', '');
      const pr = parseInt(hex.slice(0, 2), 16) || 0;
      const pg = parseInt(hex.slice(2, 4), 16) || 0;
      const pb = parseInt(hex.slice(4, 6), 16) || 0;
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    }
    return bestIdx;
  }
}
