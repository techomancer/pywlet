export type PixelTool = 'pencil' | 'eraser' | 'bucket' | 'line' | 'rect' | 'eyedropper' | 'select';

export interface SpriteLayer {
  id: string;
  name: string;
  visible: boolean;
  /** 2D array [y][x] of palette index (0 = transparent) */
  pixels: number[][];
}

export interface SpriteCell {
  id: number;
  name: string;
  layers: SpriteLayer[];
}

export interface NamedSpriteSheet {
  name: string;
  spriteSize: number; // 8, 16, or 32
  cols: number;       // 4, 6, or 8
  rows: number;       // 4, 6, or 8
  sprites: SpriteCell[];
}

export interface NamedTileMap {
  name: string;
  sheetName: string;  // Which sprite sheet this map uses
  cols: number;       // e.g. 12, 16, 20, 24, 32
  rows: number;       // e.g. 8, 12, 16, 20, 24
  /** 2D array [row][col] of sprite indices (-1 = empty, 0..N = sprite index) */
  tiles: number[][];
}

export interface SpriteProjectData {
  palette: string[]; // index 0 is 'transparent', index 1..N are '#RRGGBB'
  sheets: Record<string, NamedSpriteSheet>;
  activeSheetName: string;
  maps: Record<string, NamedTileMap>;
  activeMapName: string;
  /**
   * 8-way neighbor indices around the active sprite for seamless tiling:
   * [NW, N, NE, W, E, SW, S, SE].
   * -1 means "self (active sprite)". 0..N means sprite index from the active sheet.
   */
  neighborSlots: number[];
  showSeamlessNeighbors: boolean;
}

export const DEFAULT_PALETTE_16: string[] = [
  'transparent', // 0: Transparent
  '#0f172a',     // 1: Deep Space Black/Navy
  '#1e293b',     // 2: Dark Slate
  '#64748b',     // 3: Steel Gray
  '#f8fafc',     // 4: Pure White
  '#ef4444',     // 5: Arcade Red
  '#f97316',     // 6: Blaze Orange
  '#facc15',     // 7: Coin Gold
  '#84cc16',     // 8: Slime Lime
  '#22c55e',     // 9: Grass Green
  '#06b6d4',     // 10: Laser Cyan
  '#38bdf8',     // 11: Sky Blue
  '#3b82f6',     // 12: Royal Blue
  '#a855f7',     // 13: Magic Purple
  '#ec4899',     // 14: Neon Pink
  '#a16207',     // 15: Earth Brown
];

export function createEmptyGrid(size: number, fillValue = 0): number[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => fillValue));
}

export function createEmptyRectGrid(rows: number, cols: number, fillValue = -1): number[][] {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fillValue));
}

export function cloneGrid(grid: number[][]): number[][] {
  return grid.map((row) => [...row]);
}

export function createSpriteCell(id: number, size: number, name = `sprite_${id}`): SpriteCell {
  return {
    id,
    name,
    layers: [
      {
        id: 'bg',
        name: 'Layer 1 (Base)',
        visible: true,
        pixels: createEmptyGrid(size, 0),
      },
      {
        id: 'fg',
        name: 'Layer 2 (Detail)',
        visible: true,
        pixels: createEmptyGrid(size, 0),
      },
    ],
  };
}

/**
 * Flattens all visible layers of a sprite into a single 2D palette-index grid [y][x].
 */
export function flattenSpriteLayers(sprite: SpriteCell, size: number): number[][] {
  const result = createEmptyGrid(size, 0);
  for (const layer of sprite.layers) {
    if (!layer.visible) continue;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const val = layer.pixels[y]?.[x] ?? 0;
        if (val !== 0) {
          result[y][x] = val;
        }
      }
    }
  }
  return result;
}

/**
 * Resizes a sprite sheet's spriteSize (8, 16, 32) and/or sheet grid dimensions (e.g. 4x4, 6x6, 8x8)
 * while preserving existing pixel art.
 */
