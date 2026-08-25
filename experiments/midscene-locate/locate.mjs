// Minimal "locate" core — ported from Midscene.js (gpt-family pixel-bbox branch).
// Faithful ports (see /tmp/midscene-src):
//   - prompt/locate-grounding-rules.ts        -> GROUNDING_RULES (verbatim)
//   - model-adapter/default-locate-protocol.ts-> system intro + response instructions
//   - shared/model-locate-result/prompt-spec.ts, bbox.ts, pixel-bbox-mapper.ts -> coord transform
//   - models/gpt.ts                           -> gpt-5 family = {shape:'bbox', order:'xy', pixels}
// No @midscene/core dependency. ~120 lines.

const SYSTEM_INTRO = `## Role:
You are an AI assistant that helps identify UI elements.

## Objective:
- Identify elements in screenshots that match the user's description.
- Provide the coordinates of the element that matches the user's description.`;

// verbatim from locate-grounding-rules.ts
const GROUNDING_RULES = `## Important Notes for Locating Elements:
- First identify the target primitive from the user's description, then locate that primitive only. Treat labels, owners, rows, columns, and surrounding text as context unless the description says they are the target.
- If the target itself is visible text, link text, status text, table cell text, or header text, return only the tight visible text region, not the entire control, row, sentence, or container.
- If a text or link target wraps across multiple lines, do not return one large box covering the whole wrapped text. Return a tight box around a distinctive visible segment of the target text; for CJK link labels, the first 2-4 visible characters are enough when unique.
- If the target is an input/select/filter field body, current value area, or blank field region, return that field/control body or value region. Do not retarget to a trailing search icon, dropdown arrow, clear button, or nearby table header.
- If the target is an icon, arrow, checkbox, radio, or accessory control, return only that glyph/control region. Do not return adjacent owner text.
- If the target is a tiny icon/control among adjacent similar icons, use the described local order or relative position within that group and return only that glyph/control.
- If the same text appears in multiple regions, obey the described owner region first, such as filter bar vs table header.`;

// buildResponseInstructions() for gpt-5 family: bbox, xy, actual pixels, resultKey 'bbox'
const RESPONSE_INSTRUCTIONS = `## Output Format:
\`\`\`json
{
  "bbox": [number, number, number, number],  // 2d bounding box, should be [xmin, ymin, xmax, ymax] in actual pixel coordinates relative to the screenshot.
  "error": string // optional
}
\`\`\`

Fields:
* \`bbox\` is the bounding box of the element that matches the user's description
* \`error\` is an optional error message (if any)

For example, when an element is found:
\`\`\`json
{
  "bbox": [100, 100, 200, 200]
}
\`\`\`

When no element is found:
\`\`\`json
{
  "bbox": [],
  "error": "I can see ..., but {some element} is not found. Use Chinese."
}
\`\`\``;

const SYSTEM_PROMPT = `${SYSTEM_INTRO}\n\n${GROUNDING_RULES}\n\n${RESPONSE_INSTRUCTIONS}`;

// ---- DeepSeek family (ported: models/deepseek.ts + deepseek-locate-protocol.ts) ----
// DeepSeek is NOT JSON/pixels. It speaks native grounding tokens and returns a
// single center POINT normalized to 0-1000. Midscene maps that back to pixels.
// output-format tail = DeepSeek's native token spec; KEEP CONSTANT (model was RL-tuned on it)
const DEEPSEEK_OUTPUT_FORMAT = `## Output Format:
Return exactly one point using the following format, without any explanation or additional text:

<｜｜point｜｜>[[number, number]]<｜｜/point｜｜>

For example:
<｜｜point｜｜>[[150, 150]]<｜｜/point｜｜>

Coordinate values must be integers.
Coordinate requirements: point, should be [x, y] normalized to 0-1000 relative to the screenshot.
The origin is the top-left of the full screenshot.`;

// default guidance head (Midscene's minimal DeepSeek intro)
const DEEPSEEK_INTRO = `## Role:
You are a GUI click grounding agent.

## Objective:
- Identify the UI element in the screenshot that matches the user's description.
- Return the center point of that element.`;

const DEEPSEEK_SYSTEM_PROMPT = `${DEEPSEEK_INTRO}\n\n${DEEPSEEK_OUTPUT_FORMAT}`;

const DEEPSEEK_POINT = /<(?:｜｜|\|)point(?:｜｜|\|)>\s*([\s\S]*?)\s*<(?:｜｜|\|)\/point(?:｜｜|\|)>/;

// pull the two normalized integers out of a <｜｜point｜｜>[[x,y]]<｜｜/point｜｜> token.
// Only trust text that actually carries the token — never scrape stray digits from
// prose/reasoning (that turns an honest "no answer" into a confident wrong point).
function parseDeepSeekPoint(...texts) {
  for (const t of texts) {
    const m = t && t.match(DEEPSEEK_POINT);
    if (!m) continue;
    const nums = String(m[1]).match(/-?\d+/g);
    if (nums && nums.length >= 2) return [Number(nums[0]), Number(nums[1])];
  }
  throw new Error(`no point token in: ${(texts.find(Boolean) || '').slice(0, 160)}`);
}

