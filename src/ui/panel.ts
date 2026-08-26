import { log } from '../core/helpers';
import { getActivePlugin } from '../plugins/registry';
import type { StatusFn, DisableAllFn } from '../plugins/types';
import { createTeachingUI } from '../teaching/ui';
import { createTestingUI } from '../testing/ui';
import { onConn, onLog, getLogs, type ConnState, type LogLine } from '../core/bus';
import { configManager } from '../testing/config';
import { fbPatch } from '../shared/firebase';
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
  const meta = panelEl.querySelector('#conn-meta');
  if (meta) {
    const id = localStorage.getItem('autobot_device_id') || '?';
    const label = localStorage.getItem('autobot_device_label') || '';
    meta.textContent = `${configManager.getProject() ?? getActivePlugin().id} · ${label || id}`;
  }
  const el = panelEl.querySelector('#user-info');
  if (!el) return;
  // The identity line (login state etc.) is app-specific — the active plugin owns it.
  el.innerHTML = getActivePlugin().identityHtml?.() ?? '';
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

  const plugin = getActivePlugin();
  const p = document.createElement('div'); p.id = 'autobot-panel';
  makeDraggable(fabEl, p);
  p.innerHTML = `
    <div class="hdr"><h3>${plugin.panelTitle ?? 'AutoBot v4'}</h3><button class="cb" id="btn-close">✕</button></div>
    <div class="body">
      <div class="info" id="user-info">...</div>

      <div class="conn-line">
        <span class="conn-dot" id="conn-dot"></span>
        <span id="conn-text">连接中…</span>
        <span class="conn-meta" id="conn-meta"></span>
      </div>

      ${grpHTML('log', '📡 运行日志', `<div class="ablog" id="ab-log"></div>`, true)}

      <div id="plugin-section"></div>

      <div id="teaching-section"></div>
      <div id="testing-section"></div>
    </div>
  `;
  document.body.appendChild(p); panelEl = p;

  // Group toggle (covers the generic log group; each mounted section self-wires its own)
  p.querySelectorAll('.grp-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling as HTMLElement;
      const arr = hdr.querySelector('.arr') as HTMLElement;
      body.classList.toggle('open'); arr.classList.toggle('open');
    });
  });

  p.querySelector('#btn-close')!.addEventListener('click', togglePanel);

  // Click the connection meta line to name this device (surfaced in the dashboard
  // so devices aren't just random ids like "iPhone-a3f2").
  const connMeta = p.querySelector('#conn-meta') as HTMLElement;
  if (connMeta) {
    connMeta.style.cursor = 'pointer';
    connMeta.title = '点击给这台设备起名';
    connMeta.addEventListener('click', () => {
      const id = localStorage.getItem('autobot_device_id') || '';
      const cur = localStorage.getItem('autobot_device_label') || '';
      const name = prompt('给这台设备起个名字（方便在控制台识别）', cur);
      if (name === null) return;
      const v = name.trim();
      if (v) localStorage.setItem('autobot_device_label', v);
      else localStorage.removeItem('autobot_device_label');
      if (id) fbPatch(`devices/${id}`, { label: v }).catch(() => {});
      refreshInfo();
    });
  }

  // App-specific sections (config, quick flows, tools) — drawn by the active plugin.
  plugin.mountPanel?.({ container: p.querySelector('#plugin-section')!, st, disableAll });

  // Teaching mode
  createTeachingUI(p.querySelector('#teaching-section')!);

  // Testing mode
  createTestingUI(p.querySelector('#testing-section')!);

  // Connection status + log mirror
  const connDot = p.querySelector('#conn-dot') as HTMLElement;
  const connText = p.querySelector('#conn-text') as HTMLElement;
  const logBox = p.querySelector('#ab-log') as HTMLElement;
  const CONN_LABEL: Record<ConnState, string> = {
    connecting: '连接中…', online: '在线', reconnecting: '重连中…', error: '连接失败',
  };
  onConn((s) => {
    connDot.className = `conn-dot ${s}`;
    connText.textContent = CONN_LABEL[s];
    fabEl!.className = s === 'connecting' ? '' : s;
  });
  const renderLog = (l: LogLine) => {
    const d = document.createElement('div');
    d.className = `logln ${l.level}`;
    d.textContent = `${new Date(l.t).toTimeString().slice(0, 8)} ${l.msg}`;
    logBox.appendChild(d);
    while (logBox.childElementCount > 200) logBox.removeChild(logBox.firstChild!);
    logBox.scrollTop = logBox.scrollHeight;
  };
  getLogs().forEach(renderLog);
  onLog(renderLog);

  refreshInfo(); setInterval(refreshInfo, 3000);
}
