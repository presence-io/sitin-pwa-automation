import { log, sleep, warn } from '../core/helpers';
import { fbPatch, fbGet } from '../shared/firebase';
import { getDeviceId } from '../testing/remote';
import { runSuite } from '../testing/runner';
import { generateReport, printReportToConsole } from '../testing/reporter';
import { fetchRemoteSuite } from '../testing/repository';
import type { TestSuite } from '../testing/types';

export type StatusFn = (key: string, state: string, msg: string) => void;
export type DisableAllFn = (v: boolean) => void;

export interface StageDefinition {
  id: string;
  name: string;
  amount: string;
  suiteFile: string;
}

export const STAGES: StageDefinition[] = [
  { id: 's1', name: 'Stage 1', amount: '$0.50', suiteFile: 'stage1.json' },
  { id: 's2', name: 'Stage 2', amount: '$7.00', suiteFile: 'stage2.json' },
  { id: 's3', name: 'Stage 3', amount: '$8.00', suiteFile: 'stage3.json' },
  { id: 's4', name: 'Stage 4', amount: '$12.00', suiteFile: 'stage4.json' },
  { id: 's5', name: 'Stage 5', amount: '$25.00', suiteFile: 'stage5.json' },
];

export interface StageProgress {
  stageId: string;
  stageName: string;
  stageIndex: number;
  totalStages: number;
  status: 'running' | 'completed' | 'failed';
  detail?: string;
  updatedAt: number;
}

async function reportProgress(progress: StageProgress): Promise<void> {
  const deviceId = getDeviceId();
  fbPatch(`stageProgress/${deviceId}`, progress).catch(() => {});
}

async function loadStageSuite(stageIndex: number): Promise<TestSuite | null> {
  const stage = STAGES[stageIndex];
  if (!stage) return null;

  // Try Firebase first (user may have edited)
  const project = 'gracechat';
  const fbKey = stage.suiteFile.replace('.json', '');
  const fbSuite = await fbGet<TestSuite>(`suites/${project}/${fbKey}`);
  if (fbSuite && fbSuite.cases) {
    log(`Stage ${stageIndex + 1} loaded from Firebase`);
    return fbSuite;
  }

  // Fall back to remote (GitHub Pages)
  const remoteSuite = await fetchRemoteSuite(project, stage.suiteFile);
  if (remoteSuite) {
    log(`Stage ${stageIndex + 1} loaded from remote`);
    return remoteSuite;
  }

  warn(`Stage ${stageIndex + 1} suite not found: ${stage.suiteFile}`);
  return null;
}

export async function runStage(
  stageIndex: number,
  st: StatusFn,
): Promise<boolean> {
  const stage = STAGES[stageIndex];
  if (!stage) return false;

  const progress: StageProgress = {
    stageId: stage.id,
    stageName: stage.name,
    stageIndex,
    totalStages: STAGES.length,
    status: 'running',
    detail: 'Loading suite...',
    updatedAt: Date.now(),
  };
  await reportProgress(progress);

  const suite = await loadStageSuite(stageIndex);
  if (!suite) {
    st(stage.id, 'error', `${stage.name} 用例未找到`);
    await reportProgress({ ...progress, status: 'failed', detail: 'Suite not found', updatedAt: Date.now() });
    return false;
  }

  st(stage.id, 'running', `${stage.name} 执行中...`);
  await reportProgress({ ...progress, detail: `Running ${suite.name}...`, updatedAt: Date.now() });

  const results = await runSuite(suite, (msg) => {
    st(stage.id, 'running', msg);
    reportProgress({ ...progress, detail: msg, updatedAt: Date.now() });
  });

  const report = generateReport(suite.name, results);
  printReportToConsole(report);

  const ok = report.summary.failed === 0;
  await reportProgress({
    ...progress,
    status: ok ? 'completed' : 'failed',
    detail: ok ? `${stage.name} done ✓` : `${report.summary.failed} case(s) failed`,
    updatedAt: Date.now(),
  });
  return ok;
}

export async function runAllStages(
  st: StatusFn,
  disableAll: DisableAllFn,
  startFrom = 0,
): Promise<boolean> {
  disableAll(true);
  for (let i = startFrom; i < STAGES.length; i++) {
    st(STAGES[i].id, 'running', `${STAGES[i].name} 开始...`);
    const ok = await runStage(i, st);
    if (!ok) {
      st(STAGES[i].id, 'error', `${STAGES[i].name} 失败`);
      disableAll(false);
      return false;
    }
    st(STAGES[i].id, 'done', `${STAGES[i].name} 完成 ✓`);
    await sleep(1000);
  }
  disableAll(false);
  return true;
}

// Legacy compat
export async function runS1(st: StatusFn, disableAll: DisableAllFn) {
  disableAll(true);
  await runStage(0, st);
  disableAll(false);
}

export function resumeS1(_st: StatusFn, _disableAll: DisableAllFn) {
  // Legacy no-op
}