// ---- coordinate transform (ported: bbox.ts / pixel-bbox-mapper.ts, pixel branch) ----
const maxPixelIndex = (s) => Math.max(s - 1, 0);
const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
const DEFAULT_BBOX_SIZE = 20; // expandPointToBbox half = 10

function expandPointToBbox(x, y, maxX, maxY, half) {
  return [Math.max(0, x - half), Math.max(0, y - half), Math.min(maxX, x + half), Math.min(maxY, y + half)];
}

// raw model value (bbox[4] or point[2], xy, pixels) -> finalized pixel bbox + center
function toPixelBbox(raw, width, height) {
  if (!Array.isArray(raw) || (raw.length !== 4 && raw.length !== 2)) {
    throw new Error(`invalid locate value: ${JSON.stringify(raw)}`);
  }
  let bbox = raw.length === 4
    ? raw.slice()
    : expandPointToBbox(raw[0], raw[1], maxPixelIndex(width), maxPixelIndex(height), DEFAULT_BBOX_SIZE / 2);
  if (!bbox.every((n) => typeof n === 'number' && Number.isFinite(n))) {
    throw new Error(`non-finite bbox: ${JSON.stringify(raw)}`);
  }
  let [l, t, r, b] = bbox;
  if (r < l || b < t) throw new Error(`bad bbox order: ${JSON.stringify(bbox)}`);
  const rl = maxPixelIndex(width), bl = maxPixelIndex(height);
  l = clamp(l, 0, rl); t = clamp(t, 0, bl); r = clamp(r, 0, rl); b = clamp(b, 0, bl);
  const center = [Math.round((l + r) / 2), Math.round((t + b) / 2)];
  return { bbox: [l, t, r, b], center };
}

