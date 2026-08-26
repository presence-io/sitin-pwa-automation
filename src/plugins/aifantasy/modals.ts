import { sleep, findBtn } from '../../core/helpers';

// aifantasy-specific: clears the reward/earning/cash-out modals the app throws up
// between flow steps. The button keywords are this app's copy, so it lives with
// the plugin rather than in generic core.
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
