export interface TourStep {
  title: string;
  body: string;
  selector?: string;
  placement?: 'right' | 'left' | 'bottom' | 'top' | 'center';
}

const TOUR_STORAGE_KEY = 'pywlet_tour_seen_v1';

const DEFAULT_TOUR_STEPS: TourStep[] = [
  {
    title: '👋 Welcome to Pywlet!',
    body: 'Pywlet is your own studio to build <strong>Python &amp; Pygame</strong> games right in the browser — everything autosaves automatically! Let’s take a super quick tour, or click <strong>Skip</strong> anytime.',
    placement: 'center',
  },
  {
    title: '📁 Playspaces, History & 🐛 Debugger',
    body: 'Use the tabs at the top to switch between <strong>Files</strong>, <strong>Spaces</strong>, <strong>History</strong> checkpoints, and the live <strong>Debug</strong> variable inspector. You can also drag the panel borders to resize!',
    selector: '.sidebar',
    placement: 'right',
  },
  {
    title: '🎨 Themes & Button Icons',
    body: 'Make Pywlet look the way you like! Pick from 9 themes (including Nature, Ocean, Cotton Candy, Lilac Glam, Hacker Green/Amber &amp; Black &amp; White) and toggle button icons On or Off right here.',
    selector: '.project-controls',
    placement: 'bottom',
  },
  {
    title: '✏️ Code, Sprite & Sound Editor',
    body: 'Write your Python code here! When you click <code>sprites_data.py</code>, a <code>.png</code> image, or a <code>.wav</code> sound on the left, this area automatically switches to the Sprite Editor or Sound Synth.',
    selector: '.editor-column',
    placement: 'left',
  },
  {
    title: '▶ Run, 🐛 Debug & 🧘 Focus Mode',
    body: 'Click <strong>▶ Run Game</strong> to play at 60 FPS, or <strong>🐛 Debug</strong> (and click line numbers for red breakpoints) to walk through your code line by line and watch variables change live!',
    selector: '.run-controls',
    placement: 'bottom',
  },
  {
    title: '🎮 Interactive Game Stage',
    body: 'Your Pygame game runs right here at 60 FPS. Click the stage to use arrow keys, or hit <strong>Full Window</strong> / <strong>Fullscreen</strong> to play big!',
    selector: '#stage-panel',
    placement: 'left',
  },
  {
    title: '🦉 Pywlet AI Tutor & Console',
    body: 'Stuck on an error or curious what a line does? Highlight any Python word and click <strong>💡 Explain</strong>, or ask a question here — Pywlet gives hints without spoiling the code. Have fun coding!',
    selector: '.tutor-panel',
    placement: 'left',
  },
];

export class UiTourOverlay {
  private steps: TourStep[];
  private onBeforeStart?: () => void;
  private currentIdx = 0;
  private rootEl: HTMLElement | null = null;
  private spotlightEl: HTMLElement | null = null;
  private cardEl: HTMLElement | null = null;
  private keyHandler: (e: KeyboardEvent) => void;
  private resizeHandler: () => void;

