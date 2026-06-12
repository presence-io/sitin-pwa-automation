import { log, sleep, findBtn, spaNav, setNativeValue, typeInto, waitForEl, randName, fetchImageAsFile, injectFile, dismissModals } from '../core/helpers';
import { CFG, getAuth, getToken, getUserId } from '../core/config';
import { doCashout } from '../core/cashout';
import type { StatusFn, DisableAllFn } from './runner';

export async function stepDeleteAccount(st: StatusFn) {
  st('s1', 'running', '注销账号...');
  if (!getUserId() || !getToken()) { st('s1', 'error', '未登录'); return false; }
  spaNav('/debug'); await sleep(1500);
  let btn: HTMLButtonElement | null = null;
  for (let i = 0; i < 10; i++) { btn = findBtn('删除账户'); if (btn) break; await sleep(500); }
  if (!btn) { st('s1', 'error', '找不到删除按钮'); return false; }
  const orig = window.confirm; window.confirm = () => true;
  btn.click(); await sleep(3000); window.confirm = orig;
  for (let i = 0; i < 10; i++) { await sleep(500); if (location.pathname.includes('/onboarding') || !getAuth()?.token) break; }
  st('s1', 'done', '已注销 ✓'); return true;
}

export async function stepQuickLogin(st: StatusFn) {
  st('s1', 'running', '快速登录...');
  spaNav('/onboarding'); await sleep(1500);
  let btn: HTMLButtonElement | null = null;
  for (let i = 0; i < 15; i++) { btn = findBtn('quick login'); if (btn) break; await sleep(500); }
  if (!btn) { st('s1', 'error', '找不到 Quick Login'); return false; }
  btn.click(); await sleep(1000);
  for (let i = 0; i < 20; i++) { await sleep(500); const s = getAuth(); if (s?.token && s?.userInfo) break; }
  st('s1', 'done', '已登录 ✓'); return true;
}

export async function stepOnboarding(st: StatusFn) {
  st('s1', 'running', '注册中...');
  const s = getAuth(); if (s?.userState === 'FullRegister') { st('s1', 'done', '已注册 ✓'); return true; }
  spaNav('/onboardingcontainer'); await sleep(1500);

  // Username
  const nameInput = await waitForEl('input[type="text"]', 5000).catch(() => null) as HTMLInputElement | null;
  if (nameInput) { nameInput.focus(); setNativeValue(nameInput, CFG.username || randName()); await sleep(300); const b = findBtn(['claim']); if (b) b.click(); await sleep(3500); }

  // Age
  const ageInput = document.querySelector('input[type="number"]') as HTMLInputElement | null;
  if (ageInput) { ageInput.focus(); setNativeValue(ageInput, String(CFG.age)); await sleep(300); const b = findBtn(['claim']); if (b) b.click(); await sleep(3500); }

  // Photo
  let photoBtn = findBtn(['claim']);
  if (!photoBtn || photoBtn.disabled) {
    let file: File | undefined; try { file = CFG.photoUrl ? await fetchImageAsFile(CFG.photoUrl) : undefined; } catch { /* ignore */ }
    if (file) {
      const fi = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement | null;
      if (fi) { injectFile(fi, file); await sleep(2000); const crop = findBtn(['upload']); if (crop) { crop.click(); await sleep(1500); } }
    }
    for (let att = 0; att < 3; att++) {
      await sleep(1000); photoBtn = findBtn(['claim']);
      if (photoBtn && !photoBtn.disabled) { photoBtn.click(); break; }
      await sleep(5000);
    }
    for (let w = 0; w < 30; w++) {
      await sleep(1000);
      if (document.body.innerText.includes('US+1') || getAuth()?.userState === 'FullRegister') break;
    }
  } else { photoBtn.click(); await sleep(3500); }

  // Phone
  await sleep(1000);
  if (document.body.innerText.includes('US+1')) {
    const pi = document.querySelector('input[inputmode="numeric"]') as HTMLInputElement | null;
    if (pi) {
      await typeInto(pi, '2025551234'); await sleep(500);
      const nb = findBtn(['next']); if (nb) nb.click(); await sleep(2000);
      for (let i = 0; i < 10; i++) { const cb = findBtn(['confirm']); if (cb) { cb.click(); break; } await sleep(500); }
    }
  }

  for (let i = 0; i < 15; i++) { await sleep(1000); if (getAuth()?.userState === 'FullRegister') break; }
  await sleep(1500); await dismissModals(true);
  st('s1', 'done', '注册完成 ✓'); return true;
}

export async function stepStage1Cashout(st: StatusFn) {
  st('s1', 'running', '提现 $0.50...');
  const s = getAuth(); if (s?.cash === 0) { spaNav('/'); st('s1', 'done', '已提现 ✓'); return true; }
  await doCashout();
  st('s1', 'done', 'Stage 1 完成 ✓'); return true;
}
