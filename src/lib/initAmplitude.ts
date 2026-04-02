/** Amplitude + session replay — production only (skipped in dev). */

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
      await loadScript('https://cdn.amplitude.com/libs/plugin-session-replay-browser-1.8.0-min.js.gz');
      const w = window as Window & {
        amplitude?: { add: (p: unknown) => void; init: (key: string, opts: Record<string, unknown>) => void };
        sessionReplay?: { plugin: (o: { sampleRate: number }) => unknown };
      };
      if (w.amplitude?.add && w.amplitude?.init && w.sessionReplay?.plugin) {
        w.amplitude.add(w.sessionReplay.plugin({ sampleRate: 1 }));
        w.amplitude.init('f102288553e5548784ae8a31c758f23b', {
          autocapture: { elementInteractions: true },
        });
      }
    } catch {
      /* non-fatal */
    }
  })();
}