export function resizeSpriteSheet(
  sheet: NamedSpriteSheet,
  nextSpriteSize: number,
  nextCols: number,
  nextRows: number
): void {
  const oldSize = sheet.spriteSize;
  const nextTotal = nextCols * nextRows;

  // 1. Adjust number of sprites in the sheet
  while (sheet.sprites.length < nextTotal) {
    sheet.sprites.push(createSpriteCell(sheet.sprites.length, oldSize));
  }
  if (sheet.sprites.length > nextTotal) {
    sheet.sprites.length = nextTotal;
  }

  // 2. Resize each sprite's pixel grids if spriteSize changed
  if (nextSpriteSize !== oldSize) {
    for (const sp of sheet.sprites) {
      for (const layer of sp.layers) {
        const nextGrid = createEmptyGrid(nextSpriteSize, 0);
        for (let y = 0; y < Math.min(oldSize, nextSpriteSize); y++) {
          for (let x = 0; x < Math.min(oldSize, nextSpriteSize); x++) {
            nextGrid[y][x] = layer.pixels[y]?.[x] ?? 0;
          }
        }
        layer.pixels = nextGrid;
      }
    }
  }

  sheet.spriteSize = nextSpriteSize;
  sheet.cols = nextCols;
  sheet.rows = nextRows;
}

/**
 * Resizes a tilemap's (cols, rows) while preserving existing placed tiles.
 */
export function resizeTileMap(map: NamedTileMap, nextCols: number, nextRows: number): void {
  const nextTiles = createEmptyRectGrid(nextRows, nextCols, 0);
  for (let r = 0; r < Math.min(map.rows, nextRows); r++) {
    for (let c = 0; c < Math.min(map.cols, nextCols); c++) {
      nextTiles[r][c] = map.tiles[r]?.[c] ?? 0;
    }
  }
  map.cols = nextCols;
  map.rows = nextRows;
  map.tiles = nextTiles;
}

/**
 * Creates a rich starter project with two named Sprite Sheets (`overworld`, `dungeon`)
 * and two named Level Tilemaps (`level_1`, `level_2`).
 */
