import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { locate } from './locate.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = process.env.ENDPOINT || 'https://callapi.top/v1';
const API_KEY = process.env.API_KEY || process.env.CALLAPI_KEY;
const MODEL = process.env.MODEL || 'gpt-5.6-terra';
const USE_JSON = process.env.USE_JSON !== '0';
if (!API_KEY) { console.error('set API_KEY (never hardcode it)'); process.exit(1); }

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
mkdirSync(join(DIR, 'out'), { recursive: true });

const inside = (c, [x1, y1, x2, y2]) => c && c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2;
const truthCenter = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];

// small concurrency limiter
async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

const rows = [];
let pass = 0, total = 0;

for (const scene of manifest) {
  const pngPath = join(DIR, scene.png);
  const b64 = readFileSync(pngPath).toString('base64');
  const results = await mapLimit(scene.tests, 4, (test) =>
    locate({ endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, imageBase64: b64, width: scene.W, height: scene.H, description: test.desc, useJsonMode: USE_JSON }));

  const overlays = [];
  scene.tests.forEach((test, k) => {
    const r = results[k];
    total++;
    const ok = r.found && inside(r.center, test.truth);
    if (ok) pass++;
    let errPx = null;
    if (r.found) { const [tx, ty] = truthCenter(test.truth); errPx = Math.round(Math.hypot(r.center[0] - tx, r.center[1] - ty)); }
    rows.push({ scene: scene.name, desc: test.desc, ok, found: r.found, center: r.center, errPx, ms: r.ms, err: r.error });
    // overlays: truth (green), predicted bbox (red dashed) + center dot
    const [a, bb, c, d] = test.truth;
    overlays.push(`<rect x='${a}' y='${bb}' width='${c - a}' height='${d - bb}' fill='none' stroke='#12b886' stroke-width='2'/>`);
    if (r.found) {
      const [l, t, rr, bo] = r.bbox;
      overlays.push(`<rect x='${l}' y='${t}' width='${rr - l}' height='${bo - t}' fill='none' stroke='#e8590c' stroke-width='2' stroke-dasharray='5 3'/>`);
      overlays.push(`<circle cx='${r.center[0]}' cy='${r.center[1]}' r='6' fill='${ok ? '#e8590c' : '#e03131'}'/>`);
    }
    overlays.push(`<text x='6' y='${scene.H - 6 - k * 16}' font-size='12' font-family='sans-serif' fill='${ok ? '#12b886' : '#e03131'}'>${ok ? 'PASS' : 'FAIL'} ${test.desc.slice(0, 14)}</text>`);
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${scene.W}" height="${scene.H}">
    <image xlink:href="data:image/png;base64,${b64}" x="0" y="0" width="${scene.W}" height="${scene.H}"/>
    ${overlays.join('\n')}
  </svg>`;
  const svgPath = join(DIR, 'out', `${scene.name}_annotated.svg`);
  writeFileSync(svgPath, svg);
  try { execFileSync('rsvg-convert', [svgPath, '-o', join(DIR, 'out', `${scene.name}_annotated.png`)]); } catch { /* rsvg-convert optional */ }
}

// report
console.log(`\n===== ${MODEL} =====`);
console.log('scene    | ok  | errPx | ms   | target');
for (const r of rows) {
  console.log(`${r.scene.padEnd(8)} | ${r.ok ? 'Y ' : (r.found ? 'x ' : '- ')} | ${String(r.errPx ?? '-').padStart(5)} | ${String(r.ms).padStart(4)} | ${r.desc}${r.found ? '' : '  <' + r.err + '>'}`);
}
const lat = rows.map(r => r.ms).sort((a, b) => a - b);
console.log(`\nHIT ${pass}/${total} = ${Math.round(pass / total * 100)}%  | latency p50=${lat[Math.floor(lat.length / 2)]}ms max=${lat[lat.length - 1]}ms`);
writeFileSync(join(DIR, 'out', 'results.json'), JSON.stringify(rows, null, 2));
