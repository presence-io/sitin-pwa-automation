import { log, warn, sleep, typeInto, spaNav, waitForIdle } from '../core/helpers';
import type { RecordingStep, Locator } from './store';

export type PlayerStatusFn = (msg: string) => void;

function isVisible(el: Element): boolean {
  return (el as HTMLElement).offsetParent !== null;
}

function isAutobotElement(el: Element): boolean {
  return !!(el.closest('#autobot-panel') || el.closest('#autobot-fab') || el.closest('#autobot-minibar'));
}

export function findByLocator(locator: Locator, tag: string): Element | null {
  switch (locator.type) {
    case 'id': {
      const el = document.querySelector(locator.value);
      return el && isVisible(el) ? el : null;
    }
    case 'testid': {
      const el = document.querySelector(`[data-testid="${locator.value}"]`);
      return el && isVisible(el) ? el : null;
    }
    case 'aria': {
      const el = document.querySelector(`[aria-label="${locator.value}"]`);
      return el && isVisible(el) ? el : null;
    }
    case 'text': {
      const candidates = tag
        ? document.querySelectorAll(tag)
        : document.querySelectorAll('button, a, div, span, li');
      // exact match first
      for (const el of candidates) {
        if (!isVisible(el) || isAutobotElement(el)) continue;
        if (el.textContent?.trim() === locator.value) return el;
      }
      // contains match — prefer the smallest (most specific) element
      let best: Element | null = null;
      let bestLen = Infinity;
      for (const el of candidates) {
        if (!isVisible(el) || isAutobotElement(el)) continue;
        const t = el.textContent?.trim() || '';
        if (t.includes(locator.value) && t.length < bestLen) {
          best = el;
          bestLen = t.length;
        }
      }
      return best;
    }
    case 'placeholder': {
      const el = document.querySelector(`[placeholder="${locator.value}"]`);
      return el && isVisible(el) ? el : null;
    }
    case 'inputAttr': {
      try {
        const el = document.querySelector(locator.value);
        return el && isVisible(el) ? el : null;
      } catch { return null; }
    }
    case 'css': {
      try {
        const el = document.querySelector(locator.value);
        return el && isVisible(el) ? el : null;
      } catch { return null; }
    }
    default:
      return null;
  }
}

export function findElementByStep(step: RecordingStep): Element | null {
  if (!step.locators || step.locators.length === 0) return null;

  for (const locator of step.locators) {
    const el = findByLocator(locator, step.tag);
    if (el) return el;
  }

  // final fallback: textHint fuzzy search
  if (step.textHint && step.type === 'click') {
    const all = document.querySelectorAll('button, a, div, span, li, p');
    for (const el of all) {
      if (!isVisible(el) || isAutobotElement(el)) continue;
      const t = el.textContent?.trim() || '';
      if (t === step.textHint) return el;
    }
    for (const el of all) {
      if (!isVisible(el) || isAutobotElement(el)) continue;
      const t = el.textContent?.trim() || '';
      if (t.includes(step.textHint!)) return el;
    }
  }

  return null;
}

export async function waitForElement(step: RecordingStep, timeoutMs = 10000): Promise<Element | null> {
  const el = findElementByStep(step);
  if (el) return el;

  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const obs = new MutationObserver(() => {
      const found = findElementByStep(step);
      if (found) { obs.disconnect(); resolve(found); }
      else if (Date.now() > deadline) { obs.disconnect(); resolve(null); }
    });
    obs.observe(document.body, { childList: true, subtree: true, attributes: true });
    setTimeout(() => { obs.disconnect(); resolve(findElementByStep(step)); }, timeoutMs);
  });
}

