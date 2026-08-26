// Compress a string to a JSON-safe payload (and back) using the browser's native
// CompressionStream — no dependency. Big rrweb screen frames (500KB+ of very
// repetitive JSON) shrink ~8x, cutting both the agent's upload and the viewer's
// SSE transfer on slow mobile links, which is where the latency came from.
//
// RTDB stores JSON, so the gzip bytes are base64'd back into a string. A 1-char
// marker prefixes the payload so the decoder knows how to read it:
//   'g' + base64(gzip(str))   compressed
//   'r' + str                 raw (CompressionStream unavailable, e.g. old iOS)
//   anything else             legacy: a bare JSON string from an older agent
// The legacy case means a new viewer still renders frames from an un-upgraded
// agent (they arrive as `[...]`, no marker → returned as-is).

const GZ = 'g';
const RAW = 'r';

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let len = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); len += value.length;
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function u8ToBase64(u8: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000; // chunk to stay under the fromCharCode arg limit
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(s);
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

export async function packString(str: string): Promise<string> {
  const CS = (globalThis as any).CompressionStream;
  if (!CS) return RAW + str;
  try {
    const cs = new CS('gzip');
    const writer = cs.writable.getWriter();
    writer.write(new TextEncoder().encode(str));
    writer.close();
    return GZ + u8ToBase64(await drain(cs.readable));
  } catch {
    return RAW + str;
  }
}

export async function unpackString(payload: string): Promise<string> {
  if (!payload) return payload;
  const marker = payload[0];
  if (marker === RAW) return payload.slice(1);
  if (marker === GZ) {
    const DS = (globalThis as any).DecompressionStream;
    const ds = new DS('gzip');
    const writer = ds.writable.getWriter();
    writer.write(base64ToU8(payload.slice(1)));
    writer.close();
    return new TextDecoder().decode(await drain(ds.readable));
  }
  return payload; // legacy bare JSON string
}
