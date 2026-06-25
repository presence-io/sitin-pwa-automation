// Lazy-load rrweb (record + Replayer) only when screen sync is used, so the
// always-injected autobot.js / dashboard.js stay small.
// The `rrweb` package is kept as a type-only dependency — never bundled.
//
// rrweb is served from the same Pages origin as autobot.js and loaded by
// fetching its text and running it as an inline <script>. This mirrors how the
// agent itself is injected, so it works under strict PWA CSPs that allow inline
// scripts but block external <script src> hosts (e.g. a CDN). An external
// <script src> to a third-party CDN is blocked by `script-src` on such pages.

const RRWEB_URL = 'https://presence-io.github.io/sitin-pwa-automation/rrweb.umd.min.cjs';

type RRWeb = typeof import('rrweb');

let loadingPromise: Promise<RRWeb> | null = null;

export function loadRrweb(): Promise<RRWeb> {
  const existing = (window as any).rrweb as RRWeb | undefined;
  if (existing) return Promise.resolve(existing);
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async (): Promise<RRWeb> => {
    let code: string;
    try {
      const resp = await fetch(RRWEB_URL);
      if (!resp.ok) throw new Error(`rrweb fetch ${resp.status}`);
      code = await resp.text();
    } catch (e) {
      loadingPromise = null;
      throw new Error('rrweb load failed: ' + (e as Error).message);
    }
    const s = document.createElement('script');
    s.textContent = code; // inline — allowed wherever the inline-injected agent runs
    document.head.appendChild(s);
    const r = (window as any).rrweb as RRWeb | undefined;
    if (!r) { loadingPromise = null; throw new Error('rrweb global missing after load'); }
    return r;
  })();
  return loadingPromise;
}
