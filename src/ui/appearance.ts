import * as monaco from 'monaco-editor';

export type PywletThemeId =
  | 'dark'
  | 'light'
  | 'nature'
  | 'ocean'
  | 'cotton-candy'
  | 'lilac-glam'
  | 'hacker-green'
  | 'hacker-amber'
  | 'bw';

export interface ThemeMeta {
  id: PywletThemeId;
  label: string;
  monacoTheme: string;
  metaThemeColor: string;
}

export const PYWLET_THEMES: Record<PywletThemeId, ThemeMeta> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    monacoTheme: 'vs-dark',
    metaThemeColor: '#161d29',
  },
  light: {
    id: 'light',
    label: 'Light',
    monacoTheme: 'vs',
    metaThemeColor: '#ffffff',
  },
  nature: {
    id: 'nature',
    label: 'Nature',
    monacoTheme: 'pywlet-nature',
    metaThemeColor: '#1d4d27',
  },
  ocean: {
    id: 'ocean',
    label: 'Ocean',
    monacoTheme: 'pywlet-ocean',
    metaThemeColor: '#0c243c',
  },
  'cotton-candy': {
    id: 'cotton-candy',
    label: 'Cotton Candy',
    monacoTheme: 'pywlet-cotton-candy',
    metaThemeColor: '#ffd6eb',
  },
  'lilac-glam': {
    id: 'lilac-glam',
    label: 'Lilac Glam',
    monacoTheme: 'pywlet-lilac-glam',
    metaThemeColor: '#2a1647',
  },
  'hacker-green': {
    id: 'hacker-green',
    label: 'Hacker Green',
    monacoTheme: 'pywlet-hacker-green',
    metaThemeColor: '#061408',
  },
  'hacker-amber': {
    id: 'hacker-amber',
    label: 'Hacker Amber',
    monacoTheme: 'pywlet-hacker-amber',
    metaThemeColor: '#170d04',
  },
  bw: {
    id: 'bw',
    label: 'Black & White',
    monacoTheme: 'pywlet-bw',
    metaThemeColor: '#0a0a0a',
  },
};

const THEME_STORAGE_KEY = 'pywlet_theme_v1';
const ICONS_STORAGE_KEY = 'pywlet_show_icons_v1';

let monacoThemesRegistered = false;

