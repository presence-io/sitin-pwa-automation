import { log, warn } from '../core/helpers';
import { Recorder, type AssertStep } from './recorder';
import { Player } from './player';
import {
  saveRecording, getAllRecordings, deleteRecording, exportRecordingsJSON, importAndSaveJSON,
  type Recording, type RecordingStep,
} from './store';
import { saveLocalSuite } from '../testing/repository';
import { tracker } from '../testing/tracker';
import type { TestSuite, TestAction } from '../testing/types';

const recorder = new Recorder();
const player = new Player();

function escHTML(s: string) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function grpHTML(id: string, title: string, contentHTML: string, openDefault = false) {
  return `<div class="grp" id="grp-${id}">
    <div class="grp-hdr" data-grp="${id}"><span>${title}</span><span class="arr ${openDefault ? 'open' : ''}">▶</span></div>
    <div class="grp-body ${openDefault ? 'open' : ''}"><div class="inner">${contentHTML}</div></div>
  </div>`;
}

let minibar: HTMLElement | null = null;

function getOrCreateMinibar(): HTMLElement {
  if (minibar) return minibar;
  minibar = document.createElement('div');
  minibar.id = 'autobot-minibar';
  minibar.innerHTML = `<span class="dot"></span><span class="label"></span>`;
  document.body.appendChild(minibar);
  return minibar;
}

function showMinibar(mode: 'recording' | 'playing') {
  const bar = getOrCreateMinibar();
  bar.className = mode === 'playing' ? 'show playing' : 'show';
  return bar;
}

function hideMinibar() {
  if (minibar) { minibar.className = ''; minibar.innerHTML = `<span class="dot"></span><span class="label"></span>`; }
  const fab = document.getElementById('autobot-fab');
  if (fab) fab.style.display = 'flex';
}

function collapsePanel() {
  const panel = document.getElementById('autobot-panel');
  const fab = document.getElementById('autobot-fab');
  if (panel?.classList.contains('open')) {
    panel.classList.remove('open');
  }
  if (fab) fab.style.display = 'none';
}

