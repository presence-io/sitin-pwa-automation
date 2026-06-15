import { log } from '../core/helpers';
import type { RecordingStep, Locator } from './store';

function isAutobotElement(el: Element): boolean {
  return !!(el.closest('#autobot-panel') || el.closest('#autobot-fab') || el.closest('#autobot-minibar')
    || el.closest('#__vconsole') || el.closest('.vc-mask'));
}

function getClickableAncestor(el: Element): Element {
  let cur: Element | null = el;
  while (cur && cur !== document.body) {
    if (cur.tagName === 'BUTTON' || cur.tagName === 'A') return cur;
    if ((cur as HTMLElement).onclick || cur.getAttribute('role') === 'button') return cur;
    const style = window.getComputedStyle(cur);
    if (style.cursor === 'pointer' && cur.parentElement) {
      const parentStyle = window.getComputedStyle(cur.parentElement);
      if (parentStyle.cursor !== 'pointer') return cur;
    }
    cur = cur.parentElement;
  }
  return el;
}

// Extract the most stable text from an element for locator matching.
// For list items, walk direct children to find the primary label (e.g. username)
// while skipping dynamic parts (timestamps, counters, badges).
function extractStableText(el: Element): string | null {
  // Try to find text from the first few leaf children — they're typically
  // the primary label (name, title) rather than metadata (time, count)
  const candidates: string[] = [];
  const walk = (node: Element, depth: number) => {
    if (depth > 4 || candidates.length >= 3) return;
    if (node.children.length === 0) {
      const t = node.textContent?.trim();
      if (t && t.length >= 2 && t.length < 60 && !looksLikeTimestamp(t)) {
        candidates.push(t);
      }
    } else {
      for (let i = 0; i < Math.min(node.children.length, 5); i++) {
        walk(node.children[i], depth + 1);
      }
    }
  };
  walk(el, 0);

  // Return the first non-timestamp candidate (usually the name/title)
  return candidates[0] || null;
}

function looksLikeTimestamp(s: string): boolean {
  // Match common time patterns: "16:02", "3:45 PM", "2m", "1h", "Yesterday"
  return /^\d{1,2}:\d{2}/.test(s)
    || /^\d+[smh]$/.test(s)
    || /^(just now|yesterday|today|\d+ (min|sec|hour|day))/i.test(s);
}

function generateLocators(el: Element): Locator[] {
  const locators: Locator[] = [];

  if (el.id && !el.id.startsWith('autobot')) {
    locators.push({ type: 'id', value: `#${el.id}` });
  }

  const testId = el.getAttribute('data-testid');
  if (testId) {
    locators.push({ type: 'testid', value: testId });
  }

  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    locators.push({ type: 'aria', value: ariaLabel });
  }

  const isClickable = el.tagName === 'BUTTON' || el.tagName === 'A'
    || el.getAttribute('role') === 'button'
    || window.getComputedStyle(el).cursor === 'pointer';
  if (isClickable) {
    const text = el.textContent?.trim();
    if (text && text.length < 80) {
      locators.push({ type: 'text', value: text });
    }
  }

  // For non-clickable elements (e.g. list items), generate a text locator
  // by finding the most stable text from child elements, avoiding dynamic
  // content like timestamps
  if (!isClickable && el.textContent) {
    const stableText = extractStableText(el);
    if (stableText && stableText.length >= 2 && stableText.length < 80) {
      locators.push({ type: 'text', value: stableText });
    }
  }

  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
    const inp = el as HTMLInputElement;
    if (inp.placeholder) {
      locators.push({ type: 'placeholder', value: inp.placeholder });
    }
    const parts = [el.tagName.toLowerCase()];
    if (inp.name) parts.push(`[name="${inp.name}"]`);
    if (el.tagName === 'INPUT' && inp.type && inp.type !== 'text') parts.push(`[type="${inp.type}"]`);
    if (parts.length > 1) {
      locators.push({ type: 'inputAttr', value: parts.join('') });
    }
  }

  if (el.tagName === 'SELECT') {
    const sel = el as HTMLSelectElement;
    if (sel.name) {
      locators.push({ type: 'inputAttr', value: `select[name="${sel.name}"]` });
    }
  }

  // CSS path fallback
  const path: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.body && path.length < 5) {
    let seg = cur.tagName.toLowerCase();
    if (cur.id) { path.unshift(`#${cur.id}`); break; }
    const parent = cur.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter(c => c.tagName === cur!.tagName);
      if (siblings.length > 1) seg += `:nth-child(${[...parent.children].indexOf(cur) + 1})`;
    }
    path.unshift(seg);
    cur = cur.parentElement;
  }
  locators.push({ type: 'css', value: path.join(' > ') });

  return locators;
}

