// WebRTC peer transport for screen sync. The heavy screen payload (rrweb event
// windows) flows peer-to-peer over a DataChannel; only the tiny SDP handshake
// goes through Firebase RTDB. Non-trickle ICE is used (all candidates are baked
// into the SDP once gathering finishes), so signaling is just two small writes
// — no separate ICE-candidate exchange.

// Metered.ca TURN account. Credentials are fetched fresh at runtime from the
// REST API (they rotate), so we keep a static snapshot only as an offline
// fallback. TURN relay is required when the two peers are on different networks
// and at least one sits behind a symmetric NAT (mobile carriers / corporate
// Wi-Fi), where pure STUN hole-punching fails.
const METERED_CREDS_URL =
  'https://cjkun.metered.live/api/v1/turn/credentials?apiKey=2702de8e9c9ec3f56dfe56ca068bb711ed5b';

const STUN_SERVERS: RTCIceServer = {
  urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
};

// Static fallback used if the credential fetch fails (e.g. offline at startup).
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    STUN_SERVERS,
    {
      urls: [
        'turn:global.relay.metered.ca:80',
        'turn:global.relay.metered.ca:80?transport=tcp',
        'turn:global.relay.metered.ca:443',
        'turns:global.relay.metered.ca:443?transport=tcp',
      ],
      username: '60c4b4e1553eb47e4bdfc6f5',
      credential: 'QAURAFrU2xuVcqCD',
    },
  ],
};

let cachedConfig: RTCConfiguration | null = null;

// Fetch fresh TURN credentials from Metered. Cached for the session; falls back
// to the static RTC_CONFIG on any failure so a network hiccup never blocks the
// handshake.
export async function getRtcConfig(): Promise<RTCConfiguration> {
  if (cachedConfig) return cachedConfig;
  try {
    const res = await fetch(METERED_CREDS_URL);
    if (!res.ok) throw new Error(`metered ${res.status}`);
    const iceServers = (await res.json()) as RTCIceServer[];
    if (!Array.isArray(iceServers) || iceServers.length === 0) throw new Error('empty');
    cachedConfig = { iceServers: [STUN_SERVERS, ...iceServers] };
  } catch {
    cachedConfig = RTC_CONFIG;
  }
  return cachedConfig;
}

// Resolve once ICE gathering completes (or after a timeout) so localDescription
// already carries every candidate — lets us skip trickle-ICE signaling.
export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => { if (pc.iceGatheringState === 'complete') finish(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(finish, timeoutMs);
  });
}

// DataChannel reliable single-message size varies by browser; chunk big payloads.
const CHUNK_SIZE = 48 * 1024;

export function sendChunked(ch: RTCDataChannel, kind: string, payload: string): void {
  const id = Math.random().toString(36).slice(2);
  const n = Math.max(1, Math.ceil(payload.length / CHUNK_SIZE));
  for (let i = 0; i < n; i++) {
    ch.send(JSON.stringify({
      t: 'chunk', kind, id, i, n,
      data: payload.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
    }));
  }
}

// Reassembles chunked messages; returns the full payload when a message completes.
export class Reassembler {
  private parts = new Map<string, { n: number; got: number; buf: string[] }>();

  push(msg: any): { kind: string; payload: string } | null {
    if (!msg || msg.t !== 'chunk') return null;
    let rec = this.parts.get(msg.id);
    if (!rec) { rec = { n: msg.n, got: 0, buf: new Array(msg.n) }; this.parts.set(msg.id, rec); }
    if (rec.buf[msg.i] === undefined) { rec.buf[msg.i] = msg.data; rec.got++; }
    if (rec.got >= rec.n) { this.parts.delete(msg.id); return { kind: msg.kind, payload: rec.buf.join('') }; }
    return null;
  }
}