export function createTeachingUI(container: Element) {
  container.innerHTML = grpHTML('teach', '📹 教学模式', `
    <div class="row">
      <button id="btn-rec-start" class="wide green">开始录制</button>
      <button id="btn-rec-stop" class="wide warn" disabled>停止录制</button>
    </div>
    <div class="row"><span class="st" id="st-rec">未录制</span></div>
    <div style="margin-top:4px;border-top:1px solid #333;padding-top:4px">
      <div style="font-size:10px;color:#888;margin-bottom:3px">已保存:</div>
      <div id="rec-saved-list"></div>
    </div>
    <div class="row" style="margin-top:4px">
      <button id="btn-rec-import" class="wide">导入</button>
      <button id="btn-rec-export" class="wide">导出全部</button>
    </div>
    <input type="file" id="rec-file-input" accept=".json" style="display:none">
  `);

  container.querySelectorAll('.grp-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling as HTMLElement;
      const arr = hdr.querySelector('.arr') as HTMLElement;
      body.classList.toggle('open'); arr.classList.toggle('open');
    });
  });

  const stRec = container.querySelector('#st-rec') as HTMLElement;
  const savedList = container.querySelector('#rec-saved-list') as HTMLElement;
  const btnStart = container.querySelector('#btn-rec-start') as HTMLButtonElement;
  const btnStop = container.querySelector('#btn-rec-stop') as HTMLButtonElement;
  const btnImport = container.querySelector('#btn-rec-import') as HTMLButtonElement;
  const btnExport = container.querySelector('#btn-rec-export') as HTMLButtonElement;
  const fileInput = container.querySelector('#rec-file-input') as HTMLInputElement;

  function updateRecStatus(msg: string) { stRec.textContent = msg; }

  function updateMinibarLabel(text: string) {
    if (minibar) {
      const label = minibar.querySelector('.label');
      if (label) label.textContent = text;
    }
  }

  // ── Recording ──
  btnStart.addEventListener('click', () => {
    recorder.start((step) => {
      updateMinibarLabel(`录制中 · ${recorder.stepCount} 步`);
      updateRecStatus(`录制中 (${recorder.stepCount} 步)`);
    });
    btnStart.disabled = true;
    btnStop.disabled = false;
    updateRecStatus('录制中 (0 步)');

    collapsePanel();
    const bar = showMinibar('recording');
    updateMinibarLabel('录制中 · 0 步');

    const assertBtn = document.createElement('button');
    assertBtn.className = 'btn-pause'; assertBtn.textContent = '+断言';
    assertBtn.addEventListener('click', () => showAssertPopup(bar));
    bar.appendChild(assertBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn-stop'; stopBtn.textContent = '停止';
    stopBtn.addEventListener('click', () => btnStop.click());
    bar.appendChild(stopBtn);
  });

  btnStop.addEventListener('click', async () => {
    const steps = recorder.stop();
    btnStart.disabled = false;
    btnStop.disabled = true;
    hideMinibar();

    if (steps.length === 0) {
      updateRecStatus('未录制到任何步骤');
      return;
    }

    const name = prompt(`录制了 ${steps.length} 步，请输入流程名称:`, `流程_${new Date().toLocaleTimeString()}`);
    if (!name) { updateRecStatus('已取消保存'); return; }

    const rec: Recording = { name, steps, createdAt: Date.now(), updatedAt: Date.now() };
    await saveRecording(rec);
    updateRecStatus(`已保存: ${name} (${steps.length} 步)`);
    await refreshSavedList();
  });

  // ── Playback ──
  async function startPlayback(rec: Recording) {
    if (player.isPlaying) { player.stop(); hideMinibar(); return; }

    collapsePanel();
    const bar = showMinibar('playing');
    updateMinibarLabel(`回放: ${rec.name}...`);

    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'btn-pause'; pauseBtn.textContent = '暂停';
    pauseBtn.addEventListener('click', () => {
      if (player.isPaused) { player.resume(); pauseBtn.textContent = '暂停'; pauseBtn.className = 'btn-pause'; }
      else { player.pause(); pauseBtn.textContent = '继续'; pauseBtn.className = 'btn-resume'; }
    });
    bar.appendChild(pauseBtn);

    const stopBtn = document.createElement('button');
    stopBtn.className = 'btn-stop'; stopBtn.textContent = '终止';
    stopBtn.addEventListener('click', () => player.stop());
    bar.appendChild(stopBtn);

    updateRecStatus(`回放: ${rec.name}...`);
    const ok = await player.play(rec.steps, (msg) => {
      updateRecStatus(msg);
      updateMinibarLabel(msg);
    });
    hideMinibar();
    if (ok) updateRecStatus(`回放完成: ${rec.name} ✓`);
  }

  // ── Import / Export ──
  btnImport.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const count = await importAndSaveJSON(text);
      updateRecStatus(`导入成功: ${count} 条`);
      await refreshSavedList();
    } catch (e) {
      warn('Import failed:', e);
      updateRecStatus('导入失败: 格式错误');
    }
    fileInput.value = '';
  });

  btnExport.addEventListener('click', async () => {
    const all = await getAllRecordings();
    if (all.length === 0) { updateRecStatus('无可导出流程'); return; }
    const json = exportRecordingsJSON(all);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `autobot_recordings_${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
    updateRecStatus(`已导出 ${all.length} 条`);
  });

  // ── Assert popup during recording ──
  function showAssertPopup(bar: HTMLElement) {
    let popup = document.getElementById('autobot-assert-popup');
    if (popup) { popup.remove(); return; }

    popup = document.createElement('div');
    popup.id = 'autobot-assert-popup';
    popup.style.cssText = 'position:fixed;top:36px;left:50%;transform:translateX(-50%);background:#1a1a2e;border:1px solid #00bcd4;border-radius:8px;padding:10px;z-index:999999;font-family:-apple-system,sans-serif;font-size:12px;color:#eee;box-shadow:0 4px 16px rgba(0,0,0,.4);min-width:240px';

    const currentUrl = location.pathname + location.search;
    const bodyText = document.body.innerText.slice(0, 500);
    const events = tracker.getEvents();
    const recentEvents = events.slice(-10);

    popup.innerHTML = `
      <div style="font-weight:600;margin-bottom:8px;color:#00bcd4">插入断言</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button data-assert="url" style="text-align:left;padding:6px 8px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#eee;cursor:pointer;font-size:11px">
          🔗 URL 包含 <span style="color:#888">${escHTML(currentUrl)}</span>
        </button>
        <button data-assert="text-prompt" style="text-align:left;padding:6px 8px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#eee;cursor:pointer;font-size:11px">
          📝 文案存在（手动输入）
        </button>
        <button data-assert="text-not" style="text-align:left;padding:6px 8px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#eee;cursor:pointer;font-size:11px">
          🚫 文案不存在（手动输入）
        </button>
        ${recentEvents.length > 0 ? `
          <div style="font-size:10px;color:#888;margin-top:4px;border-top:1px solid #333;padding-top:4px">最近埋点事件:</div>
          ${recentEvents.map(ev => `
            <button data-assert="event" data-sdk="${escHTML(ev.sdk)}" data-event="${escHTML(ev.event)}" style="text-align:left;padding:6px 8px;background:#0f3460;border:1px solid #444;border-radius:4px;color:#eee;cursor:pointer;font-size:11px">
              📊 ${escHTML(ev.sdk)}: <span style="color:#ffeb3b">${escHTML(ev.event)}</span>
            </button>
          `).join('')}
        ` : '<div style="font-size:10px;color:#666;margin-top:4px">暂无埋点事件</div>'}
      </div>
      <button id="assert-popup-close" style="margin-top:8px;padding:4px 8px;background:none;border:1px solid #444;border-radius:4px;color:#888;cursor:pointer;font-size:10px;width:100%">取消</button>
    `;

    document.body.appendChild(popup);

    popup.querySelector('#assert-popup-close')!.addEventListener('click', () => popup!.remove());

    popup.querySelectorAll('[data-assert]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = (btn as HTMLElement).dataset.assert!;
        let assert: AssertStep | null = null;

        if (type === 'url') {
          assert = { type: 'assert', assertType: 'url', expected: currentUrl };
        } else if (type === 'text-prompt') {
          const text = prompt('输入期望存在的文案:');
          if (text) assert = { type: 'assert', assertType: 'textExists', expected: text };
        } else if (type === 'text-not') {
          const text = prompt('输入不应出现的文案:');
          if (text) assert = { type: 'assert', assertType: 'textNotExists', expected: text };
        } else if (type === 'event') {
          const sdk = (btn as HTMLElement).dataset.sdk!;
          const event = (btn as HTMLElement).dataset.event!;
          assert = { type: 'assert', assertType: 'eventFired', sdk, event };
        }

        if (assert) {
          recorder.insertAssert(assert);
          updateMinibarLabel(`录制中 · ${recorder.stepCount} 步 (含断言)`);
          log('Assert inserted:', assert.assertType, assert.expected || assert.event || '');
        }
        popup!.remove();
      });
    });
  }

  // ── Saved list ──
  async function refreshSavedList() {
    const all = await getAllRecordings();
    if (all.length === 0) { savedList.innerHTML = '<div style="font-size:10px;color:#666">暂无</div>'; return; }
    savedList.innerHTML = all.map(rec => `
      <div class="saved-item" data-name="${escHTML(rec.name)}">
        <span class="name">${escHTML(rec.name)} (${rec.steps.length}步)</span>
        <button class="green btn-play" title="Play">▶</button>
        <button class="btn-to-test" title="Convert to test case">🧪</button>
        <button class="btn-export-one" title="Download">↓</button>
        <button class="warn btn-del" title="Delete">✕</button>
      </div>
    `).join('');

    savedList.querySelectorAll('.saved-item').forEach(item => {
      const name = item.getAttribute('data-name')!;

      item.querySelector('.btn-play')!.addEventListener('click', async () => {
        const rec = all.find(r => r.name === name);
        if (rec) await startPlayback(rec);
      });

      item.querySelector('.btn-to-test')!.addEventListener('click', async () => {
        const rec = all.find(r => r.name === name);
        if (!rec) return;
        const suite = recordingToTestSuite(rec);
        await saveLocalSuite(suite);
        updateRecStatus(`已转为测试用例: ${suite.name}`);
        log('Converted to test suite:', suite.name);
      });

      item.querySelector('.btn-export-one')!.addEventListener('click', () => {
        const rec = all.find(r => r.name === name);
        if (!rec) return;
        const json = exportRecordingsJSON([rec]);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.json`;
        a.click(); URL.revokeObjectURL(url);
      });

      item.querySelector('.btn-del')!.addEventListener('click', async () => {
        if (!confirm(`删除 "${name}"?`)) return;
        await deleteRecording(name);
        await refreshSavedList();
        updateRecStatus(`已删除: ${name}`);
      });
    });
  }

  function recordingToTestSuite(rec: Recording): TestSuite {
    const steps: TestAction[] = rec.steps.map(s => {
      if (s.type === 'assert') {
        return {
          action: 'assert' as const,
          assertType: s.assertType as any,
          expected: s.expected,
          sdk: s.sdk,
          event: s.event,
          timeout: 5000,
        };
      }
      return {
        action: s.type as TestAction['action'],
        locators: s.locators,
        tag: s.tag,
        textHint: s.textHint,
        value: s.value,
        url: s.url,
        scrollX: s.scrollX,
        scrollY: s.scrollY,
      };
    });

    // Auto-insert URL assertion after navigate steps
    const enrichedSteps: TestAction[] = [];
    for (const step of steps) {
      enrichedSteps.push(step);
      if (step.action === 'navigate' && step.url) {
        enrichedSteps.push({
          action: 'assert',
          assertType: 'url',
          expected: step.url,
          timeout: 5000,
        });
      }
    }

    return {
      name: `[test] ${rec.name}`,
      cases: [{
        name: rec.name,
        tags: ['recorded'],
        steps: enrichedSteps,
        teardownOnFail: true,
      }],
    };
  }

  refreshSavedList();
}
