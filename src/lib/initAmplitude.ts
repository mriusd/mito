/**
 * Amplitude analytics only — production builds (`import.meta.env.PROD`).
 * Session Replay is intentionally disabled (main-thread DOM recording made
 * prod UI laggy vs local vite dev).
 */

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

export function initAmplitudeIfProd(): void {
  if (!import.meta.env.PROD) return;

  void (async () => {
    try {
      await loadScript('https://cdn.amplitude.com/libs/analytics-browser-2.11.1-min.js.gz');
      const w = window as Window & {
        amplitude?: { init: (key: string, opts: Record<string, unknown>) => void };
      };
      if (!w.amplitude?.init) return;

      w.amplitude.init('f102288553e5548784ae8a31c758f23b', {
        autocapture: {
          elementInteractions: false,
          pageViews: true,
          sessions: true,
        },
      });
    } catch {
      /* non-fatal */
    }
  })();
}
