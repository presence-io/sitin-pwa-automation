// Minimal PNG read/draw/write using only node:zlib — draw rectangle outlines and
// filled dots directly on a PNG. Needed because this machine's librsvg won't
// composite large raster <image> and has no ImageMagick/PIL. Handles 8-bit
// RGB(colortype 2) and RGBA(6), non-interlaced (enough for screenshots/rsvg output).
import zlib from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';

const SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// CRC32 (PNG polynomial)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

function readChunks(buf) {
  if (!buf.subarray(0, 8).equals(SIG)) throw new Error('not a PNG');
  const chunks = []; let o = 8;
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len); chunks.push({ type, data }); o += 12 + len;
  }
  return chunks;
}
function paeth(a, b, c) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }

export function loadPng(path) {
  const chunks = readChunks(readFileSync(path));
  const ihdr = chunks.find((c) => c.type === 'IHDR').data;
  const W = ihdr.readUInt32BE(0), H = ihdr.readUInt32BE(4), depth = ihdr[8], color = ihdr[9], interlace = ihdr[12];
  if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) throw new Error(`unsupported PNG depth=${depth} color=${color} interlace=${interlace}`);
  const ch = color === 6 ? 4 : 3;
  const idat = zlib.inflateSync(Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)));
  const stride = W * ch;
  const raw = Buffer.alloc(H * stride); // unfiltered, ch channels
  let p = 0;
  for (let y = 0; y < H; y++) {
    const ft = idat[p++]; const row = raw.subarray(y * stride, y * stride + stride); const prev = y ? raw.subarray((y - 1) * stride, (y - 1) * stride + stride) : null;
    for (let x = 0; x < stride; x++) {
      const rawByte = idat[p++]; const a = x >= ch ? row[x - ch] : 0; const b = prev ? prev[x] : 0; const c = prev && x >= ch ? prev[x - ch] : 0;
      let v; switch (ft) { case 0: v = rawByte; break; case 1: v = rawByte + a; break; case 2: v = rawByte + b; break; case 3: v = rawByte + ((a + b) >> 1); break; case 4: v = rawByte + paeth(a, b, c); break; default: throw new Error(`filter ${ft}`); }
      row[x] = v & 0xff;
    }
  }
  return { W, H, ch, raw };
}

export function savePng({ W, H, ch, raw }, path) {
  const stride = W * ch; const withFilter = Buffer.alloc(H * (stride + 1));
  for (let y = 0; y < H; y++) { withFilter[y * (stride + 1)] = 0; raw.copy(withFilter, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const idat = zlib.deflateSync(withFilter, { level: 6 });
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = ch === 4 ? 6 : 2;
  const mk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0); const t = Buffer.from(type, 'ascii'); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0); return Buffer.concat([len, t, data, crc]); };
  writeFileSync(path, Buffer.concat([SIG, mk('IHDR', ihdr), mk('IDAT', idat), mk('IEND', Buffer.alloc(0))]));
}

function setPx(img, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= img.W || y >= img.H) return;
  const i = (y * img.W + x) * img.ch; img.raw[i] = r; img.raw[i + 1] = g; img.raw[i + 2] = b; if (img.ch === 4) img.raw[i + 3] = 255;
}
export function drawRect(img, [x1, y1, x2, y2], color, t = 3) {
  for (let k = 0; k < t; k++) {
    for (let x = x1; x <= x2; x++) { setPx(img, x, y1 + k, color); setPx(img, x, y2 - k, color); }
    for (let y = y1; y <= y2; y++) { setPx(img, x1 + k, y, color); setPx(img, x2 - k, y, color); }
  }
}
export function drawDot(img, x, y, color, r = 6) {
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) setPx(img, x + dx, y + dy, color);
}
