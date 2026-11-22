import { createStarterSoundWav } from '../audio-editor/wav-codec';

function renderPixelArtToPngDataUrl(rows: string[], palette: Record<string, string>, scale = 2): string {
  const h = rows.length;
  const w = rows[0]?.length || 8;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const color = palette[ch];
      if (color) {
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }
  return canvas.toDataURL('image/png');
}

let cachedStarterAssets: Record<string, string> | null = null;

export function getStarterAssetDataUrls(): Record<string, string> {
  if (cachedStarterAssets) return cachedStarterAssets;

  const shipPng = renderPixelArtToPngDataUrl(
    [
      '.......cc.......',
      '......cbbc......',
      '......cbbc......',
      '.....cbwwbc.....',
      '.....cbwwbc.....',
      '....cbbwwbbc....',
      '...ccbbbbbbcc...',
      '..cccbbbbbbccc..',
      '..cbbbbbbbbbbc..',
      '.ccbbbrrrrbbbcc.',
      '.cbbbrrrrrrbbbc.',
      '.cbbb......bbbc.',
      '..cc..o..o..cc..',
      '......y..y......',
      '......o..o......',
      '................',
    ],
    {
      c: '#38bdf8',
      b: '#2563eb',
      w: '#e2e8f0',
      r: '#ef4444',
      o: '#f97316',
      y: '#facc15',
    },
    2
  );

  const starPng = renderPixelArtToPngDataUrl(
    [
      '.......y........',
      '......yyy.......',
      '......yyy.......',
      '.....yyyyy......',
      '.yyyyyyyyyyyyy..',
      '..yyyywwyyyyy...',
      '...yyywwyyyy....',
      '....yyyyyyy.....',
      '...yyyyyyyyy....',
      '..yyyy...yyyy...',
      '.yyy.......yyy..',
      '..y.........y...',
    ],
    {
      y: '#facc15',
      w: '#fef9c3',
    },
    2
  );

  const alienPng = renderPixelArtToPngDataUrl(
    [
      '....g......g....',
      '.....g....g.....',
      '....gggggggg....',
      '...ggwggggwgg...',
      '..gggbg..bgbgg..',
      '..gggggggggggg..',
      '..g.gggggggg.g..',
      '..g.g......g.g..',
      '.....gg..gg.....',
    ],
    {
      g: '#22c55e',
      w: '#f8fafc',
      b: '#0f172a',
    },
    2
  );

  cachedStarterAssets = {
    'assets/ship.png': shipPng,
    'assets/star.png': starPng,
    'assets/alien.png': alienPng,
    'assets/boop.wav': createStarterSoundWav('boop'),
    'assets/coin.wav': createStarterSoundWav('coin'),
    'assets/jump.wav': createStarterSoundWav('jump'),
  };

  return cachedStarterAssets;
}

export function createBlankPngDataUrl(size = 16): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas.toDataURL('image/png');
}
