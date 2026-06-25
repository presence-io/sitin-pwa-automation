import { log, warn } from '../core/helpers';
import { loadRrweb } from '../shared/rrweb-loader';
import { fbPut, fbGet, fbDelete, fbListen } from '../shared/firebase';
import { RTC_CONFIG, waitIceComplete, sendChunked } from '../shared/webrtc';
import { getDeviceId } from './remote';
import { startLogStream, stopLogStream } from './logsync';

let stopRecordFn: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: EventSource | null = null;
let rtcSource: EventSource | null = null;
let starting = false;

// A connected viewer DataChannel. When present, screen frames go peer-to-peer
// over it; otherwise they fall back to Firebase RTDB.
let rtcPc: RTCPeerConnection | null = null;
let rtcChannel: RTCDataChannel | null = null;
let handledSession = '';

// Whether RTDB-based sync was requested (viewer fallback path / older dashboard).
let rtdbActive = false;

// Rolling buffer holds events since the last full snapshot (checkout), so a
// viewer joining at any time can rebuild the page from a self-contained window.
let buffer: any[] = [];
let bufferId = 0;
let dirty = false;

const SELF_UI = '#autobot-fab, #autobot-panel, #autobot-minibar, #autobot-text-picker, #autobot-assert-popup';

// Start rrweb recording if not already running. Recording is shared between the
// WebRTC and RTDB sinks — whichever is active drives the flush.
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
      blockSelector: SELF_UI,
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

// Stop recording only when no sink (WebRTC peer or RTDB) needs it anymore.
function maybeStopRecording(): void {
  if (rtcChannel || rtdbActive) return;
  if (stopRecordFn) { stopRecordFn(); stopRecordFn = null; }
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  buffer = [];
  dirty = false;
  log('Screen sync stopped');
}

function buildFrame(): string {
  return JSON.stringify({
    bufferId,
    events: buffer,
    url: location.pathname + location.search,
    title: document.title,
    width: window.innerWidth,
    height: window.innerHeight,
    timestamp: Date.now(),
  });
}

async function flush(): Promise<void> {
  if (!dirty || buffer.length === 0) return;
  dirty = false;
  const frame = buildFrame();

  // Prefer the peer-to-peer channel: heavy data never touches the database.
  if (rtcChannel && rtcChannel.readyState === 'open') {
    try { sendChunked(rtcChannel, 'window', frame); } catch (e) { warn('rtc send failed', e); }
    return;
  }

  // Fallback: write to RTDB (events serialized as a string to dodge the
  // 32-level depth / forbidden-key limits that otherwise 400 the write).
  if (rtdbActive) {
    const deviceId = getDeviceId();
    await fbPut(`screens/${deviceId}`, {
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
}

// ── RTDB fallback sync (driven by syncControl) ──

function startRtdbSync(fps = 1): void {
  rtdbActive = true;
  startRecording(fps);
}

function stopRtdbSync(): void {
  rtdbActive = false;
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}`);
  maybeStopRecording();
}

// ── WebRTC peer path (driven by an offer the viewer writes to rtc/{id}/offer) ──

function closeRtc(): void {
  if (rtcChannel) { try { rtcChannel.close(); } catch {} rtcChannel = null; }
  if (rtcPc) { try { rtcPc.close(); } catch {} rtcPc = null; }
  maybeStopRecording();
}

async function answerOffer(offer: any): Promise<void> {
  closeRtc(); // drop any previous peer before starting a new handshake
  const deviceId = getDeviceId();
  const pc = new RTCPeerConnection(RTC_CONFIG);
  rtcPc = pc;

  pc.ondatachannel = (ev) => {
    const ch = ev.channel;
    ch.onopen = () => {
      rtcChannel = ch;
      // Peer is up: heavy frames go P2P. Stop writing to the DB and clear any
      // stale screens/ node so the viewer never falls back to old data.
      rtdbActive = false;
      fbDelete(`screens/${deviceId}`);
      startRecording(1).then(() => { dirty = true; flush(); });
      log('Screen sync: WebRTC peer connected');
    };
    ch.onclose = () => {
      if (rtcChannel === ch) rtcChannel = null;
      maybeStopRecording();
    };
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
      if (rtcPc === pc) closeRtc();
    }
  };

  try {
    await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);
    await fbPut(`rtc/${deviceId}/answer`, {
      sdp: pc.localDescription!.sdp,
      type: 'answer',
      session: offer.session,
    });
  } catch (e) {
    warn('Screen sync: WebRTC answer failed', e);
    closeRtc();
  }
}

function listenRtcOffers(): void {
  const deviceId = getDeviceId();
  if (rtcSource) rtcSource.close();
  rtcSource = fbListen(`rtc/${deviceId}/offer`, async () => {
    const offer = await fbGet<any>(`rtc/${deviceId}/offer`);
    if (!offer || !offer.sdp || !offer.session) return;
    if (offer.session === handledSession) return; // already handled this attempt
    handledSession = offer.session;
    await answerOffer(offer);
  });
}

// ── Public API ──

export function listenSyncControl(): void {
  const deviceId = getDeviceId();
  if (syncSource) syncSource.close();

  // Always listen for WebRTC offers so a viewer can connect peer-to-peer.
  listenRtcOffers();

  syncSource = fbListen(`syncControl/${deviceId}`, async () => {
    try {
      const data = await fbGet<any>(`syncControl/${deviceId}`);
      // Logs stream whenever a viewer is attached (screen sync or logs alone).
      if (data?.screenSync || data?.logSync) {
        startLogStream(data.fps || 1);
      } else {
        stopLogStream();
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
  closeRtc();
  const deviceId = getDeviceId();
  fbDelete(`screens/${deviceId}`);
  maybeStopRecording();
  stopLogStream();
  if (syncSource) { syncSource.close(); syncSource = null; }
  if (rtcSource) { rtcSource.close(); rtcSource = null; }
}
