import { tracker } from './tracker';
import { findByLocator } from '../teaching/player';
import type { TestAction } from './types';

export interface AssertResult {
  passed: boolean;
  actual?: string;
  detail?: string;
}

function checkOnce(action: TestAction): AssertResult {
  switch (action.assertType) {
    case 'url': {
      const url = location.pathname + location.search + location.hash;
      return { passed: url.includes(action.expected!), actual: url };
    }

    case 'textExists': {
      const found = document.body.innerText.includes(action.expected!);
      return { passed: found, actual: found ? 'found' : 'not found' };
    }

    case 'textNotExists': {
      const absent = !document.body.innerText.includes(action.expected!);
      return { passed: absent, actual: absent ? 'not found' : 'found' };
    }

    case 'elementExists': {
      if (!action.locators?.length) return { passed: false, detail: 'no locators' };
      for (const loc of action.locators) {
        const el = findByLocator(loc, action.tag || '');
        if (el) return { passed: true };
      }
      return { passed: false, actual: 'element not found' };
    }

    case 'elementNotExists': {
      if (!action.locators?.length) return { passed: true };
      for (const loc of action.locators) {
        const el = findByLocator(loc, action.tag || '');
        if (el) return { passed: false, actual: 'element exists' };
      }
      return { passed: true };
    }

    case 'eventFired': {
      const events = tracker.getEventsByName(action.sdk!, action.event!);
      return { passed: events.length > 0, actual: `${events.length} events` };
    }

    case 'eventNotFired': {
      const events = tracker.getEventsByName(action.sdk!, action.event!);
      return { passed: events.length === 0, actual: `${events.length} events` };
    }

    case 'eventParams': {
      const events = tracker.getEventsByName(action.sdk!, action.event!);
      const match = events.some(e => String(e.params[action.key!]) === action.expected);
      const actual = events.length > 0 ? String(events[0].params[action.key!]) : 'no event';
      return { passed: match, actual };
    }

    case 'eventCount': {
      const count = tracker.getEventsByName(action.sdk!, action.event!).length;
      const inRange = (action.min == null || count >= action.min) && (action.max == null || count <= action.max);
      return { passed: inRange, actual: `${count} events`, detail: `expected ${action.min ?? 0}-${action.max ?? '∞'}` };
    }

    case 'localStorage': {
      const val = localStorage.getItem(action.key!);
      return { passed: val === action.expected, actual: val ?? 'null' };
    }

    case 'cookie': {
      const pairs = document.cookie.split('; ').filter(Boolean);
      const map: Record<string, string> = {};
      for (const p of pairs) { const [k, ...v] = p.split('='); map[k] = v.join('='); }
      const val = map[action.key!] ?? null;
      return { passed: val === action.expected, actual: val ?? 'null' };
    }

    case 'jsExpression': {
      try {
        const result = new Function(`return (${action.expected})`)();
        return { passed: !!result, actual: String(result) };
      } catch (e) {
        return { passed: false, detail: String(e) };
      }
    }

    default:
      return { passed: false, detail: `unknown assertType: ${action.assertType}` };
  }
}

export async function runAssert(action: TestAction): Promise<AssertResult> {
  const timeout = action.timeout ?? 5000;
  const interval = 200;
  const deadline = Date.now() + timeout;

  let result = checkOnce(action);
  if (result.passed) return result;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval));
    result = checkOnce(action);
    if (result.passed) return result;
  }

  result.detail = `${result.detail ?? ''} (timeout ${timeout}ms)`.trim();
  return result;
}