export function createStarterSpriteProject(size = 8): SpriteProjectData {
  const sheetCols = 4;
  const sheetRows = 4;
  const totalSprites = sheetCols * sheetRows;

  const overworldSprites: SpriteCell[] = Array.from({ length: totalSprites }, (_, idx) =>
    createSpriteCell(idx, size)
  );

  if (size === 8) {
    // Sprite 0: Seamless Grass Tile
    overworldSprites[0].name = 'grass_tile';
    overworldSprites[0].layers[0].pixels = [
      [9, 9, 8, 9, 9, 9, 8, 9],
      [9, 9, 9, 9, 8, 9, 9, 9],
      [8, 9, 9, 9, 9, 9, 9, 8],
      [9, 9, 8, 9, 9, 8, 9, 9],
      [9, 9, 9, 9, 9, 9, 9, 9],
      [9, 8, 9, 9, 8, 9, 9, 9],
      [9, 9, 9, 9, 9, 9, 8, 9],
      [9, 9, 8, 9, 9, 9, 9, 9],
    ];

    // Sprite 1: Seamless Water Tile
    overworldSprites[1].name = 'water_tile';
    overworldSprites[1].layers[0].pixels = [
      [12, 12, 11, 11, 12, 12, 12, 12],
      [12, 11, 12, 12, 11, 12, 12, 12],
      [12, 12, 12, 12, 12, 12, 11, 11],
      [11, 12, 12, 12, 12, 11, 12, 12],
      [12, 12, 11, 11, 12, 12, 12, 12],
      [12, 11, 12, 12, 11, 12, 12, 12],
      [12, 12, 12, 12, 12, 12, 11, 11],
      [11, 12, 12, 12, 12, 11, 12, 12],
    ];

    // Sprite 2: Brick Wall Tile
    overworldSprites[2].name = 'brick_wall';
    overworldSprites[2].layers[0].pixels = [
      [5, 5, 5, 3, 5, 5, 5, 5],
      [5, 5, 5, 3, 5, 5, 5, 5],
      [3, 3, 3, 3, 3, 3, 3, 3],
      [5, 3, 5, 5, 5, 5, 5, 3],
      [5, 3, 5, 5, 5, 5, 5, 3],
      [3, 3, 3, 3, 3, 3, 3, 3],
      [5, 5, 5, 3, 5, 5, 5, 5],
      [3, 3, 3, 3, 3, 3, 3, 3],
    ];

    // Sprite 3: Gold Coin Sprite (with transparent background)
    overworldSprites[3].name = 'gold_coin';
    overworldSprites[3].layers[1].pixels = [
      [0, 0, 7, 7, 7, 7, 0, 0],
      [0, 7, 4, 7, 7, 6, 7, 0],
      [7, 4, 7, 7, 7, 7, 6, 7],
      [7, 7, 7, 4, 6, 7, 6, 7],
      [7, 7, 7, 4, 6, 7, 6, 7],
      [7, 7, 7, 7, 7, 7, 6, 7],
      [0, 7, 6, 7, 7, 6, 7, 0],
      [0, 0, 7, 6, 6, 7, 0, 0],
    ];

    // Sprite 4: Hero Spaceship
    overworldSprites[4].name = 'hero_ship';
    overworldSprites[4].layers[1].pixels = [
      [0, 0, 0, 10, 10, 0, 0, 0],
      [0, 0, 11, 4, 4, 11, 0, 0],
      [0, 0, 11, 10, 10, 11, 0, 0],
      [0, 11, 11, 11, 11, 11, 11, 0],
      [11, 12, 11, 4, 4, 11, 12, 11],
      [11, 12, 11, 11, 11, 11, 12, 11],
      [11, 0, 6, 7, 7, 6, 0, 11],
      [0, 0, 5, 0, 0, 5, 0, 0],
    ];
  }

  const dungeonSprites: SpriteCell[] = Array.from({ length: totalSprites }, (_, idx) =>
    createSpriteCell(idx, size, `dungeon_${idx}`)
  );
  if (size === 8) {
    // Dark stone floor
    dungeonSprites[0].name = 'stone_floor';
    dungeonSprites[0].layers[0].pixels = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => ((x + y) % 3 === 0 ? 2 : 1))
    );
    // Lava tile
    dungeonSprites[1].name = 'lava_tile';
    dungeonSprites[1].layers[0].pixels = Array.from({ length: 8 }, (_, y) =>
      Array.from({ length: 8 }, (_, x) => ((x + y) % 2 === 0 ? 6 : 5))
    );
  }

  const mapCols = 12;
  const mapRows = 8;
  const level1Tiles: number[][] = Array.from({ length: mapRows }, (_, r) =>
    Array.from({ length: mapCols }, (_, c) => {
      if (r === 0 || r === mapRows - 1 || c === 0 || c === mapCols - 1) return 2; // Brick border
      if (r === 3 && c >= 4 && c <= 7) return 1; // Water pond
      return 0; // Grass interior
    })
  );

  const level2Tiles: number[][] = Array.from({ length: mapRows }, (_, r) =>
    Array.from({ length: mapCols }, (_, c) => {
      if (r === 0 || r === mapRows - 1 || c === 0 || c === mapCols - 1) return 1; // Lava border
      return 0; // Stone floor
    })
  );

  return {
    palette: [...DEFAULT_PALETTE_16],
    sheets: {
      overworld: {
        name: 'overworld',
        spriteSize: size,
        cols: sheetCols,
        rows: sheetRows,
        sprites: overworldSprites,
      },
      dungeon: {
        name: 'dungeon',
        spriteSize: size,
        cols: sheetCols,
        rows: sheetRows,
        sprites: dungeonSprites,
      },
    },
    activeSheetName: 'overworld',
    maps: {
      level_1: {
        name: 'level_1',
        sheetName: 'overworld',
        cols: mapCols,
        rows: mapRows,
        tiles: level1Tiles,
      },
      level_2: {
        name: 'level_2',
        sheetName: 'dungeon',
        cols: mapCols,
        rows: mapRows,
        tiles: level2Tiles,
      },
    },
    activeMapName: 'level_1',
    neighborSlots: [-1, -1, -1, -1, -1, -1, -1, -1],
    showSeamlessNeighbors: true,
  };
}

