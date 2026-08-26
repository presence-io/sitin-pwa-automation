import { log, warn } from '../core/helpers';
import { loadRrweb } from '../shared/rrweb-loader';
import { fbPut, fbGet, fbDelete, fbListen, type FbSub } from '../shared/firebase';
import { packString } from '../shared/compress';
import { getDeviceId } from './remote';
import { startLogStream, stopLogStream, setLogFps } from './logsync';
import { startStorageStream, stopStorageStream, setStorageFps } from './storagesync';
import { startNetworkStream, stopNetworkStream, setNetworkFps } from './networksync';

let stopRecordFn: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: FbSub | null = null;
let starting = false;
let curScreenFps = 1;

// Whether a viewer is attached (syncControl.screenSync). Screen frames stream
// through the backend to whoever is watching; there is no peer-to-peer path.
let rtdbActive = false;

// Rolling buffer holds events since the last full snapshot (checkout), so a
// viewer joining at any time can rebuild the page from a self-contained window.
let buffer: any[] = [];
let bufferId = 0;
let dirty = false;

const SELF_UI = '#autobot-fab, #autobot-panel, #autobot-minibar, #autobot-text-picker, #autobot-assert-popup';

// Also block iframes from being recorded. The Replayer rebuilds every recorded
// iframe as a sandboxed about:blank frame; on iframe-heavy pages this floods the
// console with "Blocked script execution … sandboxed" and a failing iframe
// reconstruction blanks the whole stage (white-screen crash). Recording them as
// placeholders keeps the page layout while making replay stable.
const BLOCK_SELECTOR = `${SELF_UI}, iframe`;

// Start rrweb recording if not already running.
async function startRecording(fps = 1): Promise<void> {
  if (stopRecordFn || starting) return;
  starting = true;
  try {
    const rrweb = await loadRrweb(); // lazy: only fetched when sync is turned on
    if (stopRecordFn) return; // sync was stopped while the script loaded

    buffer = [];
    bufferId = Date.now();
    dirty = false;

    const stop = rrweb.record({
      emit(event: any, isCheckout?: boolean) {
        // On checkout rrweb emits a fresh Meta+FullSnapshot — start a new window.
        if (isCheckout) { buffer = []; bufferId = Date.now(); }
        buffer.push(event);
        dirty = true;
      },
      checkoutEveryNms: 10000,
      blockSelector: BLOCK_SELECTOR,
      recordCanvas: false,
      collectFonts: false,
      inlineStylesheet: true, // inline CSS rules → no cross-origin canvas taint
      sampling: { mousemove: 200, scroll: 200, input: 'last' },
    });
    stopRecordFn = stop ?? null;

    curScreenFps = fps;
    flushTimer = setInterval(flush, Math.max(500, Math.round(1000 / curScreenFps)));
    log('Screen sync started (rrweb, lazy-loaded)');
  } catch (e) {
    warn('Screen sync: rrweb load failed', e);
  } finally {
    starting = false;
  }
}

// Stop recording once no viewer needs it anymore.
function maybeStopRecording(): void {
  if (rtdbActive) return;
  if (stopRecordFn) { stopRecordFn(); stopRecordFn = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  buffer = [];
  dirty = false;
  log('Screen sync stopped');
}

async function flush(): Promise<void> {
  if (!dirty || buffer.length === 0 || !rtdbActive) return;
  dirty = false;

  // Write the full self-contained window (events serialized as a string to dodge
  // the 32-level depth / forbidden-key limits that 400 the write, then gzip'd to
  // cut the upload/SSE payload ~8x). A single last-write-wins key can't carry
  // deltas, so it stays full each flush.
  const deviceId = getDeviceId();
  const events = await packString(JSON.stringify(buffer));
  await fbPut(`screens/${deviceId}/screen`, {
    kind: 'rrweb',
    bufferId,
    events,
    url: location.pathname + location.search,
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
    timestamp: Date.now(),
  });
}

function startRtdbSync(fps = 1): void {
  rtdbActive = true;
  startRecording(fps);
}

function stopRtdbSync(): void {
  rtdbActive = false;
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}/screen`);
  maybeStopRecording();
}

// Change the recording flush rate in place while streaming (viewer moved the fps
// selector) — the rrweb recording keeps running, only the flush interval changes.
function setScreenFps(fps: number): void {
  const f = fps || 1;
  if (f === curScreenFps) return;
  curScreenFps = f;
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = setInterval(flush, Math.max(500, Math.round(1000 / curScreenFps)));
  }
}

// ── Public API ──

export function listenSyncControl(): void {
  const deviceId = getDeviceId();
  if (syncSource) syncSource.close();

  syncSource = fbListen(`syncControl/${deviceId}`, async (pushed) => {
    try {
      const data = pushed !== undefined ? pushed : await fbGet<any>(`syncControl/${deviceId}`);
      const fps = data?.fps || 1;
      // Logs + storage + network stream whenever a viewer is attached (screen
      // sync or logs alone). start* no-ops if already running; set*Fps applies a
      // changed rate in place.
      if (data?.screenSync || data?.logSync) {
        startLogStream(fps); setLogFps(fps);
        startStorageStream(fps); setStorageFps(fps);
        startNetworkStream(fps); setNetworkFps(fps);
      } else {
        stopLogStream();
        stopStorageStream();
        stopNetworkStream();
      }
      if (data?.screenSync) {
        startRtdbSync(fps); setScreenFps(fps);
      } else {
        stopRtdbSync();
      }
    } catch {}
  });
}

export function cleanupSync(): void {
  rtdbActive = false;
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}/screen`);
  maybeStopRecording();
  stopLogStream();
  stopStorageStream();
  stopNetworkStream();
  if (syncSource) { syncSource.close(); syncSource = null; }
}