// tolerant JSON extraction (model may wrap in prose/code fence)
function parseJsonLoose(content) {
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence ? fence[1] : content;
  try { return JSON.parse(body); } catch {}
  const s = body.indexOf('{'), e = body.lastIndexOf('}');
  if (s >= 0 && e > s) return JSON.parse(body.slice(s, e + 1));
  throw new Error(`no JSON in response: ${content.slice(0, 200)}`);
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function locate({ endpoint, apiKey, model, imageBase64, width, height, description, useJsonMode = true, family = 'gpt', systemPrompt = null, userPrompt = null }) {
  const isDeepSeek = family === 'deepseek';
  const jsonMode = isDeepSeek ? false : useJsonMode; // DeepSeek uses native tokens, not JSON
  const sys = systemPrompt ?? (isDeepSeek ? DEEPSEEK_SYSTEM_PROMPT : SYSTEM_PROMPT);
  const usr = userPrompt ?? (isDeepSeek ? `Locate the center point of the following UI element: ${description}` : `Find: ${description}`);
  const body = {
    model,
    temperature: 0,
    max_tokens: isDeepSeek ? 1024 : 300, // DeepSeek reasons before emitting the point token; 300 truncates it
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: usr },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
      ] },
    ],
  };
  const t0 = Date.now();
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { found: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`, ms };
  const j = await res.json();
  const msg = j?.choices?.[0]?.message ?? {};
  const content = msg.content ?? '';
  // DeepSeek branch: parse native point token -> normalized 0-1000 -> pixels.
  // Token may land in content or (Midscene: useReasoningAsContentFallback) reasoning_content.
  if (isDeepSeek) {
    let nx, ny;
    try { [nx, ny] = parseDeepSeekPoint(content, msg.reasoning_content); }
    catch (e) { return { found: false, error: `parse: ${e.message}`, raw: content, ms }; }
    // clamp the point into range first: DeepSeek occasionally returns a normalized value >1000
    const px = clamp(Math.round((nx / 1000) * maxPixelIndex(width)), 0, maxPixelIndex(width));
    const py = clamp(Math.round((ny / 1000) * maxPixelIndex(height)), 0, maxPixelIndex(height));
    try {
      const { bbox, center } = toPixelBbox([px, py], width, height); // point -> bbox via expandPointToBbox
      return { found: true, bbox, center, raw: content, ms };
    } catch (e) {
      return { found: false, error: `transform: ${e.message}`, raw: content, ms };
    }
  }
  let parsed;
  try { parsed = parseJsonLoose(content); } catch (e) { return { found: false, error: `parse: ${e.message}`, raw: content, ms }; }
  const val = parsed.bbox ?? parsed.point ?? parsed.bbox_2d;
  const hasTarget = Array.isArray(val) ? val.length > 0 : val !== undefined;
  if (!hasTarget) return { found: false, error: parsed.error || 'not-found', raw: content, ms };
  try {
    const { bbox, center } = toPixelBbox(val, width, height);
    return { found: true, bbox, center, raw: content, ms };
  } catch (e) {
    return { found: false, error: `transform: ${e.message}`, raw: content, ms };
  }
}

// ---- DeepSeek search-area (stage 1 of two-stage): target bbox + reference bboxes ----
// Ported from Midscene deepseek-locate-protocol.ts (searchArea). Used to disambiguate
// "X in the row whose value is Y": the model returns the target's coarse box plus the
// reference (Y) box, so we can crop to the right region before a precise point locate.
const DEEPSEEK_SEARCHAREA_SYSTEM = `## Objective:
- Identify the target UI element in the screenshot.
- Identify the reference elements that the description uses to select the target, such as an owner label, row value, column value, nearby text, or relative-position anchor.
- Return a tight bounding box for the target first, followed by a tight bounding box for each reference element.

## Reference Rules:
- If the description explicitly identifies the target through another visible element, you MUST return that visible element as a reference, even if the target appears unique.
- For descriptions like "B in the row whose A is X", B is the target and the visible X is a reference.
- For descriptions like "the icon next to label X", the icon is the target and the visible X is a reference.
- Do not return unrelated landmarks or alternative target candidates.

## Output Format:
Return one or more ref-box pairs using the following format, without any explanation or additional text:

<｜｜ref｜｜>target: concise target description<｜｜/ref｜｜><｜｜box｜｜>[[x1,y1,x2,y2]]<｜｜/box｜｜>
<｜｜ref｜｜>reference: concise reference description<｜｜/ref｜｜><｜｜box｜｜>[[x1,y1,x2,y2]]<｜｜/box｜｜>

The first ref-box pair must represent the target element. Every remaining pair must represent a reference element needed to identify the target. If no reference element is needed, return only the target pair. Each pair must contain exactly one bbox.
Coordinate values must be integers.
Coordinate requirements: bbox, should be [x1,y1,x2,y2] normalized to 0-1000 relative to the screenshot.
The origin is the top-left of the full screenshot.`;

const DEEPSEEK_REFBOX = /<(?:｜｜|\|)ref(?:｜｜|\|)>\s*[\s\S]*?<(?:｜｜|\|)\/ref(?:｜｜|\|)>\s*<(?:｜｜|\|)box(?:｜｜|\|)>\s*([\s\S]*?)\s*<(?:｜｜|\|)\/box(?:｜｜|\|)>/g;

// parse ordered ref-box pairs -> [targetBox, ...refBoxes] as normalized [x1,y1,x2,y2]
function parseDeepSeekBoxes(...texts) {
  for (const t of texts) {
    if (!t) continue;
    const boxes = [];
    for (const m of t.matchAll(DEEPSEEK_REFBOX)) {
      const nums = String(m[1]).match(/-?\d+/g);
      if (nums && nums.length >= 4) boxes.push(nums.slice(0, 4).map(Number));
    }
    if (boxes.length) return boxes;
  }
  throw new Error(`no ref-box pairs in: ${(texts.find(Boolean) || '').slice(0, 160)}`);
}

// normalized 0-1000 bbox -> clamped, ordered pixel bbox
function normBboxToPixel(b, width, height) {
  const mx = maxPixelIndex(width), my = maxPixelIndex(height);
  let [x1, y1, x2, y2] = b.map((v, i) => (i % 2 === 0 ? (v / 1000) * mx : (v / 1000) * my));
  x1 = clamp(x1, 0, mx); y1 = clamp(y1, 0, my); x2 = clamp(x2, 0, mx); y2 = clamp(y2, 0, my);
  if (x2 < x1) [x1, x2] = [x2, x1];
  if (y2 < y1) [y1, y2] = [y2, y1];
  return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)];
}

// stage 1: coarse target box + reference boxes (DeepSeek only)
export async function searchArea({ endpoint, apiKey, model, imageBase64, width, height, description }) {
  const body = {
    model, temperature: 0, max_tokens: 1024,
    messages: [
      { role: 'system', content: DEEPSEEK_SEARCHAREA_SYSTEM },
      { role: 'user', content: [
        { type: 'text', text: `Locate the target and the reference elements needed to distinguish it: ${description}` },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail: 'high' } },
      ] },
    ],
  };
  const t0 = Date.now();
  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'User-Agent': UA, Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!res.ok) return { found: false, error: `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`, ms };
  const j = await res.json();
  const msg = j?.choices?.[0]?.message ?? {};
  let boxes;
  try { boxes = parseDeepSeekBoxes(msg.content ?? '', msg.reasoning_content); }
  catch (e) { return { found: false, error: `parse: ${e.message}`, raw: msg.content, ms }; }
  const px = boxes.map((b) => normBboxToPixel(b, width, height));
  return { found: true, target: px[0], references: px.slice(1), raw: msg.content, ms };
}

export { SYSTEM_PROMPT, DEEPSEEK_SYSTEM_PROMPT, DEEPSEEK_INTRO, DEEPSEEK_OUTPUT_FORMAT };
