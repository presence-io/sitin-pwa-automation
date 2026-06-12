import { log, warn, sleep, setNativeValue, findBtn, spaNav, dismissModals } from '../core/helpers';
import { CFG } from '../core/config';

let autoAcceptObs: MutationObserver | null = null;

export function installAutoAccept() {
  if (autoAcceptObs) return;
  autoAcceptObs = new MutationObserver(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.textContent?.includes('Accept') && (b as HTMLElement).offsetParent);
    if (btn) { log('Auto-accepting call'); (btn as HTMLElement).click(); }
  });
  autoAcceptObs.observe(document.body, { childList: true, subtree: true });
  log('Auto-accept observer installed');
}

export function removeAutoAccept() {
  if (autoAcceptObs) { autoAcceptObs.disconnect(); autoAcceptObs = null; }
}

export async function triggerMockCall(): Promise<boolean> {
  log('triggerMockCall');
  localStorage.setItem('debug_disable_auto_mock', '0');
  installAutoAccept();
  if (!location.pathname.includes('/debug')) { spaNav('/debug'); await sleep(1500); }
  const priceInput = [...document.querySelectorAll('input[placeholder*="$/min"]')].find(i => (i as HTMLElement).offsetParent) as HTMLInputElement | undefined;
  if (priceInput) { setNativeValue(priceInput, CFG.mockPrice); await sleep(200); }
  const btn = findBtn(['normal mock']);
  if (!btn) { warn('Normal Mock button not found'); return false; }
  btn.click();
  await sleep(2000);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (!location.pathname.includes('/mock-call')) {
      log('Mock call finished');
      await sleep(2000);
      await dismissModals();
      return true;
    }
  }
  warn('Mock call timeout');
  return true;
}

export async function runMockCalls(count: number, statusFn?: (msg: string) => void) {
  for (let i = 0; i < count; i++) {
    log(`Mock call ${i + 1}/${count}`);
    statusFn?.(`Mock Call ${i + 1}/${count}...`);
    await triggerMockCall();
    await sleep(1000);
  }
}
