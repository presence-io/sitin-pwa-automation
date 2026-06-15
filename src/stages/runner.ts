import { log, sleep, warn } from '../core/helpers';
import { stepDeleteAccount, stepQuickLogin, stepOnboarding, stepStage1Cashout } from './stage1';
import { stepStage2, stepStage3, stepStage4, stepStage5 } from './stages';
import { fbPatch } from '../shared/firebase';
import { getDeviceId } from '../testing/remote';

export type StatusFn = (key: string, state: string, msg: string) => void;
export type DisableAllFn = (v: boolean) => void;

export interface StageStep {
  key: string;
  label: string;
  fn: (st: StatusFn) => Promise<boolean>;
}

export interface StageDefinition {
  id: string;
  name: string;
  amount: string;
  steps: StageStep[];
}

export const STAGES: StageDefinition[] = [
  {
    id: 's1', name: 'Stage 1', amount: '$0.50',
    steps: [
      { key: 'del', label: '注销账号', fn: stepDeleteAccount },
      { key: 'login', label: '快速登录', fn: stepQuickLogin },
      { key: 'onboard', label: '完成注册', fn: stepOnboarding },
      { key: 'cashout', label: '提现 $0.50', fn: stepStage1Cashout },
    ],
  },
  {
    id: 's2', name: 'Stage 2', amount: '$7.00',
    steps: [{ key: 'run', label: '任务 + Mock → 提现', fn: stepStage2 }],
  },
  {
    id: 's3', name: 'Stage 3', amount: '$8.00',
    steps: [{ key: 'run', label: '任务 + Mock → 提现', fn: stepStage3 }],
  },
  {
    id: 's4', name: 'Stage 4', amount: '$12.00',
    steps: [{ key: 'run', label: 'Mock → 提现', fn: stepStage4 }],
  },
  {
    id: 's5', name: 'Stage 5', amount: '$25.00',
    steps: [{ key: 'run', label: 'Mock → 提现', fn: stepStage5 }],
  },
];

export interface StageProgress {
  stageId: string;
  stageName: string;
  stageIndex: number;
  totalStages: number;
  stepKey: string;
  stepLabel: string;
  stepIndex: number;
  totalSteps: number;
  status: 'running' | 'completed' | 'failed';
  error?: string;
  updatedAt: number;
}

type ProgressCallback = (progress: StageProgress) => void;

async function reportProgress(progress: StageProgress): Promise<void> {
  const deviceId = getDeviceId();
  fbPatch(`stageProgress/${deviceId}`, progress).catch(() => {});
}

export async function runStage(
  stageIndex: number,
  st: StatusFn,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  const stage = STAGES[stageIndex];
  if (!stage) return false;

  for (let i = 0; i < stage.steps.length; i++) {
    const step = stage.steps[i];
    const progress: StageProgress = {
      stageId: stage.id,
      stageName: stage.name,
      stageIndex,
      totalStages: STAGES.length,
      stepKey: step.key,
      stepLabel: step.label,
      stepIndex: i,
      totalSteps: stage.steps.length,
      status: 'running',
      updatedAt: Date.now(),
    };
    onProgress?.(progress);
    await reportProgress(progress);

    const ok = await step.fn(st);
    if (!ok) {
      const failed = { ...progress, status: 'failed' as const, error: `Failed at ${step.label}`, updatedAt: Date.now() };
      onProgress?.(failed);
      await reportProgress(failed);
      return false;
    }
    await sleep(800);
  }

  const done: StageProgress = {
    stageId: stage.id,
    stageName: stage.name,
    stageIndex,
    totalStages: STAGES.length,
    stepKey: 'done',
    stepLabel: `${stage.name} 完成`,
    stepIndex: stage.steps.length,
    totalSteps: stage.steps.length,
    status: 'completed',
    updatedAt: Date.now(),
  };
  onProgress?.(done);
  await reportProgress(done);
  return true;
}

export async function runAllStages(
  st: StatusFn,
  disableAll: DisableAllFn,
  startFrom = 0,
  onProgress?: ProgressCallback,
): Promise<boolean> {
  disableAll(true);
  for (let i = startFrom; i < STAGES.length; i++) {
    st(STAGES[i].id, 'running', `${STAGES[i].name} 开始...`);
    const ok = await runStage(i, st, onProgress);
    if (!ok) {
      st(STAGES[i].id, 'error', `${STAGES[i].name} 失败`);
      disableAll(false);
      return false;
    }
    st(STAGES[i].id, 'done', `${STAGES[i].name} 完成 ✓`);
  }
  disableAll(false);
  return true;
}

// Legacy compat
const STATE_KEY = 'autobot_s1_state';
function saveState(i: number) { localStorage.setItem(STATE_KEY, JSON.stringify({ step: i, ts: Date.now() })); }
function clearState() { localStorage.removeItem(STATE_KEY); }
function getState(): { step: number; ts: number } | null {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
    return (s && Date.now() - s.ts < 10 * 60 * 1000) ? s : null;
  } catch { return null; }
}

export async function runS1(st: StatusFn, disableAll: DisableAllFn) {
  disableAll(true);
  await runStage(0, st);
  disableAll(false);
}

export function resumeS1(st: StatusFn, disableAll: DisableAllFn) {
  const s = getState();
  if (!s) return;
  clearState();
}
