// Two-stage DeepSeek locate: search-area (coarse target + references) -> crop to that
// region and zoom -> precise point locate -> map back. Compared side by side with the
// single-stage V1 prompt on the same cases. Targets the "repeated small icon needing
// row disambiguation" failure (e.g. Bob's 3-dot menu).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { locate, searchArea, DEEPSEEK_OUTPUT_FORMAT } from './locate.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT || 'https://api.deepseek.com/v1';
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || 'deepseek-v4-flash-vision-exp';
if (!API_KEY) { console.error('set API_KEY'); process.exit(1); }
mkdirSync(join(DIR, 'out'), { recursive: true });

// V1 precision prompt (the single-stage winner) for the point stages
const V1 = `## Role:
You are a GUI click grounding agent.

## Objective:
- Identify the UI element that matches the description and return its EXACT geometric center.

## Precision:
- The target is ONLY the described element itself. For a small control (icon, checkbox, radio, arrow, 3-dot menu), return the precise center of that small glyph, not the surrounding text, label, or row.
- For a text or link target, return the center of the tight visible text region.
- Aim for the true center: your point should sit in the middle of the target, not on its edge.

${DEEPSEEK_OUTPUT_FORMAT}`;

const inside = (c, [x1, y1, x2, y2]) => c && c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2;
const tc = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];
const err = (c, box) => { const [tx, ty] = tc(box); return Math.round(Math.hypot(c[0] - tx, c[1] - ty)); };

// render a zoomed crop of the full PNG via an SVG viewBox (rsvg-convert; no ImageMagick needed)
function cropZoom(fullB64, W, H, [cx1, cy1, cx2, cy2], name) {
  const cw = cx2 - cx1 + 1, ch = cy2 - cy1 + 1;
  const Z = Math.min(4, 768 / Math.max(cw, ch));
  const outW = Math.max(1, Math.round(cw * Z)), outH = Math.max(1, Math.round(ch * Z));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${outW}" height="${outH}" viewBox="${cx1} ${cy1} ${cw} ${ch}"><image xlink:href="data:image/png;base64,${fullB64}" x="0" y="0" width="${W}" height="${H}"/></svg>`;
  const svgPath = join(DIR, 'out', `crop_${name}.svg`), pngPath = join(DIR, 'out', `crop_${name}.png`);
  writeFileSync(svgPath, svg);
  execFileSync('rsvg-convert', [svgPath, '-o', pngPath]);
  return { b64: readFileSync(pngPath).toString('base64'), outW, outH, sx: outW / cw, sy: outH / ch, cx1, cy1 };
}

// union of boxes + margin, clamped
function unionBox(boxes, W, H, margin = 14) {
  const x1 = Math.min(...boxes.map((b) => b[0])), y1 = Math.min(...boxes.map((b) => b[1]));
  const x2 = Math.max(...boxes.map((b) => b[2])), y2 = Math.max(...boxes.map((b) => b[3]));
  return [Math.max(0, x1 - margin), Math.max(0, y1 - margin), Math.min(W - 1, x2 + margin), Math.min(H - 1, y2 + margin)];
}

async function twoStage(scene, test, b64) {
  const base = { endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, family: 'deepseek', width: scene.W, height: scene.H, description: test.desc };
  const sa = await searchArea({ ...base, imageBase64: b64 });
  if (!sa.found) { // fall back to single-stage on failure
    const p = await locate({ ...base, imageBase64: b64, systemPrompt: V1 });
    return { stage: 'fallback', center: p.center, found: p.found, ms: sa.ms + (p.ms || 0), err: sa.error || p.error };
  }
  const crop = cropZoom(b64, scene.W, scene.H, unionBox([sa.target, ...sa.references], scene.W, scene.H), `${scene.name}_${test.desc.slice(0, 4)}`);
  const p = await locate({ endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, family: 'deepseek', imageBase64: crop.b64, width: crop.outW, height: crop.outH, description: test.desc, systemPrompt: V1 });
  if (!p.found) return { stage: '2', center: null, found: false, ms: sa.ms + (p.ms || 0), err: p.error };
  const center = [Math.round(crop.cx1 + p.center[0] / crop.sx), Math.round(crop.cy1 + p.center[1] / crop.sy)];
  return { stage: '2', center, found: true, ms: sa.ms + p.ms, target: sa.target, nRef: sa.references.length };
}

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
let s1p = 0, s2p = 0, tot = 0;
console.log(`model=${MODEL}\n`);
console.log('scene    | 1-stage        | 2-stage        | target');
console.log('         | ok  err  ms    | ok  err  ms  R | ');
for (const scene of manifest) {
  const b64 = readFileSync(join(DIR, scene.png)).toString('base64');
  for (const test of scene.tests) {
    tot++;
    const single = await locate({ endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, family: 'deepseek', imageBase64: b64, width: scene.W, height: scene.H, description: test.desc, systemPrompt: V1 });
    const two = await twoStage(scene, test, b64);
    const ok1 = single.found && inside(single.center, test.truth); if (ok1) s1p++;
    const ok2 = two.found && inside(two.center, test.truth); if (ok2) s2p++;
    const e1 = single.found ? err(single.center, test.truth) : '-';
    const e2 = two.found ? err(two.center, test.truth) : '-';
    console.log(`${scene.name.padEnd(8)} | ${ok1 ? 'Y' : (single.found ? 'x' : '-')}  ${String(e1).padStart(4)} ${String(single.ms).padStart(5)} | ${ok2 ? 'Y' : (two.found ? 'x' : '-')}  ${String(e2).padStart(4)} ${String(two.ms).padStart(5)} ${String(two.nRef ?? '-').padStart(1)} | ${test.desc}`);
  }
}
console.log(`\n1-stage HIT ${s1p}/${tot} = ${Math.round(s1p / tot * 100)}%   |   2-stage HIT ${s2p}/${tot} = ${Math.round(s2p / tot * 100)}%`);