export function registerCustomMonacoThemes(): void {
  if (monacoThemesRegistered) return;
  monacoThemesRegistered = true;

  monaco.editor.defineTheme('pywlet-nature', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '86cf96', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff6ec7', fontStyle: 'bold' },
      { token: 'string', foreground: 'ffe047' },
      { token: 'number', foreground: 'd8a2ff' },
      { token: 'identifier', foreground: 'ecffe8' },
    ],
    colors: {
      'editor.background': '#103119',
      'editor.foreground': '#f0ffec',
      'editorLineNumber.foreground': '#68b077',
      'editorLineNumber.activeForeground': '#ffe047',
      'editor.lineHighlightBackground': '#184424',
      'editor.selectionBackground': '#2f7a4488',
      'editorCursor.foreground': '#ff6ec7',
    },
  });

  monaco.editor.defineTheme('pywlet-cotton-candy', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a66c96', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'db2777', fontStyle: 'bold' },
      { token: 'string', foreground: '0284c7' },
      { token: 'number', foreground: '9333ea' },
      { token: 'identifier', foreground: '4a1535' },
    ],
    colors: {
      'editor.background': '#fff5fa',
      'editor.foreground': '#4a1535',
      'editorLineNumber.foreground': '#c07aa5',
      'editorLineNumber.activeForeground': '#db2777',
      'editor.lineHighlightBackground': '#ffe3f1',
      'editor.selectionBackground': '#f9a8d488',
      'editorCursor.foreground': '#ec4899',
    },
  });

  monaco.editor.defineTheme('pywlet-lilac-glam', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a78bfa', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'f472b6', fontStyle: 'bold' },
      { token: 'string', foreground: 'fde047' },
      { token: 'number', foreground: '67e8f9' },
      { token: 'identifier', foreground: 'f5ecff' },
    ],
    colors: {
      'editor.background': '#1d1033',
      'editor.foreground': '#f5ecff',
      'editorLineNumber.foreground': '#8b6bb8',
      'editorLineNumber.activeForeground': '#f9a8d4',
      'editor.lineHighlightBackground': '#2c194a',
      'editor.selectionBackground': '#7c3aed77',
      'editorCursor.foreground': '#fde047',
    },
  });

  monaco.editor.defineTheme('pywlet-ocean', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6794b8', fontStyle: 'italic' },
      { token: 'keyword', foreground: '22d3ee', fontStyle: 'bold' },
      { token: 'string', foreground: 'fde047' },
      { token: 'number', foreground: 'fb7185' },
      { token: 'identifier', foreground: 'e0f2fe' },
    ],
    colors: {
      'editor.background': '#061524',
      'editor.foreground': '#e0f2fe',
      'editorLineNumber.foreground': '#4f7a9c',
      'editorLineNumber.activeForeground': '#22d3ee',
      'editor.lineHighlightBackground': '#0d263f',
      'editor.selectionBackground': '#0e4a7388',
      'editorCursor.foreground': '#fb7185',
    },
  });

  monaco.editor.defineTheme('pywlet-hacker-green', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '2d7a3c', fontStyle: 'italic' },
      { token: 'keyword', foreground: '39ff14', fontStyle: 'bold' },
      { token: 'string', foreground: '86efac' },
      { token: 'number', foreground: 'bbf7d0' },
      { token: 'identifier', foreground: '4ade80' },
    ],
    colors: {
      'editor.background': '#020803',
      'editor.foreground': '#4ade80',
      'editorLineNumber.foreground': '#1f632b',
      'editorLineNumber.activeForeground': '#39ff14',
      'editor.lineHighlightBackground': '#081a0b',
      'editor.selectionBackground': '#16653488',
      'editorCursor.foreground': '#39ff14',
    },
  });

  monaco.editor.defineTheme('pywlet-hacker-amber', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9a6324', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff6a00', fontStyle: 'bold' },
      { token: 'string', foreground: 'ffd166' },
      { token: 'number', foreground: 'ff9e00' },
      { token: 'identifier', foreground: 'ffb703' },
    ],
    colors: {
      'editor.background': '#0c0602',
      'editor.foreground': '#ffb703',
      'editorLineNumber.foreground': '#784414',
      'editorLineNumber.activeForeground': '#ff8800',
      'editor.lineHighlightBackground': '#1c1005',
      'editor.selectionBackground': '#8a440888',
      'editorCursor.foreground': '#ff6a00',
    },
  });

  monaco.editor.defineTheme('pywlet-bw', {
    base: 'hc-black',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '999999', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
      { token: 'string', foreground: 'd4d4d4' },
      { token: 'number', foreground: 'e5e5e5' },
      { token: 'identifier', foreground: 'ffffff' },
    ],
    colors: {
      'editor.background': '#000000',
      'editor.foreground': '#ffffff',
      'editorLineNumber.foreground': '#737373',
      'editorLineNumber.activeForeground': '#ffffff',
      'editor.lineHighlightBackground': '#171717',
      'editor.selectionBackground': '#ffffff44',
      'editorCursor.foreground': '#ffffff',
    },
  });
}

const DECORATIVE_ICON_RE =
  /([\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u2600-\u27BF\u25A0-\u25FF\u2B00-\u2BFF\u23F0-\u23FF]\uFE0F?(?:\u200D[\p{Extended_Pictographic}\u{1F300}-\u{1FAFF}\u2600-\u27BF]\uFE0F?)*)/gu;

const ICON_TARGET_SELECTOR =
  'button, .btn, .icon-btn, .mode-tab, .chip, label.btn, label.icon-btn, .section-header span';

