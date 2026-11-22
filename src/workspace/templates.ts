import {
  createStarterSpriteProject,
  serializeSpriteProjectToPython,
} from '../sprite-editor/sprite-data';
import { createStarterSoundWav } from '../audio-editor/wav-codec';
import { createBlankPngDataUrl, getStarterAssetDataUrls } from './starter-assets';

export interface ProjectTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  createFiles: () => Record<string, string>;
}

export interface WorkspaceRecord {
  id: string;
  name: string;
  sourceTemplateId?: string;
  readOnly?: boolean;
  createdAt: number;
  updatedAt: number;
  activeFile: string;
  files: Record<string, string>;
}

export type WorkspaceFileKind = 'python' | 'sprite-sheet' | 'png' | 'wav';

export function classifyWorkspaceFile(filename: string, content?: string | null): WorkspaceFileKind {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.wav')) return 'wav';
  if (lower === 'main.py' || lower.endsWith('/main.py')) return 'python';
  if (
    lower === 'sprites_data.py' ||
    lower.endsWith('/sprites_data.py') ||
    lower.endsWith('_sprites.py') ||
    (lower.endsWith('.py') &&
      typeof content === 'string' &&
      /^\s*PALETTE\s*=\s*\[/m.test(content) &&
      /^\s*(?:SPRITE_SHEETS\s*=\s*\{|SPRITES\s*=\s*\[)/m.test(content))
  ) {
    return 'sprite-sheet';
  }
  return 'python';
}

export function getDefaultActiveFile(files: Record<string, string>): string {
  if ('main.py' in files) return 'main.py';
  const firstPython = Object.keys(files).find(
    (name) => classifyWorkspaceFile(name, files[name]) === 'python'
  );
  return firstPython || Object.keys(files)[0] || 'main.py';
}

export function getDefaultSpritesDataPy(): string {
  return serializeSpriteProjectToPython(createStarterSpriteProject(8));
}

export const STARTER_TEMPLATES: Record<string, ProjectTemplate> = {
  'tilemap-adventure': {
    id: 'tilemap-adventure',
    name: 'Tilemap World & Sprites',
    icon: '🗺️',
    description: 'Sprite sheets, multi-map levels, fonts, and sound effects',
    createFiles: () => {
      const assets = getStarterAssetDataUrls();
      return {
        'main.py': `import pygame
from sprites_data import PALETTE, SPRITE_SHEETS, TILEMAPS

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

# Built-in Pygame Font & Sound!
font = pygame.font.SysFont("monospace", 16)
coin_snd = pygame.mixer.Sound("assets/coin.wav")

# Hero ship position (Sprite #4 from your "overworld" Sprite Sheet!)
player_x = 180
player_y = 140
coin_x = 96
coin_y = 64
score = 0

print("Use Arrow Keys to fly across your 'level_1' Tilemap!")
print("Click sprites_data.py, assets/*.png, or assets/*.wav on the left to edit them!")

running = True
while running:
    keys = pygame.key.get_pressed()
    if keys[pygame.K_LEFT]:
        player_x -= 3
    if keys[pygame.K_RIGHT]:
        player_x += 3
    if keys[pygame.K_UP]:
        player_y -= 3
    if keys[pygame.K_DOWN]:
        player_y += 3

    screen.fill((15, 23, 42))

    # 1. Draw "level_1" from TILEMAPS (scale = 4x)
    draw_tilemap(screen, 4, "level_1")

    # 2. Draw Sprite #3 (gold_coin) and Sprite #4 (hero_ship) from "overworld"
    draw_sprite(screen, 3, coin_x, coin_y, 4, "overworld")
    draw_sprite(screen, 4, player_x, player_y, 4, "overworld")

    # 3. Render HUD text using pygame.font.SysFont!
    hud = font.render("Map: level_1 | Arrows to Move", True, (250, 204, 21))
    screen.blit(hud, (12, 8))

    pygame.display.flip()
    clock.tick(60)
`,
        'sprites_data.py': getDefaultSpritesDataPy(),
        'assets/ship.png': assets['assets/ship.png'],
        'assets/coin.wav': assets['assets/coin.wav'],
      };
    },
  },
  'bouncing-ball': {
    id: 'bouncing-ball',
    name: 'Bouncing Ball',
    icon: '🏀',
    description: 'Classic physics bounce with keyboard nudge & boop sound',
    createFiles: () => {
      const assets = getStarterAssetDataUrls();
      return {
        'main.py': `import pygame

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()
boop = pygame.mixer.Sound("assets/boop.wav")

# Ball position and speed
x = 200
y = 140
dx = 3
dy = 2
radius = 18

print("Bouncing Ball started! Use Left/Right arrows to nudge the ball.")

running = True
while running:
    # 1. Check keyboard input
    keys = pygame.key.get_pressed()
    if keys[pygame.K_LEFT]:
        x -= 4
    if keys[pygame.K_RIGHT]:
        x += 4

    # 2. Move the ball
    x += dx
    y += dy

    # 3. Bounce off the left/right walls (0 to 400)
    if x > 382:
        dx = -3
        boop.play()
    if x < 18:
        dx = 3
        boop.play()

    # 4. Bounce off the top/bottom walls (0 to 280)
    if y > 262:
        dy = -2
        boop.play()
    if y < 18:
        dy = 2
        boop.play()

    # 5. Paint the background & draw our ball!
    screen.fill((15, 23, 42))
    pygame.draw.circle(screen, (56, 189, 248), (x, y), radius)

    pygame.display.flip()
    clock.tick(60)
`,
        'notes.py': `# Try these fun experiments in main.py!
# 1. What happens if you change the numbers inside screen.fill((15, 23, 42))?
# 2. Can you add UP and DOWN arrow key controls using pygame.K_UP and pygame.K_DOWN?
# 3. Click assets/boop.wav on the left to reshape the bounce sound in the WAV Editor!
`,
        'assets/boop.wav': assets['assets/boop.wav'],
      };
    },
  },
  'star-catcher': {
    id: 'star-catcher',
    name: 'Star Catcher',
    icon: '🚀',
    description: 'Catch falling PNG stars with your PNG spaceship & sound FX',
    createFiles: () => {
      const assets = getStarterAssetDataUrls();
      return {
        'main.py': `import pygame

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

# Load PNG images & WAV sound right from your workspace!
ship_img = pygame.image.load("assets/ship.png")
star_img = pygame.image.load("assets/star.png")
jump_snd = pygame.mixer.Sound("assets/jump.wav")

# Spaceship at the bottom
ship_x = 184
ship_y = 232

# Falling star position
star_x = 200
star_y = 20
star_speed = 3

print("Use LEFT and RIGHT arrow keys to catch the falling golden star!")
print("Click assets/ship.png or assets/star.png on the left to repaint them!")

running = True
while running:
    keys = pygame.key.get_pressed()
    if keys[pygame.K_LEFT]:
        ship_x -= 5
    if keys[pygame.K_RIGHT]:
        ship_x += 5

    # Move the falling star down
    star_y += star_speed

    # Reset star to the top when it reaches the bottom
    if star_y > 280:
        star_y = 15
        star_x += 75
        jump_snd.play()
    if star_x > 360:
        star_x = 40

    # Draw space background, golden star PNG, and spaceship PNG
    screen.fill((10, 12, 28))
    screen.blit(star_img, (star_x, star_y))
    screen.blit(ship_img, (ship_x, ship_y))

    pygame.display.flip()
    clock.tick(60)
`,
        'assets/ship.png': assets['assets/ship.png'],
        'assets/star.png': assets['assets/star.png'],
        'assets/alien.png': assets['assets/alien.png'],
        'assets/jump.wav': assets['assets/jump.wav'],
      };
    },
  },
  'python-playground': {
    id: 'python-playground',
    name: 'Python Playground',
    icon: '🧪',
    description: 'Variables, print output, and simple shape drawing',
    createFiles: () => ({
      'main.py': `import pygame

# Welcome to Python Playground!
# Try changing variables and printing results to the console below.

player_level = 5
coins = 120
bonus = 30
total_score = coins + bonus

print("Player Level:")
print(player_level)
print("Total Score:")
print(total_score)

# Draw a trophy badge on the stage!
pygame.init()
screen = pygame.display.set_mode((400, 280))

running = True
while running:
    screen.fill((24, 20, 38))
    pygame.draw.rect(screen, (168, 85, 247), (150, 90, 100, 100))
    pygame.draw.circle(screen, (250, 204, 21), (200, 140), 30)
    pygame.display.flip()
`,
    }),
  },
};

export const CHEATSHEETS: Record<string, string> = {
  coords: `
    <strong>📐 Pygame Screen Coordinates</strong><br/>
    • Top-left corner is <code>(0, 0)</code>.<br/>
    • <code>x</code> goes <strong>right →</strong> (0 to 400).<br/>
    • <code>y</code> goes <strong>down ↓</strong> (0 to 280).<br/>
    • Center of our stage is <code>(200, 140)</code>!
  `,
  colors: `
    <strong>🎨 RGB Color Picker <code>(R, G, B)</code></strong>
    <div class="rgb-picker-widget">
      <div class="rgb-picker-row">
        <input type="color" id="cheat-color-picker" value="#38bdf8" title="Click to open Color Picker" />
        <code id="cheat-rgb-tuple" class="rgb-tuple-display">(56, 189, 248)</code>
      </div>
      <div class="rgb-picker-actions">
        <button type="button" id="btn-insert-rgb" class="btn btn-small btn-Ask" title="Insert (R, G, B) at cursor in code editor">
          ➕ Insert in Code
        </button>
        <button type="button" id="btn-copy-rgb" class="btn btn-small" title="Copy (R, G, B) to clipboard">
          📋 Copy
        </button>
      </div>
    </div>
    <div class="rgb-presets">
      <span class="preset-label">Quick Presets (click to load):</span>
      <div class="rgb-preset-item" data-hex="#38bdf8" data-rgb="(56, 189, 248)">
        <span class="color-dot" style="background:#38bdf8"></span> Sky Blue <code>(56, 189, 248)</code>
      </div>
      <div class="rgb-preset-item" data-hex="#22c55e" data-rgb="(34, 197, 94)">
        <span class="color-dot" style="background:#22c55e"></span> Neon Green <code>(34, 197, 94)</code>
      </div>
      <div class="rgb-preset-item" data-hex="#facc15" data-rgb="(250, 204, 21)">
        <span class="color-dot" style="background:#facc15"></span> Coin Gold <code>(250, 204, 21)</code>
      </div>
      <div class="rgb-preset-item" data-hex="#ef4444" data-rgb="(239, 68, 68)">
        <span class="color-dot" style="background:#ef4444"></span> Arcade Red <code>(239, 68, 68)</code>
      </div>
      <div class="rgb-preset-item" data-hex="#a855f7" data-rgb="(168, 85, 247)">
        <span class="color-dot" style="background:#a855f7"></span> Magic Purple <code>(168, 85, 247)</code>
      </div>
      <div class="rgb-preset-item" data-hex="#0f172a" data-rgb="(15, 23, 42)">
        <span class="color-dot" style="background:#0f172a"></span> Deep Space <code>(15, 23, 42)</code>
      </div>
    </div>
  `,
  keys: `
    <strong>⌨️ Checking Keyboard Keys</strong><br/>
    Inside your <code>while running:</code> loop:<br/>
    <code>keys = pygame.key.get_pressed()</code><br/>
    • Left Arrow: <code>keys[pygame.K_LEFT]</code><br/>
    • Right Arrow: <code>keys[pygame.K_RIGHT]</code><br/>
    • Up / Down: <code>pygame.K_UP</code> / <code>K_DOWN</code><br/>
    • Spacebar: <code>keys[pygame.K_SPACE]</code>
  `,
  fonts: `
    <strong>🔤 Fonts, Images &amp; Sounds</strong><br/>
    • Text: <code>font = pygame.font.SysFont("monospace", 18)</code><br/>
    <code>img = font.render("Score: " + str(score), True, (250, 204, 21))</code><br/>
    <code>screen.blit(img, (10, 10))</code><br/>
    • PNG: <code>ship = pygame.image.load("assets/ship.png")</code><br/>
    <code>screen.blit(ship, (x, y))</code><br/>
    • WAV: <code>snd = pygame.mixer.Sound("assets/boop.wav")</code><br/>
    <code>snd.play()</code>
  `,
  loops: `
    <strong>🔁 The Game Loop Heartbeat</strong><br/>
    Every frame (60 times a second):<br/>
    1. Check keys/events<br/>
    2. Update positions (<code>x += dx</code>)<br/>
    3. <code>screen.fill(...)</code> background<br/>
    4. Draw shapes/sprites<br/>
    5. <code>pygame.display.flip()</code>!
  `,
};

const DB_NAME = 'pywlet_workspaces_db';
const DB_VERSION = 1;
const STORE_WORKSPACES = 'workspaces';
const STORE_META = 'meta';
const FALLBACK_LS_KEY = 'pywlet_workspaces_v2';
const LEGACY_LS_PREFIX = 'pywlet_workspace_v1_';

function generateWorkspaceId(): string {
  return `ws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function openWorkspaceDB(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_WORKSPACES)) {
          db.createObjectStore(STORE_WORKSPACES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export class WorkspaceStore {
  private db: IDBDatabase | null = null;
  private workspaces: Map<string, WorkspaceRecord> = new Map();
  private activeWorkspaceId = '';
  private examplePreview: WorkspaceRecord | null = null;

  public async init(): Promise<void> {
    this.db = await openWorkspaceDB();
    await this.loadAllFromStorage();

    // Migrate any legacy v1 localStorage projects if DB is empty
    if (this.workspaces.size === 0) {
      this.migrateLegacyLocalStorage();
    }

    // Seed an initial starter workspace if user has none yet
    if (this.workspaces.size === 0) {
      const first = this.cloneExampleWorkspace('tilemap-adventure', 'My Tilemap World');
      this.activeWorkspaceId = first.id;
    } else if (!this.workspaces.has(this.activeWorkspaceId)) {
      this.activeWorkspaceId = this.listWorkspaces()[0].id;
    }

    await this.persistActiveId();
  }

  private async loadAllFromStorage(): Promise<void> {
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction([STORE_WORKSPACES, STORE_META], 'readonly');
        const wsStore = tx.objectStore(STORE_WORKSPACES);
        const metaStore = tx.objectStore(STORE_META);

        const allReq = wsStore.getAll();
        const metaReq = metaStore.get('activeWorkspaceId');

        tx.oncomplete = () => {
          const rows = (allReq.result as WorkspaceRecord[]) || [];
          for (const ws of rows) {
            if (ws && ws.id && ws.files) {
              this.workspaces.set(ws.id, ws);
            }
          }
          if (metaReq.result?.value) {
            this.activeWorkspaceId = String(metaReq.result.value);
          }
          resolve();
        };
        tx.onerror = () => resolve();
      });
      return;
    }

    // Fallback to localStorage if IndexedDB is unavailable
    try {
      const raw = localStorage.getItem(FALLBACK_LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          activeWorkspaceId?: string;
          workspaces?: WorkspaceRecord[];
        };
        for (const ws of parsed.workspaces || []) {
          this.workspaces.set(ws.id, ws);
        }
        this.activeWorkspaceId = parsed.activeWorkspaceId || '';
      }
    } catch {
      // Ignore corrupt fallback
    }
  }

  private migrateLegacyLocalStorage(): void {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(LEGACY_LS_PREFIX)) continue;
        const tplId = key.slice(LEGACY_LS_PREFIX.length);
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const files = JSON.parse(raw) as Record<string, string>;
        if (!files || typeof files !== 'object' || Object.keys(files).length === 0) continue;
        const tpl = STARTER_TEMPLATES[tplId];
        const now = Date.now();
        const rec: WorkspaceRecord = {
          id: generateWorkspaceId(),
          name: tpl ? `${tpl.name} (Saved)` : tplId,
          sourceTemplateId: tpl?.id,
          createdAt: now,
          updatedAt: now,
          activeFile: 'main.py' in files ? 'main.py' : Object.keys(files)[0],
          files,
        };
        this.workspaces.set(rec.id, rec);
        this.persistWorkspace(rec);
      }
    } catch {
      // Ignore migration errors
    }
  }

  private persistWorkspace(ws: WorkspaceRecord): void {
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_WORKSPACES, 'readwrite');
        tx.objectStore(STORE_WORKSPACES).put(ws);
      } catch {
        // Ignore IDB write error
      }
      return;
    }

    this.persistFallbackLocalStorage();
  }

  private deleteWorkspaceFromDb(id: string): void {
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_WORKSPACES, 'readwrite');
        tx.objectStore(STORE_WORKSPACES).delete(id);
      } catch {
        // Ignore IDB delete error
      }
      return;
    }

    this.persistFallbackLocalStorage();
  }

  private async persistActiveId(): Promise<void> {
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_META, 'readwrite');
        tx.objectStore(STORE_META).put({ key: 'activeWorkspaceId', value: this.activeWorkspaceId });
      } catch {
        // Ignore
      }
      return;
    }

    this.persistFallbackLocalStorage();
  }

  private persistFallbackLocalStorage(): void {
    try {
      localStorage.setItem(
        FALLBACK_LS_KEY,
        JSON.stringify({
          activeWorkspaceId: this.activeWorkspaceId,
          workspaces: Array.from(this.workspaces.values()),
        })
      );
    } catch {
      // Quota exceeded in fallback storage
    }
  }

  public listWorkspaces(): WorkspaceRecord[] {
    return Array.from(this.workspaces.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public isActiveWorkspaceReadOnly(): boolean {
    return Boolean(this.examplePreview);
  }

  public getActiveExampleTemplateId(): string | null {
    return this.examplePreview?.sourceTemplateId ?? null;
  }

  public openExampleWorkspaceReadOnly(templateId: string): WorkspaceRecord {
    const tpl = STARTER_TEMPLATES[templateId] || STARTER_TEMPLATES['bouncing-ball'];
    const files = tpl.createFiles();
    const now = Date.now();
    this.examplePreview = {
      id: `example:${tpl.id}`,
      name: `${tpl.name} (Example)`,
      sourceTemplateId: tpl.id,
      readOnly: true,
      createdAt: now,
      updatedAt: now,
      activeFile: getDefaultActiveFile(files),
      files,
    };
    return this.examplePreview;
  }

  public cloneActiveExampleWorkspace(customName?: string): WorkspaceRecord | null {
    if (!this.examplePreview?.sourceTemplateId) return null;
    const prevActiveFile = this.examplePreview.activeFile;
    const created = this.cloneExampleWorkspace(this.examplePreview.sourceTemplateId, customName);
    if (prevActiveFile in created.files) {
      created.activeFile = prevActiveFile;
      this.persistWorkspace(created);
    }
    return created;
  }

  public getActiveWorkspace(): WorkspaceRecord {
    if (this.examplePreview) return this.examplePreview;
    const ws = this.workspaces.get(this.activeWorkspaceId);
    if (ws) return ws;
    const first = this.listWorkspaces()[0];
    if (first) {
      this.activeWorkspaceId = first.id;
      return first;
    }
    return this.createEmptyWorkspace('My First Game');
  }

  public openWorkspace(id: string): boolean {
    if (!this.workspaces.has(id)) return false;
    this.examplePreview = null;
    this.activeWorkspaceId = id;
    const ws = this.workspaces.get(id)!;
    ws.updatedAt = Date.now();
    this.persistWorkspace(ws);
    void this.persistActiveId();
    return true;
  }

  public cloneExampleWorkspace(templateId: string, customName?: string): WorkspaceRecord {
    this.examplePreview = null;
    const tpl = STARTER_TEMPLATES[templateId] || STARTER_TEMPLATES['bouncing-ball'];
    const files = tpl.createFiles();
    const existingNames = new Set(Array.from(this.workspaces.values()).map((w) => w.name));
    let baseName = customName?.trim() || tpl.name;
    let finalName = baseName;
    let counter = 2;
    while (existingNames.has(finalName)) {
      finalName = `${baseName} (${counter++})`;
    }

    const now = Date.now();
    const record: WorkspaceRecord = {
      id: generateWorkspaceId(),
      name: finalName,
      sourceTemplateId: tpl.id,
      createdAt: now,
      updatedAt: now,
      activeFile: getDefaultActiveFile(files),
      files,
    };

    this.workspaces.set(record.id, record);
    this.activeWorkspaceId = record.id;
    this.persistWorkspace(record);
    void this.persistActiveId();
    return record;
  }

  public createEmptyWorkspace(name?: string): WorkspaceRecord {
    this.examplePreview = null;
    const existingNames = new Set(Array.from(this.workspaces.values()).map((w) => w.name));
    const baseName = name?.trim() || 'New Workspace';
    let finalName = baseName;
    let counter = 2;
    while (existingNames.has(finalName)) {
      finalName = `${baseName} (${counter++})`;
    }

    const now = Date.now();
    const record: WorkspaceRecord = {
      id: generateWorkspaceId(),
      name: finalName,
      createdAt: now,
      updatedAt: now,
      activeFile: 'main.py',
      files: {
        'main.py': `import pygame

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

running = True
while running:
    screen.fill((15, 23, 42))

    # Draw your game here!
    pygame.draw.circle(screen, (56, 189, 248), (200, 140), 24)

    pygame.display.flip()
    clock.tick(60)
`,
      },
    };

    this.workspaces.set(record.id, record);
    this.activeWorkspaceId = record.id;
    this.persistWorkspace(record);
    void this.persistActiveId();
    return record;
  }

  public duplicateWorkspace(id: string): WorkspaceRecord | null {
    const orig = this.workspaces.get(id);
    if (!orig) return null;
    this.examplePreview = null;
    const now = Date.now();
    const copy: WorkspaceRecord = {
      id: generateWorkspaceId(),
      name: `${orig.name} Copy`,
      sourceTemplateId: orig.sourceTemplateId,
      createdAt: now,
      updatedAt: now,
      activeFile: orig.activeFile,
      files: { ...orig.files },
    };
    this.workspaces.set(copy.id, copy);
    this.activeWorkspaceId = copy.id;
    this.persistWorkspace(copy);
    void this.persistActiveId();
    return copy;
  }

  public renameWorkspace(id: string, newName: string): void {
    const ws = this.workspaces.get(id);
    const clean = newName.trim();
    if (!ws || !clean) return;
    ws.name = clean;
    ws.updatedAt = Date.now();
    this.persistWorkspace(ws);
  }

  public deleteWorkspace(id: string): boolean {
    if (!this.workspaces.has(id)) return false;
    this.workspaces.delete(id);
    this.deleteWorkspaceFromDb(id);

    if (this.workspaces.size === 0) {
      this.createEmptyWorkspace('New Workspace');
    } else if (this.activeWorkspaceId === id) {
      this.activeWorkspaceId = this.listWorkspaces()[0].id;
      void this.persistActiveId();
    }
    return true;
  }

  public saveToStorage(): void {
    if (this.examplePreview) return;
    const ws = this.getActiveWorkspace();
    ws.updatedAt = Date.now();
    this.persistWorkspace(ws);
    void this.persistActiveId();
  }

  public getFiles(): Record<string, string> {
    return this.getActiveWorkspace().files;
  }

  public getFileNames(): string[] {
    const files = this.getFiles();
    const order = (name: string): number => {
      if (name === 'main.py') return 0;
      const kind = classifyWorkspaceFile(name, files[name]);
      if (kind === 'python') return 1;
      if (kind === 'sprite-sheet') return 2;
      if (kind === 'png') return 3;
      if (kind === 'wav') return 4;
      return 5;
    };
    return Object.keys(files).sort((a, b) => {
      const diff = order(a) - order(b);
      return diff !== 0 ? diff : a.localeCompare(b);
    });
  }

  public getActiveFileName(): string {
    const ws = this.getActiveWorkspace();
    if (ws.activeFile && ws.activeFile in ws.files) return ws.activeFile;
    ws.activeFile = getDefaultActiveFile(ws.files);
    return ws.activeFile;
  }

  public getActiveFileContent(): string {
    const ws = this.getActiveWorkspace();
    return ws.files[this.getActiveFileName()] || '';
  }

  public setActiveFile(filename: string): string {
    const ws = this.getActiveWorkspace();
    if (filename in ws.files) {
      ws.activeFile = filename;
      if (!this.examplePreview) {
        this.saveToStorage();
      }
    }
    return this.getActiveFileContent();
  }

  public setFileContent(filename: string, content: string): void {
    if (this.examplePreview) return;
    const ws = this.getActiveWorkspace();
    ws.files[filename] = content;
    this.saveToStorage();
  }

  public getFileContent(filename: string): string | null {
    const files = this.getFiles();
    return filename in files ? files[filename] : null;
  }

  public updateActiveFileContent(content: string): void {
    if (this.examplePreview) return;
    const ws = this.getActiveWorkspace();
    ws.files[this.getActiveFileName()] = content;
    this.saveToStorage();
  }

  public createFile(filename: string, initialContent?: string): string {
    if (this.examplePreview) return this.getActiveFileName();
    const ws = this.getActiveWorkspace();
    const trimmed = filename.trim().replace(/^\/+/, '');
    const hasExt = /\.[a-z0-9]+$/i.test(trimmed);
    const clean = hasExt ? trimmed : `${trimmed}.py`;

    if (!(clean in ws.files)) {
      if (initialContent !== undefined) {
        ws.files[clean] = initialContent;
      } else if (clean.toLowerCase().endsWith('.png')) {
        ws.files[clean] = createBlankPngDataUrl(16);
      } else if (clean.toLowerCase().endsWith('.wav')) {
        ws.files[clean] = createStarterSoundWav('boop');
      } else if (clean.toLowerCase() === 'sprites_data.py') {
        ws.files[clean] = getDefaultSpritesDataPy();
      } else {
        ws.files[clean] = '# New Python file\n';
      }
    }

    ws.activeFile = clean;
    this.saveToStorage();
    return clean;
  }

  public deleteFile(filename: string): boolean {
    if (this.examplePreview) return false;
    const ws = this.getActiveWorkspace();
    if (!(filename in ws.files)) return false;
    if (Object.keys(ws.files).length <= 1) return false;
    delete ws.files[filename];
    if (ws.activeFile === filename) {
      ws.activeFile = this.getFileNames()[0] || 'main.py';
    }
    this.saveToStorage();
    return true;
  }

  /**
   * Returns the best runnable Python file in the active workspace
   * (the active regular .py file, or main.py, or first regular .py file).
   */
  public getRunnablePythonFile(): { filename: string; code: string } | null {
    const files = this.getFiles();
    const active = this.getActiveFileName();
    if (classifyWorkspaceFile(active, files[active]) === 'python') {
      return { filename: active, code: files[active] || '' };
    }
    if ('main.py' in files) {
      return { filename: 'main.py', code: files['main.py'] };
    }
    const firstPy = this.getFileNames().find(
      (f) => classifyWorkspaceFile(f, files[f]) === 'python'
    );
    return firstPy ? { filename: firstPy, code: files[firstPy] } : null;
  }

  /**
   * Opens a real local directory using the File System Access API (`showDirectoryPicker`)
   * and imports its .py, .png, and .wav files into a new workspace.
   */
  public async openLocalDirectory(): Promise<boolean> {
    const win = window as any;
    if (typeof win.showDirectoryPicker !== 'function') {
      alert(
        'Your browser does not support showDirectoryPicker. Projects are automatically saved in browser storage!'
      );
      return false;
    }

    const readDir = async (dirHandle: any, prefix: string, out: Record<string, string>) => {
      for await (const entry of dirHandle.values()) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory' && !entry.name.startsWith('.') && entry.name !== '__pycache__') {
          await readDir(entry, rel, out);
        } else if (entry.kind === 'file') {
          const lower = entry.name.toLowerCase();
          if (lower.endsWith('.py')) {
            const file = await entry.getFile();
            out[rel] = await file.text();
          } else if (lower.endsWith('.png') || lower.endsWith('.wav')) {
            const file = await entry.getFile();
            out[rel] = await fileToDataUrl(file);
          }
        }
      }
    };

    try {
      const dirHandle = await win.showDirectoryPicker();
      const loadedFiles: Record<string, string> = {};
      await readDir(dirHandle, '', loadedFiles);

      if (Object.keys(loadedFiles).length === 0) {
        loadedFiles['main.py'] = STARTER_TEMPLATES['bouncing-ball'].createFiles()['main.py'];
      }

      const now = Date.now();
      const record: WorkspaceRecord = {
        id: generateWorkspaceId(),
        name: `📂 ${dirHandle.name}`,
        createdAt: now,
        updatedAt: now,
        activeFile: 'main.py' in loadedFiles ? 'main.py' : Object.keys(loadedFiles)[0],
        files: loadedFiles,
      };
      this.examplePreview = null;
      this.workspaces.set(record.id, record);
      this.activeWorkspaceId = record.id;
      this.persistWorkspace(record);
      void this.persistActiveId();
      return true;
    } catch {
      return false;
    }
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
