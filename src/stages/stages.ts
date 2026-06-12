import { sleep } from '../core/helpers';
import { completeTask } from '../core/tasks';
import { runMockCalls, removeAutoAccept } from '../core/mockCall';
import { doCashout } from '../core/cashout';
import type { StatusFn } from './runner';

export async function stepStage2(st: StatusFn) {
  st('s2', 'running', '完成 Stage 2 任务...');
  await completeTask(102, 'Camera');
  await completeTask(103, 'Microphone');
  await completeTask(105, 'Location Access');
  await completeTask(112, 'Install App');
  await completeTask(118, 'Verify');
  await completeTask(110, 'Instagram');
  st('s2', 'running', 'Mock Call 凑收益...');
  await runMockCalls(5);
  removeAutoAccept();
  st('s2', 'running', '提现 $7.00...');
  await sleep(2000);
  await doCashout();
  st('s2', 'done', 'Stage 2 完成 ✓'); return true;
}

export async function stepStage3(st: StatusFn) {
  st('s3', 'running', '完成 Stage 3 任务...');
  await completeTask(135, 'Location');
  st('s3', 'running', 'Mock Call 凑收益...');
  await runMockCalls(15);
  removeAutoAccept();
  st('s3', 'running', '提现 $8.00...');
  await sleep(2000);
  await doCashout();
  st('s3', 'done', 'Stage 3 完成 ✓'); return true;
}

export async function stepStage4(st: StatusFn) {
  st('s4', 'running', 'Mock Call 凑收益...');
  await runMockCalls(18);
  removeAutoAccept();
  st('s4', 'running', '提现 $12.00...');
  await sleep(2000);
  await doCashout();
  st('s4', 'done', 'Stage 4 完成 ✓'); return true;
}

export async function stepStage5(st: StatusFn) {
  st('s5', 'running', 'Mock Call 凑收益...');
  await runMockCalls(35);
  removeAutoAccept();
  st('s5', 'running', '提现 $25.00...');
  await sleep(2000);
  await doCashout();
  st('s5', 'done', 'Stage 5 完成 ✓'); return true;
}
