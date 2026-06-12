export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const log = (...a: unknown[]) =>
  console.log('%c[AutoBot]', 'color:#00bcd4;font-weight:bold', ...a);

export const warn = (...a: unknown[]) =>
  console.warn('%c[AutoBot]', 'color:#ff9800;font-weight:bold', ...a);

export function randName(): string {
  const a = ['Happy', 'Lucky', 'Sweet', 'Cool', 'Cute', 'Fun', 'Nice', 'Star'];
  const b = ['Cat', 'Dog', 'Bunny', 'Bird', 'Fox', 'Bear', 'Panda', 'Tiger'];
  return a[(Math.random() * a.length) | 0] + b[(Math.random() * b.length) | 0] + (((Math.random() * 9000) | 0) + 1000);
}

export function waitForEl(sel: string, ms = 10000): Promise<Element> {
  return new Promise((ok, no) => {
    const el = document.querySelector(sel);
    if (el) return ok(el);
    const ob = new MutationObserver(() => {
      const e = document.querySelector(sel);
      if (e) { ob.disconnect(); ok(e); }
    });
    ob.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => { ob.disconnect(); no(new Error('waitForEl: ' + sel)); }, ms);
  });
}

export function setNativeValue(el: HTMLInputElement, v: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function typeInto(el: HTMLInputElement, text: string) {
  el.focus(); await sleep(50);
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  for (const ch of text) {
    const cur = el.value || '';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, cur + ch);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(15);
  }
}

export function findBtn(texts: string | string[]): HTMLButtonElement | null {
  if (typeof texts === 'string') texts = [texts];
  for (const btn of document.querySelectorAll('button')) {
    if (btn.closest('#autobot-panel') || btn.closest('#autobot-fab')) continue;
    const t = btn.textContent?.trim().toLowerCase() || '';
    for (const text of texts) {
      if (t.includes(text.toLowerCase()) && !btn.disabled) return btn;
    }
  }
  return null;
}

export function spaNav(path: string) {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function fetchImageAsFile(url: string): Promise<File> {
  return new Promise((ok, no) => {
    const img = new Image(); img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d')!.drawImage(img, 0, 0);
      c.toBlob(b => b ? ok(new File([b], 'avatar.jpg', { type: 'image/jpeg' })) : no('toBlob failed'), 'image/jpeg', 0.92);
    };
    img.onerror = () => no('load failed: ' + url); img.src = url;
  });
}

export function injectFile(input: HTMLInputElement, file: File) {
  const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

export async function dismissModals(skipCashout = false) {
  for (let r = 0; r < 6; r++) {
    const kw = ['continue earning', 'got it', 'maybe later', 'continue', 'ok'];
    if (!skipCashout) kw.push('cash out');
    const btn = findBtn(kw);
    if (btn) { btn.click(); await sleep(1200); continue; }
    const ci = [...document.querySelectorAll('img')].find(i =>
      (i as HTMLImageElement).alt?.toLowerCase().includes('close') && (i as HTMLElement).offsetParent
    );
    if (ci) { (ci as HTMLElement).click(); await sleep(1000); continue; }
    break;
  }
}
