// Lazy-load rrweb (record + Replayer) from CDN only when screen sync is used,
// so the always-injected autobot.js / dashboard.js stay small.
// The `rrweb` package is kept as a type-only dependency — never bundled.

const RRWEB_CDN = 'https://cdn.jsdelivr.net/npm/rrweb@2.0.1/dist/rrweb.umd.min.cjs';

type RRWeb = typeof import('rrweb');

let loadingPromise: Promise<RRWeb> | null = null;

export function loadRrweb(): Promise<RRWeb> {
  const existing = (window as any).rrweb as RRWeb | undefined;
  if (existing) return Promise.resolve(existing);
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise<RRWeb>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = RRWEB_CDN;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => {
      const r = (window as any).rrweb as RRWeb | undefined;
      if (r) resolve(r);
      else { loadingPromise = null; reject(new Error('rrweb global missing after load')); }
    };
    s.onerror = () => { loadingPromise = null; reject(new Error('rrweb CDN load failed')); };
    document.head.appendChild(s);
  });
  return loadingPromise;
}
