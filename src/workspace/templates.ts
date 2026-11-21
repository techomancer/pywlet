import {
  createStarterSpriteProject,
  serializeSpriteProjectToPython,
} from '../sprite-editor/sprite-data';

export interface ProjectTemplate {
  id: string;
  name: string;
  files: Record<string, string>;
}

const DEFAULT_SPRITES_DATA_PY = serializeSpriteProjectToPython(createStarterSpriteProject(8));

export const STARTER_TEMPLATES: Record<string, ProjectTemplate> = {
  'tilemap-adventure': {
    id: 'tilemap-adventure',
    name: 'Tilemap World & Sprites (Pygame)',
    files: {
      'main.py': `import pygame
from sprites_data import PALETTE, SPRITE_SHEETS, TILEMAPS

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

# Built-in Pygame Font for drawing HUD text!
font = pygame.font.SysFont("monospace", 16)

# Hero ship position (Sprite #4 from your "overworld" Sprite Sheet!)
player_x = 180
player_y = 140
coin_x = 96
coin_y = 64
score = 0

print("Use Arrow Keys to fly Sprite #4 across your 'level_1' Tilemap!")
print("Click [🎨 Sprite & Map Studio] above to edit sheets ('overworld', 'dungeon') & maps ('level_1', 'level_2')!")

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
      'sprites_data.py': DEFAULT_SPRITES_DATA_PY,
    },
  },
  'bouncing-ball': {
    id: 'bouncing-ball',
    name: 'Bouncing Ball (Pygame)',
    files: {
      'main.py': `import pygame

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

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
    if x < 18:
        dx = 3

    # 4. Bounce off the top/bottom walls (0 to 280)
    if y > 262:
        dy = -2
    if y < 18:
        dy = 2

    # 5. Paint the background & draw our ball!
    screen.fill((15, 23, 42))
    pygame.draw.circle(screen, (56, 189, 248), (x, y), radius)

    pygame.display.flip()
    clock.tick(60)
`,
      'sprites_data.py': DEFAULT_SPRITES_DATA_PY,
      'notes.py': `# Try these fun experiments in main.py!
# 1. What happens if you change the numbers inside screen.fill((15, 23, 42))?
# 2. Can you add UP and DOWN arrow key controls using pygame.K_UP and pygame.K_DOWN?
# 3. Switch to the [🎨 Sprite & Map Studio] tab to edit sprites_data.py!
`,
    },
  },
  'star-catcher': {
    id: 'star-catcher',
    name: 'Star Catcher (Pygame)',
    files: {
      'main.py': `import pygame

pygame.init()
screen = pygame.display.set_mode((400, 280))
clock = pygame.time.Clock()

# Spaceship paddle at the bottom
ship_x = 170
ship_y = 245

# Falling star position
star_x = 200
star_y = 20
star_speed = 3

print("Use LEFT and RIGHT arrow keys to catch the falling golden star!")

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
    if star_x > 360:
        star_x = 40

    # Draw space background, golden star, and blue ship
    screen.fill((10, 12, 28))
    pygame.draw.circle(screen, (250, 204, 21), (star_x, star_y), 10)
    pygame.draw.rect(screen, (34, 197, 94), (ship_x, ship_y, 60, 14))

    pygame.display.flip()
    clock.tick(60)
`,
    },
  },
  'python-playground': {
    id: 'python-playground',
    name: 'Python Playground',
    files: {
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
    },
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
    <strong>🔤 Drawing Text &amp; Built-in Fonts</strong><br/>
    1. Create a font:<br/>
    <code>font = pygame.font.SysFont("monospace", 18)</code><br/>
    <em>(or default: <code>pygame.font.Font(None, 24)</code>)</em><br/>
    2. Render &amp; draw inside loop:<br/>
    <code>img = font.render("Score: " + str(score), True, (250, 204, 21))</code><br/>
    <code>screen.blit(img, (10, 10))</code>
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

const STORAGE_KEY = 'pywlet_workspace_v1';

export class WorkspaceStore {
  private currentProjectId = 'bouncing-ball';
  private files: Record<string, string> = {};
  private activeFile = 'main.py';

  constructor() {
    this.loadFromStorageOrTemplate('bouncing-ball');
  }

  loadFromStorageOrTemplate(templateId: string): void {
    this.currentProjectId = templateId;
    const savedRaw = localStorage.getItem(`${STORAGE_KEY}_${templateId}`);
    if (savedRaw) {
      try {
        this.files = JSON.parse(savedRaw);
        this.activeFile = Object.keys(this.files)[0] || 'main.py';
        return;
      } catch {
        // fallback to template
      }
    }
    const tpl = STARTER_TEMPLATES[templateId] || STARTER_TEMPLATES['bouncing-ball'];
    this.files = { ...tpl.files };
    this.activeFile = Object.keys(this.files)[0] || 'main.py';
  }

  saveToStorage(): void {
    localStorage.setItem(`${STORAGE_KEY}_${this.currentProjectId}`, JSON.stringify(this.files));
  }

  getFiles(): Record<string, string> {
    return this.files;
  }

  getFileNames(): string[] {
    return Object.keys(this.files);
  }

  getActiveFileName(): string {
    return this.activeFile;
  }

  getActiveFileContent(): string {
    return this.files[this.activeFile] || '';
  }

  setActiveFile(filename: string): string {
    if (filename in this.files) {
      this.activeFile = filename;
    }
    return this.getActiveFileContent();
  }

  setFileContent(filename: string, code: string): void {
    this.files[filename] = code;
    this.saveToStorage();
  }

  getFileContent(filename: string): string | null {
    return filename in this.files ? this.files[filename] : null;
  }

  updateActiveFileContent(code: string): void {
    this.files[this.activeFile] = code;
    this.saveToStorage();
  }

  createFile(filename: string, initialContent = '# New Python file\n'): void {
    const clean = filename.endsWith('.py') ? filename : `${filename}.py`;
    if (!(clean in this.files)) {
      this.files[clean] = initialContent;
    }
    this.activeFile = clean;
    this.saveToStorage();
  }

  /**
   * Opens a real local directory using the File System Access API (`showDirectoryPicker`)
   * so projects can live directly in a local folder on disk.
   */
  async openLocalDirectory(): Promise<boolean> {
    const win = window as any;
    if (typeof win.showDirectoryPicker !== 'function') {
      alert('Your browser does not support showDirectoryPicker. Projects are automatically saved in local storage!');
      return false;
    }

    try {
      const dirHandle = await win.showDirectoryPicker();
      const loadedFiles: Record<string, string> = {};

      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.py')) {
          const file = await entry.getFile();
          loadedFiles[entry.name] = await file.text();
        }
      }

      if (Object.keys(loadedFiles).length === 0) {
        loadedFiles['main.py'] = STARTER_TEMPLATES['bouncing-ball'].files['main.py'];
      }

      this.currentProjectId = `local_${dirHandle.name}`;
      this.files = loadedFiles;
      this.activeFile = 'main.py' in loadedFiles ? 'main.py' : Object.keys(loadedFiles)[0];
      this.saveToStorage();
      return true;
    } catch {
      return false;
    }
  }
}
