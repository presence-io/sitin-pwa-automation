import { log, warn } from '../core/helpers';
import { loadRrweb } from '../shared/rrweb-loader';
import { fbPut, fbGet, fbDelete, fbListen, type FbSub } from '../shared/firebase';
import { getDeviceId } from './remote';
import { startLogStream, stopLogStream } from './logsync';
import { startStorageStream, stopStorageStream } from './storagesync';
import { startNetworkStream, stopNetworkStream } from './networksync';

let stopRecordFn: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: FbSub | null = null;
let starting = false;

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

    const interval = Math.max(500, Math.round(1000 / fps));
    flushTimer = setInterval(flush, interval);
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
  // the 32-level depth / forbidden-key limits that 400 the write). A single
  // last-write-wins key can't carry deltas, so it stays full each flush.
  const deviceId = getDeviceId();
  await fbPut(`mon/${deviceId}/screen`, {
    kind: 'rrweb',
    bufferId,
    events: JSON.stringify(buffer),
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
  fbDelete(`mon/${deviceId}/screen`);
  maybeStopRecording();
}

// ── Public API ──

export function listenSyncControl(): void {
  const deviceId = getDeviceId();
  if (syncSource) syncSource.close();

  syncSource = fbListen(`syncControl/${deviceId}`, async (pushed) => {
    try {
      const data = pushed !== undefined ? pushed : await fbGet<any>(`syncControl/${deviceId}`);
      // Logs + storage + network stream whenever a viewer is attached (screen
      // sync or logs alone).
      if (data?.screenSync || data?.logSync) {
        startLogStream(data.fps || 1);
        startStorageStream(data.fps || 1);
        startNetworkStream(data.fps || 1);
      } else {
        stopLogStream();
        stopStorageStream();
        stopNetworkStream();
      }
      if (data?.screenSync) {
        startRtdbSync(data.fps || 1);
      } else {
        stopRtdbSync();
      }
    } catch {}
  });
}

export function cleanupSync(): void {
  rtdbActive = false;
  const deviceId = getDeviceId();
  fbDelete(`mon/${deviceId}/screen`);
  maybeStopRecording();
  stopLogStream();
  stopStorageStream();
  stopNetworkStream();
  if (syncSource) { syncSource.close(); syncSource = null; }
}