/**
 * Serializes all named Sprite Sheets (`SPRITE_SHEETS`), the custom `PALETTE`,
 * and all named Level Tilemaps (`TILEMAPS`) into clean Python dictionaries and arrays
 * in `sprites_data.py` (while also exporting `SPRITE_SIZE`, `SPRITES`, and `TILEMAP`
 * aliases pointing to the active sheet/map for simple 1-sheet games!).
 */
export function serializeSpriteProjectToPython(data: SpriteProjectData): string {
  const activeSheet = data.sheets[data.activeSheetName] || Object.values(data.sheets)[0];
  const activeMap = data.maps[data.activeMapName] || Object.values(data.maps)[0];

  const rgbPaletteLines = data.palette.map((color, idx) => {
    if (idx === 0 || color === 'transparent') {
      return `    None,  # 0: Transparent`;
    }
    const hex = color.replace('#', '');
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    return `    (${r}, ${g}, ${b}),  # ${idx}: ${color}`;
  });

  const sheetEntries = Object.values(data.sheets).map((sheet) => {
    const spriteBlocks = sheet.sprites.map((sp, idx) => {
      const flat = flattenSpriteLayers(sp, sheet.spriteSize);
      const rowsStr = flat
        .map((row) => `                [${row.map((v) => String(v).padStart(2, ' ')).join(', ')}],`)
        .join('\n');
      return `            # Sprite ${idx}: ${sp.name}\n            [\n${rowsStr}\n            ],`;
    });

    return `    "${sheet.name}": {
        "sprite_size": ${sheet.spriteSize},
        "cols": ${sheet.cols},
        "rows": ${sheet.rows},
        "sprites": [
${spriteBlocks.join('\n')}
        ],
    },`;
  });

  const mapEntries = Object.values(data.maps).map((m) => {
    const mapRowsStr = m.tiles
      .map((row) => `            [${row.map((v) => String(v).padStart(2, ' ')).join(', ')}],`)
      .join('\n');
    return `    "${m.name}": {
        "sheet": "${m.sheetName}",
        "cols": ${m.cols},
        "rows": ${m.rows},
        "tiles": [
${mapRowsStr}
        ],
    },`;
  });

  return `# 🎨 Auto-generated by Pywlet Sprite & Tilemap Studio!
# Contains your custom PALETTE, named SPRITE_SHEETS, and named TILEMAPS.

# Color Palette: Index 0 is None (Transparent), 1..${data.palette.length - 1} are (R, G, B) tuples
PALETTE = [
${rgbPaletteLines.join('\n')}
]

# Named Sprite Sheets: SPRITE_SHEETS["sheet_name"]["sprites"][sprite_idx][y][x]
SPRITE_SHEETS = {
${sheetEntries.join('\n')}
}

# Named Level Tilemaps: TILEMAPS["map_name"]["tiles"][row][col]
TILEMAPS = {
${mapEntries.join('\n')}
}

# Default aliases pointing to "${activeSheet.name}" and "${activeMap.name}"
ACTIVE_SHEET = "${activeSheet.name}"
ACTIVE_MAP = "${activeMap.name}"
SPRITE_SIZE = SPRITE_SHEETS[ACTIVE_SHEET]["sprite_size"]
SPRITES = SPRITE_SHEETS[ACTIVE_SHEET]["sprites"]
TILEMAP = TILEMAPS[ACTIVE_MAP]["tiles"]
`;
}

/**
 * Parses a Python file (`sprites_data.py`) back into `SpriteProjectData`.
 * Supports both the multi-sheet `SPRITE_SHEETS` / `TILEMAPS` dictionary format
 * and the single-sheet `SPRITES` / `TILEMAP` array format.
 */
