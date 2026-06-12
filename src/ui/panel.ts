import { log } from '../core/helpers';
import { CFG, saveCfg, getAuth, getToken, isInApp } from '../core/config';
import { finishTaskViaDebug } from '../core/tasks';
import { triggerMockCall } from '../core/mockCall';
import { autoPost } from '../core/post';
import {
  stepDeleteAccount, stepQuickLogin, stepOnboarding, stepStage1Cashout,
  stepStage2, stepStage3, stepStage4, stepStage5,
  runS1, resumeS1,
  type StatusFn, type DisableAllFn,
} from '../stages';
import { createTeachingUI } from '../teaching/ui';
import { CSS } from './styles';

let panelEl: HTMLElement | null = null;
let fabEl: HTMLElement | null = null;
let expanded = false;

function makeDraggable(fab: HTMLElement, panel: HTMLElement) {
  let startX = 0, startY = 0, fabX = 0, fabY = 0, dragging = false, moved = false;

  function onStart(cx: number, cy: number) {
    dragging = true; moved = false;
    startX = cx; startY = cy;
    const rect = fab.getBoundingClientRect();
    fabX = rect.left; fabY = rect.top;
  }

  function onMove(cx: number, cy: number) {
    if (!dragging) return;
    const dx = cx - startX, dy = cy - startY;
    if (!moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    moved = true;
    const nx = Math.max(0, Math.min(window.innerWidth - 48, fabX + dx));
    const ny = Math.max(0, Math.min(window.innerHeight - 48, fabY + dy));
    fab.style.left = nx + 'px'; fab.style.top = ny + 'px';
    fab.style.right = 'auto'; fab.style.bottom = 'auto';
    updatePanelPos(panel, fab);
  }

  function onEnd() {
    dragging = false;
    if (moved) {
      const rect = fab.getBoundingClientRect();
      const midX = rect.left + 24;
      if (midX > window.innerWidth / 2) {
        fab.style.left = 'auto'; fab.style.right = '20px';
      } else {
        fab.style.left = '20px'; fab.style.right = 'auto';
      }
      updatePanelPos(panel, fab);
    }
  }

  fab.addEventListener('mousedown', (e) => { e.preventDefault(); onStart(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => onMove(e.clientX, e.clientY));
  window.addEventListener('mouseup', () => { if (dragging) { onEnd(); } });

  fab.addEventListener('touchstart', (e) => { const t = e.touches[0]; onStart(t.clientX, t.clientY); }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (dragging) { const t = e.touches[0]; onMove(t.clientX, t.clientY); } }, { passive: false });
  window.addEventListener('touchend', () => { if (dragging) { onEnd(); } });

  fab.addEventListener('click', (e) => { if (moved) { e.stopImmediatePropagation(); moved = false; } }, { capture: true });
}

function updatePanelPos(panel: HTMLElement, fab: HTMLElement) {
  const rect = fab.getBoundingClientRect();
  const fabCenterX = rect.left + 24;
  const isRight = fabCenterX > window.innerWidth / 2;
  const isBottom = rect.top > window.innerHeight / 2;

  panel.style.left = isRight ? 'auto' : '20px';
  panel.style.right = isRight ? '20px' : 'auto';

  if (isBottom) {
    panel.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
    panel.style.top = 'auto';
    panel.style.transformOrigin = isRight ? 'bottom right' : 'bottom left';
  } else {
    panel.style.top = (rect.bottom + 10) + 'px';
    panel.style.bottom = 'auto';
    panel.style.transformOrigin = isRight ? 'top right' : 'top left';
  }
}

export const st: StatusFn = (key, state, msg) => {
  if (!panelEl) return;
  const el = panelEl.querySelector(`#st-${key}`);
  if (el) { el.textContent = msg; el.className = `st ${state}`; }
  log(`[${key}] ${msg}`);
};

export const disableAll: DisableAllFn = (v) => {
  if (!panelEl) return;
  panelEl.querySelectorAll('.row button').forEach((b) => (b as HTMLButtonElement).disabled = v);
};

function togglePanel() {
  expanded = !expanded;
  panelEl!.classList.toggle('open', expanded);
  fabEl!.textContent = expanded ? '✕' : '⚡';
}

function refreshInfo() {
  if (!panelEl) return;
  const el = panelEl.querySelector('#user-info');
  if (!el) return;
  const s = getAuth();
  if (s?.userInfo) el.innerHTML = `<b>ID:</b> ${s.userInfo.userId || '?'} | ${s.userInfo.username || '-'} | ${s.userState || '?'} | ${isInApp() ? 'APP' : 'H5'}`;
  else el.innerHTML = getToken() ? `Token 存在 | ${isInApp() ? 'APP' : 'H5'}` : '<b>未登录</b>';
}

function grpHTML(id: string, title: string, contentHTML: string, openDefault = false) {
  return `<div class="grp" id="grp-${id}">
    <div class="grp-hdr" data-grp="${id}"><span>${title}</span><span class="arr ${openDefault ? 'open' : ''}">▶</span></div>
    <div class="grp-body ${openDefault ? 'open' : ''}"><div class="inner">${contentHTML}</div></div>
  </div>`;
}

export function createPanel() {
  if (document.getElementById('autobot-fab')) return;
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

  fabEl = document.createElement('button'); fabEl.id = 'autobot-fab'; fabEl.textContent = '⚡';
  fabEl.addEventListener('click', togglePanel); document.body.appendChild(fabEl);

  const p = document.createElement('div'); p.id = 'autobot-panel';
  makeDraggable(fabEl, p);
  p.innerHTML = `
    <div class="hdr"><h3>AutoBot v4</h3><button class="cb" id="btn-close">✕</button></div>
    <div class="body">
      <div class="info" id="user-info">...</div>

      ${grpHTML('cfg', '⚙ 配置', `
        <div class="cfg">
          <label>用户名 (留空随机)</label><input id="cfg-username" value="${CFG.username}">
          <label>年龄</label><input type="number" id="cfg-age" value="${CFG.age}">
          <label>PayPal 邮箱</label><input id="cfg-paypal" value="${CFG.paypalEmail}">
          <label>头像 URL</label><input id="cfg-photo" value="${CFG.photoUrl}">
          <label>Mock 单价 ($/min)</label><input id="cfg-price" value="${CFG.mockPrice}">
        </div>
      `)}

      ${grpHTML('s1', 'Stage 1 — 注销 → 注册 → $0.50', `
        <div class="row"><button id="btn-del">注销账号</button><span class="st" id="st-s1">待执行</span></div>
        <div class="row"><button id="btn-login">快速登录</button></div>
        <div class="row"><button id="btn-onboard">完成注册</button></div>
        <div class="row"><button id="btn-cashout1">提现 $0.50</button></div>
        <div class="row"><button id="btn-s1-all" class="accent">一键 Stage 1</button></div>
      `, true)}

      ${grpHTML('s2', 'Stage 2 — 任务 + Mock → $7.00', `
        <div class="row"><button id="btn-s2">一键 Stage 2</button><span class="st" id="st-s2">待执行</span></div>
      `)}

      ${grpHTML('s3', 'Stage 3 — Mock → $8.00', `
        <div class="row"><button id="btn-s3">一键 Stage 3</button><span class="st" id="st-s3">待执行</span></div>
      `)}

      ${grpHTML('s4', 'Stage 4 — Mock → $12.00', `
        <div class="row"><button id="btn-s4">一键 Stage 4</button><span class="st" id="st-s4">待执行</span></div>
      `)}

      ${grpHTML('s5', 'Stage 5 — Mock → $25.00', `
        <div class="row"><button id="btn-s5">一键 Stage 5</button><span class="st" id="st-s5">待执行</span></div>
      `)}

      ${grpHTML('tools', '🛠 工具', `
        <div class="row"><button id="btn-post" class="wide">自动发帖</button><span class="st" id="st-post">—</span></div>
        <div class="row"><button id="btn-mock" class="wide">触发 Mock Call</button><span class="st" id="st-mock">—</span></div>
        <div class="row">
          <button id="btn-mock-off" class="wide warn">关闭 Mock 视频</button>
          <button id="btn-mock-on" class="wide green">开启 Mock 视频</button>
        </div>
        <div class="row"><button id="btn-task" class="wide">完成指定任务</button><select id="cfg-taskid" style="width:140px;padding:5px;background:#0f3460;border:1px solid #444;border-radius:5px;color:#eee;font-size:10px">
          <option value="">-- 选择任务 --</option>
          <option value="101">101 Register</option>
          <option value="102">102 Camera</option>
          <option value="103">103 Microphone</option>
          <option value="105">105 Location</option>
          <option value="135">135 Location App</option>
          <option value="112">112 Install APK</option>
          <option value="118">118 Face Verify</option>
          <option value="110">110 Bind Instagram</option>
          <option value="107">107 Notification</option>
          <option value="132">132 First Post</option>
          <option value="200001">200001 SecondEarn</option>
          <option value="200002">200002 ThirdEarn</option>
          <option value="200003">200003 FourthEarn</option>
          <option value="200004">200004 FifthEarn</option>
          <option value="200005">200005 SixthEarn</option>
          <option value="200006">200006 SeventhEarn</option>
          <option value="200010">200010 4th Duration</option>
          <option value="200011">200011 5th Duration</option>
          <option value="200012">200012 6th Duration</option>
          <option value="200013">200013 7th Duration</option>
        </select></div>
      `)}

      <div id="teaching-section"></div>
    </div>
  `;
  document.body.appendChild(p); panelEl = p;

  // Group toggle
  p.querySelectorAll('.grp-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling as HTMLElement;
      const arr = hdr.querySelector('.arr') as HTMLElement;
      body.classList.toggle('open'); arr.classList.toggle('open');
    });
  });

  p.querySelector('#btn-close')!.addEventListener('click', togglePanel);

  // Config bindings
  const bind = (id: string, key: keyof typeof CFG) =>
    p.querySelector(id)!.addEventListener('input', (e) => {
      (CFG as any)[key] = (e.target as HTMLInputElement).value.trim(); saveCfg();
    });
  bind('#cfg-username', 'username'); bind('#cfg-age', 'age'); bind('#cfg-paypal', 'paypalEmail');
  bind('#cfg-photo', 'photoUrl'); bind('#cfg-price', 'mockPrice');

  // Stage 1
  p.querySelector('#btn-del')!.addEventListener('click', () => stepDeleteAccount(st));
  p.querySelector('#btn-login')!.addEventListener('click', () => stepQuickLogin(st));
  p.querySelector('#btn-onboard')!.addEventListener('click', () => stepOnboarding(st));
  p.querySelector('#btn-cashout1')!.addEventListener('click', () => stepStage1Cashout(st));
  p.querySelector('#btn-s1-all')!.addEventListener('click', () => runS1(st, disableAll));

  // Stage 2-5
  p.querySelector('#btn-s2')!.addEventListener('click', () => stepStage2(st));
  p.querySelector('#btn-s3')!.addEventListener('click', () => stepStage3(st));
  p.querySelector('#btn-s4')!.addEventListener('click', () => stepStage4(st));
  p.querySelector('#btn-s5')!.addEventListener('click', () => stepStage5(st));

  // Tools
  p.querySelector('#btn-post')!.addEventListener('click', () => autoPost((msg) => st('post', 'running', msg)));
  p.querySelector('#btn-mock')!.addEventListener('click', () => triggerMockCall());
  p.querySelector('#btn-mock-off')!.addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '1'); alert('Mock 视频已关闭'); });
  p.querySelector('#btn-mock-on')!.addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '0'); alert('Mock 视频已开启'); });
  p.querySelector('#btn-task')!.addEventListener('click', () => {
    const id = (p.querySelector('#cfg-taskid') as HTMLSelectElement).value.trim();
    if (id) finishTaskViaDebug(Number(id));
  });

  // Teaching mode
  createTeachingUI(p.querySelector('#teaching-section')!);

  refreshInfo(); setInterval(refreshInfo, 3000);
  resumeS1(st, disableAll);
}
