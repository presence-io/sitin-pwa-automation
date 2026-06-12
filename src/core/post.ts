import { log, sleep, findBtn, spaNav, setNativeValue, fetchImageAsFile, injectFile, dismissModals } from '../core/helpers';
import { CFG } from '../core/config';

export async function autoPost(statusFn?: (msg: string) => void) {
  statusFn?.('Posting...');
  spaNav('/createPost'); await sleep(2000);
  let file: File | undefined;
  try { file = await fetchImageAsFile(CFG.photoUrl); } catch { /* ignore */ }
  if (file) {
    const fileInput = document.querySelector('input[type="file"][accept*="image"]') as HTMLInputElement | null;
    if (fileInput) { injectFile(fileInput, file); await sleep(3000); }
  }
  await sleep(2000);
  const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null;
  if (textarea && !textarea.value.trim()) {
    setNativeValue(textarea as unknown as HTMLInputElement, 'Having a great day! ✨');
    await sleep(300);
  }
  const postBtn = findBtn(['post']);
  if (postBtn) {
    postBtn.click();
    await sleep(3000);
    statusFn?.('Post done ✓');
  } else {
    statusFn?.('Post button not found');
  }
}
