interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const COI_RELOAD_GUARD_KEY = 'pywlet-coi-reloaded';

/**
 * Registers the Pywlet PWA Service Worker (in production builds),
 * bootstraps Cross-Origin Isolation (COOP/COEP) so multi-threaded WASM
 * works on static hosts like GitHub Pages, and wires up the optional
 * "Install App" toolbar button.
 */
export function initPwa(installButton?: HTMLElement | null): void {
  setupInstallPrompt(installButton);

  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  // Only register the offline/COI service worker in production builds so
  // Vite dev server HMR is never intercepted by cached bundles.
  if (!import.meta.env.PROD) {
    return;
  }

  if (window.crossOriginIsolated) {
    try {
      sessionStorage.removeItem(COI_RELOAD_GUARD_KEY);
    } catch {
      // Ignore storage access errors
    }
  }

  const baseUrl = import.meta.env.BASE_URL || '/';
  const swUrl = `${baseUrl}sw.js`;

  const reloadOnceForCrossOriginIsolation = () => {
    if (window.crossOriginIsolated) return;
    try {
      if (sessionStorage.getItem(COI_RELOAD_GUARD_KEY) === '1') {
        return;
      }
      sessionStorage.setItem(COI_RELOAD_GUARD_KEY, '1');
    } catch {
      return;
    }
    window.location.reload();
  };

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Once our SW takes control on first visit to a static host without COOP/COEP
    // headers (such as GitHub Pages), reload once so the document & workers load
    // with Cross-Origin Isolation enabled (unlocking 4-thread SharedArrayBuffer WASM).
    reloadOnceForCrossOriginIsolation();
  });

  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register(swUrl, {
        scope: baseUrl,
      });

      // If the page is already controlled by the SW but still not isolated
      // (e.g. a hard shift-reload bypassed the SW), trigger one clean reload.
      if (!window.crossOriginIsolated && navigator.serviceWorker.controller) {
        reloadOnceForCrossOriginIsolation();
      }

      // Check for new releases in the background
      registration.update().catch(() => {});
    } catch (err) {
      console.warn('[Pywlet PWA] Service worker registration failed:', err);
    }
  });
}

function setupInstallPrompt(installButton?: HTMLElement | null): void {
  if (!installButton) return;

  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true;

  if (isStandalone) {
    installButton.classList.add('hidden');
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    installButton.classList.remove('hidden');
  });

  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installButton.setAttribute('disabled', 'true');
    try {
      await deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        installButton.classList.add('hidden');
      }
    } finally {
      deferredPrompt = null;
      installButton.removeAttribute('disabled');
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installButton.classList.add('hidden');
  });
}
