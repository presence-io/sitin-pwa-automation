import { sleep } from '../core/helpers';
import { CFG } from '../core/config';
import { completeTask } from '../core/tasks';
import { runMockCalls, removeAutoAccept } from '../core/mockCall';
import { doCashout } from '../core/cashout';
import type { StatusFn } from './runner';

// Stage requirements from PWA cashout.ts
const STAGE_REQUIREMENTS = [
  // Stage 1: handled separately (register flow)
  { earn: 0, duration: 0 },
  // Stage 2: $2.10 earn
  { earn: 2.1, duration: 0 },
  // Stage 3: $8.00 earn
  { earn: 8, duration: 0 },
  // Stage 4: $10.00 earn + 2min duration
  { earn: 10, duration: 2 },
  // Stage 5: $20.00 earn + 5min duration
  { earn: 20, duration: 5 },
];

function calcMockCalls(stageIndex: number): number {
  const req = STAGE_REQUIREMENTS[stageIndex];
  if (!req || req.earn === 0) return 0;

  const pricePerMin = parseFloat(CFG.mockPrice) || 10;
  // Assume each mock call ~1 min duration
  const callDurationMin = 1;
  const earnPerCall = pricePerMin * callDurationMin;

  // Calls needed for earnings
  const callsForEarn = Math.ceil(req.earn / earnPerCall);

  // Calls needed for duration requirement
  const callsForDuration = req.duration > 0 ? Math.ceil(req.duration / callDurationMin) : 0;

  // Take the max + 1 buffer call for safety
  return Math.max(callsForEarn, callsForDuration) + 1;
}

export async function stepStage2(st: StatusFn) {
  st('s2', 'running', '完成 Stage 2 任务...');
  await completeTask(102, 'Camera');
  await completeTask(103, 'Microphone');
  await completeTask(105, 'Location Access');
  await completeTask(112, 'Install App');
  await completeTask(118, 'Verify');
  await completeTask(110, 'Instagram');
  const n = calcMockCalls(1);
  st('s2', 'running', `Mock Call ×${n} (${CFG.mockPrice}$/min)...`);
  await runMockCalls(n);
  removeAutoAccept();
  st('s2', 'running', '提现 $7.00...');
  await sleep(2000);
  await doCashout();
  st('s2', 'done', 'Stage 2 完成 ✓'); return true;
}

export async function stepStage3(st: StatusFn) {
  st('s3', 'running', '完成 Stage 3 任务...');
  await completeTask(135, 'Location');
  const n = calcMockCalls(2);
  st('s3', 'running', `Mock Call ×${n} (${CFG.mockPrice}$/min)...`);
  await runMockCalls(n);
  removeAutoAccept();
  st('s3', 'running', '提现 $8.00...');
  await sleep(2000);
  await doCashout();
  st('s3', 'done', 'Stage 3 完成 ✓'); return true;
}

export async function stepStage4(st: StatusFn) {
  const n = calcMockCalls(3);
  st('s4', 'running', `Mock Call ×${n} (${CFG.mockPrice}$/min, 需≥2min时长)...`);
  await runMockCalls(n);
  removeAutoAccept();
  st('s4', 'running', '提现 $12.00...');
  await sleep(2000);
  await doCashout();
  st('s4', 'done', 'Stage 4 完成 ✓'); return true;
}

export async function stepStage5(st: StatusFn) {
  const n = calcMockCalls(4);
  st('s5', 'running', `Mock Call ×${n} (${CFG.mockPrice}$/min, 需≥5min时长)...`);
  await runMockCalls(n);
  removeAutoAccept();
  st('s5', 'running', '提现 $25.00...');
  await sleep(2000);
  await doCashout();
  st('s5', 'done', 'Stage 5 完成 ✓'); return true;
}
