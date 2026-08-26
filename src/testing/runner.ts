import { sleep, log, warn } from '../core/helpers';
import { tracker } from './tracker';
import { runAssert } from './assertion';
import { resolveVariables, resolveActionVariables } from './variables';
import { captureScreenshot } from './screenshot';
import { callCleanupFunction } from './cleanup';
import { waitForElement, executeStepAction, describeStepFailure } from '../teaching/player';
import type { TestSuite, TestCase, TestAction, CaseResult, StepResult } from './types';
import type { RecordingStep as PlayerStep } from '../teaching/store';

export type RunnerStatusFn = (msg: string) => void;

// ── Cancellation ──
// A running suite polls this flag between steps/cases so a remote "abort" command
// can stop it mid-flight instead of the loop running to completion. Reset at the
// start of every runSuite so a stale abort never kills the next run.
let cancelRequested = false;
let running = false;

export function cancelRun(): void { if (running) cancelRequested = true; }
export function wasCancelled(): boolean { return cancelRequested; }

function toPlayerStep(action: TestAction): PlayerStep {
  return {
    type: action.action as PlayerStep['type'],
    locators: action.locators ?? [],
    tag: action.tag ?? '',
    textHint: action.textHint,
    value: action.value,
    url: action.url,
    delay: 0,
    scrollX: action.scrollX,
    scrollY: action.scrollY,
  };
}

async function runAction(action: TestAction, vars: Record<string, string>, stepIndex: number): Promise<StepResult> {
  const start = Date.now();
  const resolved = resolveActionVariables(action, vars);
  tracker.setStepIndex(stepIndex);

  try {
    switch (resolved.action) {
      case 'assert': {
        const result = await runAssert(resolved);
        return {
          action: `assert:${resolved.assertType}`,
          status: result.passed ? 'ok' : 'fail',
          duration: Date.now() - start,
          detail: result.passed ? undefined : `expected: ${resolved.expected}, actual: ${result.actual}. ${result.detail ?? ''}`.trim(),
        };
      }

      case 'wait':
        await sleep(resolved.delay ?? 1000);
        return { action: 'wait', status: 'ok', duration: Date.now() - start };

      case 'call':
        await callCleanupFunction(resolved.fn!, resolved.args);
        return { action: `call:${resolved.fn}`, status: 'ok', duration: Date.now() - start };

      case 'screenshot':
        await captureScreenshot();
        return { action: 'screenshot', status: 'ok', duration: Date.now() - start };

      default: {
        const step = toPlayerStep(resolved);
        const ok = await executeStepAction(step);
        return {
          action: resolved.action,
          status: ok ? 'ok' : 'fail',
          duration: Date.now() - start,
          detail: ok ? undefined : describeStepFailure(step),
        };
      }
    }
  } catch (e) {
    return { action: resolved.action, status: 'fail', duration: Date.now() - start, detail: String(e) };
  }
}

async function runActions(
  actions: TestAction[],
  vars: Record<string, string>,
  startIndex: number,
): Promise<{ steps: StepResult[]; failed: boolean; failedStep?: number; cancelled?: boolean }> {
  const steps: StepResult[] = [];
  for (let i = 0; i < actions.length; i++) {
    if (cancelRequested) return { steps, failed: true, failedStep: startIndex + i, cancelled: true };
    const result = await runAction(actions[i], vars, startIndex + i);
    steps.push(result);
    if (result.status === 'fail') return { steps, failed: true, failedStep: startIndex + i };
    await sleep(300);
  }
  return { steps, failed: false };
}

async function runCase(testCase: TestCase, statusFn?: RunnerStatusFn): Promise<CaseResult> {
  const start = Date.now();
  const vars = { ...(testCase.variables ?? {}) };
  for (const [k, v] of Object.entries(vars)) vars[k] = resolveVariables(v, vars);

  const allSteps: StepResult[] = [];
  let caseStatus: 'passed' | 'failed' = 'passed';
  let failedStep: number | undefined;
  let error: string | undefined;
  let screenshot: string | null = null;

  tracker.clear();

  if (testCase.setup?.length) {
    statusFn?.(`[${testCase.name}] setup...`);
    const r = await runActions(testCase.setup, vars, 0);
    allSteps.push(...r.steps);
    if (r.failed) {
      caseStatus = 'failed';
      failedStep = r.failedStep;
      error = r.cancelled ? '已手动终止' : `setup failed at step ${r.failedStep}`;
    }
  }

  if (caseStatus === 'passed') {
    statusFn?.(`[${testCase.name}] running...`);
    const offset = testCase.setup?.length ?? 0;
    const r = await runActions(testCase.steps, vars, offset);
    allSteps.push(...r.steps);
    if (r.failed) {
      caseStatus = 'failed';
      failedStep = r.failedStep;
      if (r.cancelled) {
        error = '已手动终止';
      } else {
        error = r.steps.find(s => s.status === 'fail')?.detail;
        screenshot = await captureScreenshot();
      }
    }
  }

  if (testCase.teardown?.length && (caseStatus === 'passed' || testCase.teardownOnFail !== false)) {
    statusFn?.(`[${testCase.name}] teardown...`);
    try {
      const offset = (testCase.setup?.length ?? 0) + testCase.steps.length;
      await runActions(testCase.teardown, vars, offset);
    } catch (e) {
      warn('teardown error (ignored):', e);
    }
  }

  return {
    name: testCase.name,
    tags: testCase.tags ?? [],
    status: caseStatus,
    duration: Date.now() - start,
    steps: allSteps,
    failedStep,
    error,
    screenshot: screenshot ?? undefined,
    trackedEvents: tracker.getEvents(),
  };
}

export async function runSuite(suite: TestSuite, statusFn?: RunnerStatusFn): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  cancelRequested = false;
  running = true;

  try {
    if (suite.globalSetup?.length) {
      statusFn?.('globalSetup...');
      const r = await runActions(suite.globalSetup, {}, 0);
      if (r.failed) {
        warn(r.cancelled ? 'globalSetup aborted' : 'globalSetup failed, aborting suite');
        return results;
      }
    }

    for (let i = 0; i < suite.cases.length; i++) {
      if (cancelRequested) { log('Suite aborted by request'); break; }
      const tc = suite.cases[i];
      statusFn?.(`(${i + 1}/${suite.cases.length}) ${tc.name}`);
      const result = await runCase(tc, statusFn);
      results.push(result);
      log(`[${result.status}] ${tc.name} (${result.duration}ms)`);
    }

    if (suite.globalTeardown?.length && !cancelRequested) {
      statusFn?.('globalTeardown...');
      try {
        await runActions(suite.globalTeardown, {}, 0);
      } catch (e) {
        warn('globalTeardown error (ignored):', e);
      }
    }

    return results;
  } finally {
    running = false;
  }
}