export function parsePythonToSpriteProject(
  pyCode: string,
  fallback: SpriteProjectData
): SpriteProjectData {
  try {
    const result: SpriteProjectData = JSON.parse(JSON.stringify(fallback));

    // 1. Parse PALETTE = [ ... ]
    const paletteBlockMatch = pyCode.match(/PALETTE\s*=\s*\[([\s\S]*?)\]/);
    if (paletteBlockMatch) {
      const lines = paletteBlockMatch[1].split('\n');
      const parsedPalette: string[] = [];
      for (const line of lines) {
        const clean = line.replace(/#.*$/, '').trim();
        if (!clean) continue;
        if (clean.startsWith('None')) {
          parsedPalette.push('transparent');
        } else {
          const rgbMatch = clean.match(/\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
          if (rgbMatch) {
            const r = Number(rgbMatch[1]).toString(16).padStart(2, '0');
            const g = Number(rgbMatch[2]).toString(16).padStart(2, '0');
            const b = Number(rgbMatch[3]).toString(16).padStart(2, '0');
            parsedPalette.push(`#${r}${g}${b}`);
          }
        }
      }
      if (parsedPalette.length >= 2) {
        result.palette = parsedPalette;
      }
    }

    // 2. Parse SPRITE_SHEETS = { ... }
    const sheetsMatch = pyCode.match(/SPRITE_SHEETS\s*=\s*(\{[\s\S]*?\n\})\s*(?:TILEMAPS|$|#)/);
    if (sheetsMatch) {
      const jsonReady = sheetsMatch[1].replace(/#.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
      const parsedSheetsObj = JSON.parse(jsonReady);
      const nextSheets: Record<string, NamedSpriteSheet> = {};

      for (const [sheetName, rawSheet] of Object.entries<any>(parsedSheetsObj)) {
        const spSize = Number(rawSheet.sprite_size) || 8;
        const cols = Number(rawSheet.cols) || 4;
        const rows = Number(rawSheet.rows) || 4;
        const rawSprites: number[][][] = Array.isArray(rawSheet.sprites) ? rawSheet.sprites : [];

        nextSheets[sheetName] = {
          name: sheetName,
          spriteSize: spSize,
          cols,
          rows,
          sprites: rawSprites.map((grid, idx) => ({
            id: idx,
            name: fallback.sheets[sheetName]?.sprites[idx]?.name || `sprite_${idx}`,
            layers: [
              { id: 'bg', name: 'Layer 1 (Base)', visible: true, pixels: grid },
              { id: 'fg', name: 'Layer 2 (Detail)', visible: true, pixels: createEmptyGrid(spSize, 0) },
            ],
          })),
        };
      }

      if (Object.keys(nextSheets).length > 0) {
        result.sheets = nextSheets;
        if (!(result.activeSheetName in nextSheets)) {
          result.activeSheetName = Object.keys(nextSheets)[0];
        }
      }
    }

    // 3. Parse TILEMAPS = { ... }
    const mapsMatch = pyCode.match(/TILEMAPS\s*=\s*(\{[\s\S]*?\n\})/);
    if (mapsMatch) {
      const jsonReady = mapsMatch[1].replace(/#.*$/gm, '').replace(/,\s*([\]}])/g, '$1');
      const parsedMapsObj = JSON.parse(jsonReady);
      const nextMaps: Record<string, NamedTileMap> = {};

      for (const [mapName, rawMap] of Object.entries<any>(parsedMapsObj)) {
        const tiles: number[][] = Array.isArray(rawMap.tiles) ? rawMap.tiles : [[0]];
        nextMaps[mapName] = {
          name: mapName,
          sheetName: rawMap.sheet || Object.keys(result.sheets)[0] || 'overworld',
          cols: Number(rawMap.cols) || tiles[0]?.length || 12,
          rows: Number(rawMap.rows) || tiles.length || 8,
          tiles,
        };
      }

      if (Object.keys(nextMaps).length > 0) {
        result.maps = nextMaps;
        if (!(result.activeMapName in nextMaps)) {
          result.activeMapName = Object.keys(nextMaps)[0];
        }
      }
    }

    const activeSheetMatch = pyCode.match(/ACTIVE_SHEET\s*=\s*"([^"]+)"/);
    if (activeSheetMatch && activeSheetMatch[1] in result.sheets) {
      result.activeSheetName = activeSheetMatch[1];
    }

    const activeMapMatch = pyCode.match(/ACTIVE_MAP\s*=\s*"([^"]+)"/);
    if (activeMapMatch && activeMapMatch[1] in result.maps) {
      result.activeMapName = activeMapMatch[1];
    }

    return result;
  } catch {
    return fallback;
  }
}