export type OnStepCallback = (step: RecordingStep) => void;

export interface AssertStep {
  type: 'assert';
  assertType: string;
  expected?: string;
  sdk?: string;
  event?: string;
}

export class Recorder {
  private steps: RecordingStep[] = [];
  private recording = false;
  private lastTime = 0;
  private onStep: OnStepCallback | null = null;
  private abortController: AbortController | null = null;
  private lastUrl = '';

  get isRecording() { return this.recording; }
  get stepCount() { return this.steps.length; }
  getSteps() { return [...this.steps]; }

  insertAssert(assert: AssertStep) {
    if (!this.recording) return;
    const step: RecordingStep = {
      type: 'assert' as any,
      locators: [],
      tag: '',
      delay: 0,
      assertType: assert.assertType,
      expected: assert.expected,
      sdk: assert.sdk,
      event: assert.event,
    };
    this.addStep(step);
  }

  start(onStep?: OnStepCallback) {
    if (this.recording) return;
    this.steps = [];
    this.recording = true;
    this.lastTime = Date.now();
    this.lastUrl = location.href;
    this.onStep = onStep || null;
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    document.addEventListener('click', this.handleClick, { capture: false, signal });
    document.addEventListener('input', this.handleInput, { capture: true, signal });
    document.addEventListener('change', this.handleChange, { capture: true, signal });
    window.addEventListener('popstate', this.handleNav, { signal });

    log('Recorder started');
  }

  stop(): RecordingStep[] {
    if (!this.recording) return this.steps;
    this.recording = false;
    this.abortController?.abort();
    this.abortController = null;
    log('Recorder stopped,', this.steps.length, 'steps');
    return [...this.steps];
  }

  private addStep(step: RecordingStep) {
    const now = Date.now();
    step.delay = now - this.lastTime;
    this.lastTime = now;
    this.steps.push(step);
    this.onStep?.(step);
  }

  private handleClick = (e: MouseEvent) => {
    const raw = e.target as Element;
    if (!raw || isAutobotElement(raw)) return;
    const el = getClickableAncestor(raw);
    const locators = generateLocators(el);
    const tag = el.tagName.toLowerCase();
    const textHint = el.textContent?.trim().slice(0, 80) || undefined;
    queueMicrotask(() => {
      if (!this.recording) return;
      this.addStep({ type: 'click', locators, tag, textHint, delay: 0 });
    });
  };

  private handleInput = (e: Event) => {
    const el = e.target as HTMLInputElement;
    if (!el || isAutobotElement(el)) return;
    if (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA' && el.tagName !== 'SELECT') return;
    const value = el.value;
    const locators = generateLocators(el);
    const tag = el.tagName.toLowerCase();
    queueMicrotask(() => {
      if (!this.recording) return;
      const last = this.steps[this.steps.length - 1];
      if (last && last.type === 'input' && last.tag === tag && last.locators[0]?.value === locators[0]?.value) {
        last.value = value;
        return;
      }
      this.addStep({ type: 'input', locators, tag, value, delay: 0 });
    });
  };

  private handleChange = (e: Event) => {
    const el = e.target as HTMLSelectElement;
    if (!el || isAutobotElement(el)) return;
    if (el.tagName === 'SELECT') {
      const locators = generateLocators(el);
      const tag = 'select';
      const value = el.value;
      const textHint = el.options[el.selectedIndex]?.text;
      queueMicrotask(() => {
        if (!this.recording) return;
        this.addStep({ type: 'select', locators, tag, value, textHint, delay: 0 });
      });
    }
  };

  private handleNav = () => {
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    this.addStep({
      type: 'navigate',
      locators: [],
      tag: '',
      url: location.pathname + location.search + location.hash,
      delay: 0,
    });
  };
}
