import { log, sleep, findBtn, spaNav, typeInto, dismissModals } from '../core/helpers';
import { CFG } from '../core/config';

export async function doCashout() {
  log('doCashout');
  let cashBtn = findBtn(['cash out']);
  if (cashBtn) {
    cashBtn.click(); await sleep(2000);
  } else {
    spaNav('/cashout'); await sleep(2000);
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.trim() === 'Cash Out' && !btn.disabled && !btn.closest('#autobot-panel')) {
        btn.click(); await sleep(2000); break;
      }
    }
  }
  const emailInput = [...document.querySelectorAll('input[type="email"]')].find(i =>
    !i.closest('#autobot-panel') && (i as HTMLElement).offsetParent
  ) as HTMLInputElement | undefined;
  if (emailInput) {
    await typeInto(emailInput, CFG.paypalEmail);
    await sleep(300);
    const nextBtn = findBtn(['next']); if (nextBtn) { nextBtn.click(); await sleep(3000); }
  }
  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const btn = [...document.querySelectorAll('button')]
      .filter(b => !b.closest('#autobot-panel') && (b as HTMLElement).offsetParent)
      .find(b => {
        const t = b.textContent?.trim().toLowerCase() || '';
        return (t.includes('got it') || t.includes('continue earning') || t.includes('ok') || t.includes('next') || t.includes('confirm') || t.includes('maybe later') || t.includes('share')) && !b.disabled && b.textContent?.trim() !== 'Cash Out';
      });
    if (btn) { log('Cashout modal:', btn.textContent!.trim()); (btn as HTMLElement).click(); await sleep(1000); }
  }
  await dismissModals();
  spaNav('/'); await sleep(1000);
}