export async function executeStepAction(step: RecordingStep): Promise<boolean> {
  switch (step.type) {
    case 'navigate':
      if (step.url) spaNav(step.url);
      await waitForIdle(2500, 250);
      return true;

    case 'click': {
      const el = await waitForElement(step);
      if (!el) return false;
      (el as HTMLElement).click();
      await waitForIdle(1200, 150);
      return true;
    }

    case 'input': {
      const el = await waitForElement(step);
      if (!el) return false;
      const inp = el as HTMLInputElement;
      inp.focus();
      if (step.value !== undefined) {
        await typeInto(inp, step.value);
      }
      return true;
    }

    case 'select': {
      const el = await waitForElement(step);
      if (!el) return false;
      const sel = el as HTMLSelectElement;
      if (step.value !== undefined) {
        sel.value = step.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    }

    case 'scroll': {
      // Prefer scrolling a recorded anchor element into view (survives content
      // that shifted the absolute offset); fall back to the absolute position.
      if (step.locators && step.locators.length) {
        const el = findElementByStep(step);
        if (el) { (el as HTMLElement).scrollIntoView({ block: 'center', behavior: 'auto' }); return true; }
      }
      window.scrollTo(step.scrollX || 0, step.scrollY || 0);
      return true;
    }

    default:
      warn('Unknown step type:', step.type);
      return false;
  }
}

// Levenshtein distance, capped scan — used only on the failure path to suggest
// the on-screen text closest to what the step was looking for.
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

function nearestVisibleText(target: string): string | null {
  if (!target) return null;
  const t0 = target.slice(0, 40);
  const els = document.querySelectorAll('button, a, [role="button"], input, span, li');
  let best: string | null = null, bestScore = Infinity, scanned = 0;
  for (const el of els) {
    if (scanned > 500) break;
    if (!isVisible(el) || isAutobotElement(el)) continue;
    const t = ((el.textContent || (el as HTMLInputElement).placeholder || '').trim());
    if (!t || t.length > 40) continue;
    scanned++;
    const d = lev(t, t0);
    if (d < bestScore) { bestScore = d; best = t; }
  }
  return best && bestScore <= Math.max(3, Math.ceil(t0.length * 0.5)) ? best : null;
}

// Human-readable reason a click/input/select step failed to find its element,
// so a failed report says *why* (which locators were tried, the text hint, and
// the closest on-screen text) instead of a bare ✗.
export function describeStepFailure(step: RecordingStep): string {
  const tried = (step.locators ?? []).map(l => `${l.type}=${l.value}`);
  const parts: string[] = [`未找到元素(${step.type})`];
  parts.push(tried.length
    ? `已试 ${tried.length} 个定位器: ${tried.slice(0, 4).join(' | ')}${tried.length > 4 ? ' …' : ''}`
    : '该步无定位器');
  if (step.textHint) {
    parts.push(`textHint="${step.textHint}"`);
    const near = nearestVisibleText(step.textHint);
    if (near && near !== step.textHint) parts.push(`页面最接近文本: "${near}"`);
  }
  return parts.join('; ');
}

export class Player {
  private playing = false;
  private paused = false;
  private aborted = false;
  private currentStep = 0;
  private statusFn: PlayerStatusFn | null = null;

  get isPlaying() { return this.playing; }
  get isPaused() { return this.paused; }
  get progress() { return this.currentStep; }

  async play(steps: RecordingStep[], statusFn?: PlayerStatusFn): Promise<boolean> {
    if (this.playing) return false;
    this.playing = true;
    this.paused = false;
    this.aborted = false;
    this.currentStep = 0;
    this.statusFn = statusFn || null;

    log('Player started,', steps.length, 'steps');

    for (let i = 0; i < steps.length; i++) {
      if (this.aborted) { this.finish('已终止'); return false; }
      while (this.paused && !this.aborted) await sleep(200);
      if (this.aborted) { this.finish('已终止'); return false; }

      this.currentStep = i;
      const step = steps[i];
      this.statusFn?.(`回放 ${i + 1}/${steps.length}: ${step.type} ${step.textHint || ''}`);

      if (step.delay > 100) await sleep(Math.min(step.delay, 5000));

      const ok = await this.executeStep(step);
      if (!ok) {
        warn('Player failed at step', i + 1, step);
        this.finish(`步骤 ${i + 1} 失败: ${step.type} ${step.textHint || ''}`);
        return false;
      }
      await sleep(300);
    }

    this.finish('回放完成 ✓');
    return true;
  }

  pause() { if (this.playing) this.paused = true; }
  resume() { this.paused = false; }
  stop() { this.aborted = true; this.paused = false; }

  private finish(msg: string) {
    this.playing = false;
    this.paused = false;
    this.statusFn?.(msg);
    log('Player:', msg);
  }

  private async executeStep(step: RecordingStep): Promise<boolean> {
    return executeStepAction(step);
  }
}
