import { log, sleep } from '../core/helpers';
import { stepDeleteAccount, stepQuickLogin, stepOnboarding, stepStage1Cashout } from './stage1';

export type StatusFn = (key: string, state: string, msg: string) => void;
export type DisableAllFn = (v: boolean) => void;

const STATE_KEY = 'autobot_s1_state';

function saveState(i: number) { localStorage.setItem(STATE_KEY, JSON.stringify({ step: i, ts: Date.now() })); }
function clearState() { localStorage.removeItem(STATE_KEY); }
function getState(): { step: number; ts: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    return (s && Date.now() - s.ts < 10 * 60 * 1000) ? s : null;
  } catch { return null; }
}

type StepDef = { key: string; fn: (st: StatusFn) => Promise<boolean> };

const S1_STEPS: StepDef[] = [
  { key: 's1-del', fn: stepDeleteAccount },
  { key: 's1-login', fn: stepQuickLogin },
  { key: 's1-onboard', fn: stepOnboarding },
  { key: 's1-cashout', fn: stepStage1Cashout },
];

export async function runS1(st: StatusFn, disableAll: DisableAllFn) {
  st('s1', 'running', '一键 Stage 1...'); disableAll(true);
  for (let i = 0; i < S1_STEPS.length; i++) {
    saveState(i);
    const ok = await S1_STEPS[i].fn(st);
    if (!ok) { st('s1', 'error', `停止于 ${S1_STEPS[i].key}`); clearState(); disableAll(false); return; }
    await sleep(800);
  }
  clearState(); st('s1', 'done', 'Stage 1 全部完成 ✓'); disableAll(false);
}

export function resumeS1(st: StatusFn, disableAll: DisableAllFn) {
  const s = getState(); if (!s) return;
  const next = s.step + 1;
  if (next >= S1_STEPS.length) { clearState(); return; }
  log('Resuming S1 from step', next);
  setTimeout(async () => {
    disableAll(true);
    for (let i = next; i < S1_STEPS.length; i++) {
      saveState(i); const ok = await S1_STEPS[i].fn(st);
      if (!ok) { clearState(); disableAll(false); return; } await sleep(800);
    }
    clearState(); st('s1', 'done', 'Stage 1 全部完成 ✓'); disableAll(false);
  }, 3000);
}
