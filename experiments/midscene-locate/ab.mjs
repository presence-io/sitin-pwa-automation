// A/B DeepSeek locate prompts against the fixture. Keeps the native token
// output-format tail constant; only varies the guidance head.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { locate, DEEPSEEK_INTRO, DEEPSEEK_OUTPUT_FORMAT } from './locate.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const ENDPOINT = process.env.ENDPOINT || 'https://api.deepseek.com/v1';
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || 'deepseek-v4-flash-vision-exp';
const ROUNDS = Number(process.env.ROUNDS || 2);
if (!API_KEY) { console.error('set API_KEY'); process.exit(1); }

const tail = '\n\n' + DEEPSEEK_OUTPUT_FORMAT;
const VARIANTS = {
  V0_base: DEEPSEEK_INTRO + tail,

  V1_precision: `## Role:
You are a GUI click grounding agent.

## Objective:
- Identify the UI element that matches the description and return its EXACT geometric center.

## Precision:
- The target is ONLY the described element itself. For a small control (icon, checkbox, radio, arrow, 3-dot menu), return the precise center of that small glyph, not the surrounding text, label, or row.
- For a text or link target, return the center of the tight visible text region.
- Aim for the true center: your point should sit in the middle of the target, not on its edge.` + tail,

  V2_rules: `## Role:
You are a GUI click grounding agent.

## Objective:
- Identify the UI element that matches the description and return its center point.

## Rules:
- First identify the target primitive; treat labels, owners, rows, and nearby text as context unless they ARE the target.
- For "X in the row whose value is Y", the target is X; use Y only to find the correct row, then return X's center.
- For an icon among several similar icons, use the described position or relative order and return only that one glyph's center.` + tail,

  V3_combined: `## Role:
You are a GUI click grounding agent.

## Objective:
- Identify the UI element that matches the description and return its EXACT geometric center.

## Rules:
- First identify the target primitive; treat labels, owners, rows, and nearby text as context unless they ARE the target.
- For "X in the row whose value is Y", the target is X; use Y only to find the correct row, then return X's center.
- For an icon among several similar icons, use the described position or relative order and return only that glyph's center.

## Precision:
- For a small control (icon, checkbox, radio, arrow, 3-dot menu), return the precise center of that small glyph only, not the surrounding text or row.
- For a text or link target, return the center of the tight visible text region.
- Your point must sit in the middle of the target, not on its edge.` + tail,
};

const manifest = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'));
const cases = [];
for (const scene of manifest) {
  const b64 = readFileSync(join(DIR, scene.png)).toString('base64');
  for (const t of scene.tests) cases.push({ scene: scene.name, W: scene.W, H: scene.H, b64, desc: t.desc, truth: t.truth });
}
const inside = (c, [x1, y1, x2, y2]) => c && c[0] >= x1 && c[0] <= x2 && c[1] >= y1 && c[1] <= y2;
const tc = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];

async function mapLimit(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}

console.log(`model=${MODEL}  rounds=${ROUNDS}  cases=${cases.length}\n`);
const summary = [];
for (const [name, sys] of Object.entries(VARIANTS)) {
  let pass = 0, tot = 0, errSum = 0, errN = 0, ms = 0;
  const perCase = new Map(); // desc -> pass count
  for (let r = 0; r < ROUNDS; r++) {
    const res = await mapLimit(cases, 4, (c) =>
      locate({ endpoint: ENDPOINT, apiKey: API_KEY, model: MODEL, family: 'deepseek', imageBase64: c.b64, width: c.W, height: c.H, description: c.desc, systemPrompt: sys }));
    res.forEach((rr, k) => {
      const c = cases[k]; tot++; ms += rr.ms || 0;
      const ok = rr.found && inside(rr.center, c.truth);
      if (ok) pass++;
      if (rr.found) { const [tx, ty] = tc(c.truth); errSum += Math.hypot(rr.center[0] - tx, rr.center[1] - ty); errN++; }
      perCase.set(c.desc, (perCase.get(c.desc) || 0) + (ok ? 1 : 0));
    });
  }
  const pct = Math.round(pass / tot * 100);
  summary.push({ name, pct, pass, tot, meanErr: errN ? Math.round(errSum / errN) : null, avgMs: Math.round(ms / tot) });
  console.log(`${name.padEnd(14)} HIT ${pass}/${tot} = ${pct}%  meanErr=${errN ? Math.round(errSum / errN) : '-'}px  avgMs=${Math.round(ms / tot)}`);
  // show cases that never passed under this variant
  const weak = [...perCase.entries()].filter(([, v]) => v === 0).map(([d]) => d.slice(0, 16));
  if (weak.length) console.log(`   never-hit: ${weak.join(' | ')}`);
}
console.log('\n=== ranking ===');
summary.sort((a, b) => b.pct - a.pct || a.meanErr - b.meanErr);
for (const s of summary) console.log(`${s.name.padEnd(14)} ${s.pct}%  meanErr=${s.meanErr}px`);