  constructor(onBeforeStart?: () => void, steps: TourStep[] = DEFAULT_TOUR_STEPS) {
    this.onBeforeStart = onBeforeStart;
    this.steps = steps;
    this.keyHandler = (e: KeyboardEvent) => {
      if (!this.rootEl) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        this.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.prev();
      }
    };
    this.resizeHandler = () => {
      if (this.rootEl) this.positionCurrentStep();
    };
  }

  public startIfFirstVisit(): void {
    try {
      if (localStorage.getItem(TOUR_STORAGE_KEY) === '1') {
        return;
      }
    } catch {
      return;
    }
    // Let initial layout settle before positioning spotlight
    window.setTimeout(() => this.start(), 350);
  }

  public start(): void {
    this.onBeforeStart?.();
    this.currentIdx = 0;
    this.mount();
    this.renderStep();
  }

  public close(): void {
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, '1');
    } catch {
      // Ignore storage errors
    }
    window.removeEventListener('keydown', this.keyHandler);
    window.removeEventListener('resize', this.resizeHandler);
    if (this.rootEl) {
      this.rootEl.remove();
      this.rootEl = null;
      this.spotlightEl = null;
      this.cardEl = null;
    }
  }

  private next(): void {
    if (this.currentIdx >= this.steps.length - 1) {
      this.close();
      return;
    }
    this.currentIdx++;
    this.renderStep();
  }

  private prev(): void {
    if (this.currentIdx <= 0) return;
    this.currentIdx--;
    this.renderStep();
  }

  private mount(): void {
    if (this.rootEl) {
      this.rootEl.remove();
    }

    const root = document.createElement('div');
    root.className = 'tour-overlay-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.innerHTML = `
      <div class="tour-backdrop"></div>
      <div class="tour-spotlight"></div>
      <div class="tour-card">
        <div class="tour-card-header">
          <strong class="tour-card-title"></strong>
          <button class="icon-btn tour-close-btn" title="Close tour (Esc)">✕</button>
        </div>
        <p class="tour-card-body"></p>
        <div class="tour-card-footer">
          <div class="tour-dots"></div>
          <div class="tour-nav-btns">
            <button class="btn btn-small tour-skip-btn">Skip</button>
            <button class="btn btn-small tour-prev-btn">← Prev</button>
            <button class="btn btn-small btn-run tour-next-btn">Next →</button>
          </div>
        </div>
      </div>
    `;

    root.querySelector('.tour-backdrop')!.addEventListener('click', () => this.close());
    root.querySelector('.tour-close-btn')!.addEventListener('click', () => this.close());
    root.querySelector('.tour-skip-btn')!.addEventListener('click', () => this.close());
    root.querySelector('.tour-prev-btn')!.addEventListener('click', () => this.prev());
    root.querySelector('.tour-next-btn')!.addEventListener('click', () => this.next());

    document.body.appendChild(root);
    this.rootEl = root;
    this.spotlightEl = root.querySelector('.tour-spotlight');
    this.cardEl = root.querySelector('.tour-card');

    window.addEventListener('keydown', this.keyHandler);
    window.addEventListener('resize', this.resizeHandler);
  }

  private renderStep(): void {
    if (!this.rootEl || !this.cardEl) return;
    const step = this.steps[this.currentIdx];
    const isFirst = this.currentIdx === 0;
    const isLast = this.currentIdx === this.steps.length - 1;

    this.cardEl.querySelector('.tour-card-title')!.textContent = step.title;
    this.cardEl.querySelector('.tour-card-body')!.innerHTML = step.body;

    const prevBtn = this.cardEl.querySelector('.tour-prev-btn') as HTMLButtonElement;
    const nextBtn = this.cardEl.querySelector('.tour-next-btn') as HTMLButtonElement;
    const skipBtn = this.cardEl.querySelector('.tour-skip-btn') as HTMLButtonElement;

    prevBtn.disabled = isFirst;
    prevBtn.classList.toggle('hidden', isFirst);
    skipBtn.classList.toggle('hidden', isLast);
    nextBtn.textContent = isLast ? '🎉 Start Coding!' : 'Next →';

    const dotsEl = this.cardEl.querySelector('.tour-dots')!;
    dotsEl.innerHTML = '';
    this.steps.forEach((_, idx) => {
      const dot = document.createElement('button');
      dot.className = `tour-dot ${idx === this.currentIdx ? 'active' : ''}`;
      dot.title = `Step ${idx + 1} of ${this.steps.length}`;
      dot.addEventListener('click', () => {
        this.currentIdx = idx;
        this.renderStep();
      });
      dotsEl.appendChild(dot);
    });

    this.positionCurrentStep();
  }

  private positionCurrentStep(): void {
    if (!this.spotlightEl || !this.cardEl) return;
    const step = this.steps[this.currentIdx];
    const target = step.selector ? (document.querySelector(step.selector) as HTMLElement | null) : null;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardW = Math.min(360, vw - 24);
    this.cardEl.style.width = `${cardW}px`;

    // Measure card height after content update
    const cardRect = this.cardEl.getBoundingClientRect();
    const cardH = Math.max(150, cardRect.height || 180);

    if (!target || step.placement === 'center') {
      this.spotlightEl.classList.add('tour-spotlight-hidden');
      this.cardEl.style.left = `${Math.max(12, Math.round((vw - cardW) / 2))}px`;
      this.cardEl.style.top = `${Math.max(12, Math.round((vh - cardH) / 2))}px`;
      return;
    }

    const rect = target.getBoundingClientRect();
    const pad = 6;
    const sx = Math.max(2, rect.left - pad);
    const sy = Math.max(2, rect.top - pad);
    const sw = Math.min(vw - sx - 2, rect.width + pad * 2);
    const sh = Math.min(vh - sy - 2, rect.height + pad * 2);

    this.spotlightEl.classList.remove('tour-spotlight-hidden');
    this.spotlightEl.style.left = `${sx}px`;
    this.spotlightEl.style.top = `${sy}px`;
    this.spotlightEl.style.width = `${sw}px`;
    this.spotlightEl.style.height = `${sh}px`;

    const gap = 14;
    let left = (vw - cardW) / 2;
    let top = (vh - cardH) / 2;

    if (step.placement === 'right' && rect.right + gap + cardW < vw - 12) {
      left = rect.right + gap;
      top = Math.min(vh - cardH - 16, Math.max(16, rect.top + 20));
    } else if (step.placement === 'left' && rect.left - gap - cardW > 12) {
      left = rect.left - gap - cardW;
      top = Math.min(vh - cardH - 16, Math.max(16, rect.top + 20));
    } else if (step.placement === 'bottom' && rect.bottom + gap + cardH < vh - 12) {
      left = Math.min(vw - cardW - 16, Math.max(16, rect.right - cardW));
      top = rect.bottom + gap;
    } else if (step.placement === 'top' && rect.top - gap - cardH > 12) {
      left = Math.min(vw - cardW - 16, Math.max(16, rect.left + (rect.width - cardW) / 2));
      top = rect.top - gap - cardH;
    } else {
      // Smart fallback inside viewport
      left = Math.min(vw - cardW - 16, Math.max(16, (vw - cardW) / 2));
      top =
        rect.bottom + gap + cardH < vh - 12
          ? rect.bottom + gap
          : Math.max(16, rect.top - gap - cardH);
    }

    this.cardEl.style.left = `${Math.round(left)}px`;
    this.cardEl.style.top = `${Math.round(top)}px`;
  }
}
