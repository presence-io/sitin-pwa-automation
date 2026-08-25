// Draw hand-annotated truth boxes over a scene using the pure-Node PNG drawer
// (pngbox), bypassing librsvg's broken large-<image> compositing. Each box gets a
// distinct palette colour; a legend colour->desc is printed to stdout so the
// rendered overlay can be eyeballed. Usage: node verify_truth.mjs [scene=realapp]
import { readFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPng, savePng, drawRect } from './pngbox.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const name = process.argv[2] || 'realapp';
mkdirSync(join(DIR, 'out'), { recursive: true });

const PALETTE = [
  ['red', [230, 30, 30]], ['orange', [232, 89, 12]], ['yellow', [200, 170, 0]],
  ['green', [30, 170, 60]], ['teal', [0, 160, 160]], ['blue', [40, 90, 230]],
  ['purple', [150, 40, 220]], ['magenta', [220, 40, 160]], ['brown', [140, 80, 20]],
  ['black', [10, 10, 10]], ['cyan', [0, 200, 220]], ['pink', [240, 110, 170]],
];

const scene = JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8')).find((s) => s.name === name);
if (!scene) { console.error(`scene ${name} not found`); process.exit(1); }

// scene.png may actually be a JPEG (Android screenshot with .png suffix); pngbox
// only reads real PNG, so normalise to a guaranteed-PNG copy via sips first.
const pngPath = join(DIR, 'out', `${name}_base.png`);
execFileSync('sips', ['-s', 'format', 'png', join(DIR, scene.png), '--out', pngPath]);
const img = loadPng(pngPath);
console.log(`base ${img.W}x${img.H} ch=${img.ch}, ${scene.tests.length} boxes\n`);
scene.tests.forEach((t, i) => {
  const [colorName, rgb] = PALETTE[i % PALETTE.length];
  drawRect(img, t.truth, rgb, 4);
  console.log(`${colorName.padEnd(8)} #${i + 1}  ${t.truth.join(',')}  ${t.desc}`);
});
savePng(img, join(DIR, 'out', `${name}_truth.png`));
console.log(`\n-> out/${name}_truth.png`);
