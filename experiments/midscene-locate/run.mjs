import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { locate } from './locate.mjs';
import { loadPng, savePng, drawRect, drawDot } from './pngbox.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));

const ENDPOINT = process.env.ENDPOINT || 'https://callapi.top/v1';
const API_KEY = process.env.API_KEY || process.env.CALLAPI_KEY;
const MODEL = process.env.MODEL || 'gpt-5.6-terra';
const FAMILY = process.env.FAMILY || (/deepseek/i.test(MODEL) ? 'deepseek' : 'gpt');
const USE_JSON = process.env.USE_JSON !== '0';
if (!API_KEY) { console.error('set API_KEY (never hardcode it)'); process.exit(1); }

const ONLY = process.env.SCENE; // optional: run a single scene by name
let manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
if (ONLY) manifest = manifest.filter((s) => s.name === ONLY);
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
    locate({ endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, imageBase64: b64, width: scene.W, height: scene.H, description: test.desc, useJsonMode: USE_JSON, family: FAMILY }));

  // annotated overlay via pngbox (rsvg blanks large raster <image> on this box):
  // truth box green, predicted center dot (orange=hit, red=miss).
  const basePng = join(DIR, 'out', `${scene.name}_base.png`);
  let img = null;
  try { execFileSync('sips', ['-s', 'format', 'png', pngPath, '--out', basePng]); img = loadPng(basePng); } catch { /* sips/png optional */ }
  scene.tests.forEach((test, k) => {
    const r = results[k];
    total++;
    const ok = r.found && inside(r.center, test.truth);
    if (ok) pass++;
    let errPx = null;
    if (r.found) { const [tx, ty] = truthCenter(test.truth); errPx = Math.round(Math.hypot(r.center[0] - tx, r.center[1] - ty)); }
    rows.push({ scene: scene.name, desc: test.desc, ok, found: r.found, center: r.center, errPx, ms: r.ms, err: r.error });
    if (img) {
      drawRect(img, test.truth, [18, 184, 134], 3); // truth green
      if (r.found) {
        drawRect(img, r.bbox, [232, 89, 12], 2);   // predicted bbox orange
        drawDot(img, r.center[0], r.center[1], ok ? [232, 89, 12] : [224, 49, 49], 7);
      }
    }
  });
  if (img) savePng(img, join(DIR, 'out', `${scene.name}_annotated.png`));
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
