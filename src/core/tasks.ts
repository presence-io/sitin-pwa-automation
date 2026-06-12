import { log, warn, sleep, setNativeValue, findBtn, spaNav, dismissModals } from '../core/helpers';
import { isInApp } from '../core/config';

export async function finishTaskViaDebug(taskId: number): Promise<boolean> {
  log('finishTask:', taskId);
  if (!location.pathname.includes('/debug')) { spaNav('/debug'); await sleep(1500); }
  let input: HTMLInputElement | null = null;
  for (let i = 0; i < 10; i++) {
    const inputs = [...document.querySelectorAll('input[placeholder*="Task ID"], input[placeholder*="task"]')] as HTMLInputElement[];
    input = inputs.find(inp => inp.offsetParent !== null) || null;
    if (input) break;
    await sleep(500);
  }
  if (!input) { warn('Task ID input not found'); return false; }
  setNativeValue(input, String(taskId));
  await sleep(300);
  const btn = findBtn(['完成任务']);
  if (!btn) { warn('完成任务 button not found'); return false; }
  btn.click();
  await sleep(2000);
  await dismissModals();
  log('finishTask done:', taskId);
  return true;
}

export async function finishTasks(ids: number[]) {
  for (const id of ids) {
    const ok = await finishTaskViaDebug(id);
    if (!ok) warn('finishTask failed for', id);
    await sleep(500);
  }
}

async function clickHomeTask(taskText: string): Promise<boolean> {
  spaNav('/'); await sleep(1500);
  const divs = document.querySelectorAll('div[class*="flex items-center gap-1.5"]');
  for (const div of divs) {
    if (div.textContent?.includes(taskText) && (div as HTMLElement).offsetParent) {
      log('Clicking home task:', taskText);
      (div as HTMLElement).click();
      await sleep(2000);
      await dismissModals();
      return true;
    }
  }
  warn('Home task not found:', taskText);
  return false;
}

export async function completeTask(taskId: number, homeTaskText?: string): Promise<boolean> {
  if (isInApp() && homeTaskText) {
    return await clickHomeTask(homeTaskText);
  }
  return await finishTaskViaDebug(taskId);
}
