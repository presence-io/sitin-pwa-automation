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

export async function locate({ endpoint, apiKey, model, imageBase64, width, height, description, useJsonMode = true }) {
  const body = {
    model,
    temperature: 0,
    max_tokens: 300,
    ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: [
        { type: 'text', text: `Find: ${description}` },
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
  const content = j?.choices?.[0]?.message?.content ?? '';
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

export { SYSTEM_PROMPT };