function decorateElementIcons(el: HTMLElement): void {
  if (el.closest('.monaco-editor')) return;

  // Never strip the ONLY visible label from an icon-only button (e.g. "✕", "✏️", "📋", "🗑")
  const fullText = (el.textContent || '').trim();
  const strippedText = fullText.replace(DECORATIVE_ICON_RE, '').trim();
  if (!strippedText) return;

  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.classList.contains('ui-icon')) {
      textNodes.push(node as Text);
    }
    node = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const val = textNode.nodeValue || '';
    DECORATIVE_ICON_RE.lastIndex = 0;
    if (!DECORATIVE_ICON_RE.test(val)) continue;
    DECORATIVE_ICON_RE.lastIndex = 0;

    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DECORATIVE_ICON_RE.exec(val)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(val.slice(lastIndex, match.index)));
      }
      // Include a single following space inside the hidden span so text aligns cleanly when icons are off
      let end = match.index + match[0].length;
      if (val[end] === ' ') end++;
      const span = document.createElement('span');
      span.className = 'ui-icon';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = val.slice(match.index, end);
      frag.appendChild(span);
      lastIndex = end;
    }
    if (lastIndex < val.length) {
      frag.appendChild(document.createTextNode(val.slice(lastIndex)));
    }
    textNode.parentNode?.replaceChild(frag, textNode);
  }
}

export function decorateIconsInSubtree(root: ParentNode): void {
  if (root instanceof HTMLElement && root.matches(ICON_TARGET_SELECTOR)) {
    decorateElementIcons(root);
  }
  root.querySelectorAll?.(ICON_TARGET_SELECTOR).forEach((el) => {
    decorateElementIcons(el as HTMLElement);
  });
}

export class AppearanceController {
  private currentTheme: PywletThemeId = 'dark';
  private showIcons = true;
  private onMonacoThemeChange?: (monacoTheme: string) => void;
  private observer: MutationObserver | null = null;

  constructor(onMonacoThemeChange?: (monacoTheme: string) => void) {
    this.onMonacoThemeChange = onMonacoThemeChange;
    registerCustomMonacoThemes();
    this.loadPreferences();
    this.applyTheme(this.currentTheme, false);
    this.applyShowIcons(this.showIcons, false);
    this.startIconObserver();
  }

  private loadPreferences(): void {
    try {
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as PywletThemeId | null;
      if (savedTheme && savedTheme in PYWLET_THEMES) {
        this.currentTheme = savedTheme;
      }
      const savedIcons = localStorage.getItem(ICONS_STORAGE_KEY);
      if (savedIcons === '0') {
        this.showIcons = false;
      }
    } catch {
      // Ignore storage errors
    }
  }

  private startIconObserver(): void {
    decorateIconsInSubtree(document.body);
    this.observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'childList') {
          m.addedNodes.forEach((n) => {
            if (n instanceof HTMLElement) {
              decorateIconsInSubtree(n);
            } else if (n.parentElement && n.parentElement.matches(ICON_TARGET_SELECTOR)) {
              decorateElementIcons(n.parentElement);
            }
          });
        } else if (m.type === 'characterData' && m.target.parentElement) {
          const btn = m.target.parentElement.closest(ICON_TARGET_SELECTOR) as HTMLElement | null;
          if (btn) decorateElementIcons(btn);
        }
      }
    });
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  public getTheme(): PywletThemeId {
    return this.currentTheme;
  }

  public getShowIcons(): boolean {
    return this.showIcons;
  }

  public applyTheme(themeId: PywletThemeId, persist = true): void {
    const meta = PYWLET_THEMES[themeId] || PYWLET_THEMES.dark;
    this.currentTheme = meta.id;
    document.documentElement.dataset.theme = meta.id;

    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      themeColorMeta.setAttribute('content', meta.metaThemeColor);
    }

    this.onMonacoThemeChange?.(meta.monacoTheme);

    if (persist) {
      try {
        localStorage.setItem(THEME_STORAGE_KEY, meta.id);
      } catch {
        // Ignore
      }
    }
  }

  public applyShowIcons(show: boolean, persist = true): void {
    this.showIcons = show;
    document.body.classList.toggle('no-icons', !show);
    if (!show) {
      decorateIconsInSubtree(document.body);
    }
    if (persist) {
      try {
        localStorage.setItem(ICONS_STORAGE_KEY, show ? '1' : '0');
      } catch {
        // Ignore
      }
    }
  }
}
