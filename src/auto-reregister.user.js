// ==UserScript==
// @name         Sitin PWA AutoBot
// @namespace    https://github.com/sitin-pwa-automation
// @version      3.0.0
// @description  一键注销 → 注册 → Stage 1-5 提现 + 发帖自动化
// @match        *://pwa.aifantasy.com/*
// @match        *://pwa-staging.aifantasy.com/*
// @match        *://*.sitin.ai/*
// @match        http://localhost:3000/*
// @match        http://localhost:5173/*
// @match        http://localhost:*/*
// @match        http://127.0.0.1:*/*
// @grant        GM_addStyle
// @run-at       document-idle
// ==/UserScript==

console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'v3 entry', location.href);

(function () {
  'use strict';

  // ═══════════════════════════════════════════════
  // Config (persisted to localStorage)
  // ═══════════════════════════════════════════════
  const CFG_KEY = 'autobot_config';
  const STATE_KEY = 'autobot_run_state';

  function loadCfg() { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } }
  function saveCfg() { localStorage.setItem(CFG_KEY, JSON.stringify(CFG)); }

  const saved = loadCfg();
  const CFG = {
    username: saved.username ?? '',
    age: saved.age ?? 22,
    paypalEmail: saved.paypalEmail ?? 'autobot_test@gmail.com',
    photoUrl: saved.photoUrl ?? 'https://file.archat.us/cai/user_custom_avatar/2100048298/e41dd7af-75e5-43c4-a88f-d3521824879e.jpg',
    mockPrice: saved.mockPrice ?? '0.6',
  };

  // ═══════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...a) => console.log('%c[AutoBot]', 'color:#00bcd4;font-weight:bold', ...a);
  const warn = (...a) => console.warn('%c[AutoBot]', 'color:#ff9800;font-weight:bold', ...a);

  function randName() {
    const a = ['Happy','Lucky','Sweet','Cool','Cute','Fun','Nice','Star'];
    const b = ['Cat','Dog','Bunny','Bird','Fox','Bear','Panda','Tiger'];
    return a[Math.random()*a.length|0] + b[Math.random()*b.length|0] + ((Math.random()*9000|0)+1000);
  }

  function waitForEl(sel, ms = 10000) {
    return new Promise((ok, no) => {
      const el = document.querySelector(sel);
      if (el) return ok(el);
      const ob = new MutationObserver(() => { const e = document.querySelector(sel); if (e) { ob.disconnect(); ok(e); } });
      ob.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { ob.disconnect(); no(new Error('waitForEl: ' + sel)); }, ms);
    });
  }

  function setNativeValue(el, v) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function typeInto(el, text) {
    el.focus(); await sleep(50);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    for (const ch of text) {
      const cur = el.value || '';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, cur + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(15);
    }
  }

  function getAuth() { try { return JSON.parse(localStorage.getItem('auth-storage'))?.state || null; } catch { return null; } }
  function getToken() { return localStorage.getItem('haven_token') || ''; }
  function getUserId() { return getAuth()?.userInfo?.userId || null; }

  // Find visible button by text (exclude autobot panel)
  function findBtn(texts) {
    if (typeof texts === 'string') texts = [texts];
    for (const btn of document.querySelectorAll('button')) {
      if (btn.closest('#autobot-panel') || btn.closest('#autobot-fab')) continue;
      const t = btn.textContent?.trim().toLowerCase() || '';
      for (const text of texts) { if (t.includes(text.toLowerCase()) && !btn.disabled) return btn; }
    }
    return null;
  }

  function spaNav(path) {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  function fetchImageAsFile(url) {
    return new Promise((ok, no) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext('2d').drawImage(img, 0, 0);
        c.toBlob(b => b ? ok(new File([b], 'avatar.jpg', { type: 'image/jpeg' })) : no('toBlob failed'), 'image/jpeg', 0.92);
      };
      img.onerror = () => no('load failed: ' + url); img.src = url;
    });
  }

  function injectFile(input, file) {
    const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function dismissModals(skipCashout = false) {
    for (let r = 0; r < 6; r++) {
      const kw = ['continue earning', 'got it', 'continue', 'ok'];
      if (!skipCashout) kw.push('cash out');
      const btn = findBtn(kw);
      if (btn) { btn.click(); await sleep(1200); continue; }
      const ci = [...document.querySelectorAll('img')].find(i => i.alt?.toLowerCase().includes('close') && i.offsetParent);
      if (ci) { ci.click(); await sleep(1000); continue; }
      break;
    }
  }

  // ═══════════════════════════════════════════════
  // Core helpers: finishTask via Debug page
  // ═══════════════════════════════════════════════
  async function finishTaskViaDebug(taskId) {
    log('finishTask:', taskId);
    if (!location.pathname.includes('/debug')) { spaNav('/debug'); await sleep(1500); }
    // Find task ID input
    let input = null;
    for (let i = 0; i < 10; i++) {
      const inputs = [...document.querySelectorAll('input[placeholder*="Task ID"], input[placeholder*="task"]')];
      input = inputs.find(inp => inp.offsetParent !== null);
      if (input) break;
      await sleep(500);
    }
    if (!input) { warn('Task ID input not found'); return false; }
    setNativeValue(input, String(taskId));
    await sleep(300);
    const btn = findBtn(['完成任务']);
    if (!btn) { warn('完成任务 button not found'); return false; }
    btn.click();
    await sleep(1500);
    log('finishTask done:', taskId);
    return true;
  }

  async function finishTasks(ids) {
    for (const id of ids) {
      const ok = await finishTaskViaDebug(id);
      if (!ok) warn('finishTask failed for', id);
      await sleep(500);
    }
  }

  // ═══════════════════════════════════════════════
  // Core helper: trigger Mock Call
  // ═══════════════════════════════════════════════
  async function triggerMockCall() {
    log('triggerMockCall');
    if (!location.pathname.includes('/debug')) { spaNav('/debug'); await sleep(1500); }
    // Set price
    const priceInput = [...document.querySelectorAll('input[placeholder*="$/min"]')].find(i => i.offsetParent);
    if (priceInput) { setNativeValue(priceInput, CFG.mockPrice); await sleep(200); }
    const btn = findBtn(['normal mock']);
    if (!btn) { warn('Normal Mock button not found'); return false; }
    btn.click();
    await sleep(2000);
    // Wait for mock call to finish (page navigates to /mock-call then back)
    for (let i = 0; i < 60; i++) {
      await sleep(2000);
      if (!location.pathname.includes('/mock-call')) {
        log('Mock call finished');
        return true;
      }
    }
    warn('Mock call timeout');
    return true;
  }

  async function runMockCalls(count) {
    for (let i = 0; i < count; i++) {
      log(`Mock call ${i+1}/${count}`);
      st('mock', 'running', `Mock Call ${i+1}/${count}...`);
      await triggerMockCall();
      await sleep(1000);
    }
  }

  // ═══════════════════════════════════════════════
  // Core helper: cashout current stage
  // ═══════════════════════════════════════════════
  async function doCashout() {
    log('doCashout');
    // Check for cashout reminder modal first
    let cashBtn = findBtn(['cash out']);
    if (cashBtn) {
      cashBtn.click(); await sleep(2000);
    } else {
      spaNav('/cashout'); await sleep(2000);
      // Find exact "Cash Out" button
      for (const btn of document.querySelectorAll('button')) {
        if (btn.textContent?.trim() === 'Cash Out' && !btn.disabled && !btn.closest('#autobot-panel')) {
          btn.click(); await sleep(2000); break;
        }
      }
    }
    // Handle bind PayPal if needed
    const emailInput = [...document.querySelectorAll('input[type="email"]')].find(i => !i.closest('#autobot-panel') && i.offsetParent);
    if (emailInput) {
      await typeInto(emailInput, CFG.paypalEmail);
      await sleep(300);
      const nextBtn = findBtn(['next']); if (nextBtn) { nextBtn.click(); await sleep(3000); }
    }
    // Walk through modals (processing → success)
    for (let i = 0; i < 20; i++) {
      await sleep(1500);
      const btn = [...document.querySelectorAll('button')]
        .filter(b => !b.closest('#autobot-panel') && b.offsetParent)
        .find(b => {
          const t = b.textContent?.trim().toLowerCase() || '';
          return (t.includes('got it') || t.includes('continue earning') || t.includes('ok') || t.includes('next') || t.includes('confirm')) && !b.disabled && b.textContent?.trim() !== 'Cash Out';
        });
      if (btn) { log('Cashout modal:', btn.textContent.trim()); btn.click(); await sleep(1000); }
    }
    await dismissModals();
    spaNav('/'); await sleep(1000);
  }

  // ═══════════════════════════════════════════════
  // Core helper: auto post
  // ═══════════════════════════════════════════════
  async function autoPost() {
    st('post', 'running', '正在发帖...');
    spaNav('/createPost'); await sleep(2000);

    // Prepare image
    let file;
    try { file = await fetchImageAsFile(CFG.photoUrl); } catch { warn('Failed to fetch photo for post'); }

    if (file) {
      const fileInput = document.querySelector('input[type="file"][accept*="image"]');
      if (fileInput) { injectFile(fileInput, file); await sleep(3000); }
    }

    // Wait for AI caption or fill default text
    await sleep(2000);
    const textarea = document.querySelector('textarea');
    if (textarea && !textarea.value.trim()) {
      setNativeValue(textarea, 'Having a great day! ✨');
      await sleep(300);
    }

    // Click Post button
    const postBtn = findBtn(['post']);
    if (postBtn) {
      postBtn.click();
      await sleep(3000);
      st('post', 'done', '发帖完成 ✓');
    } else {
      st('post', 'error', '找不到 Post 按钮');
    }
  }

  // ═══════════════════════════════════════════════
  // Stage step functions
  // ═══════════════════════════════════════════════

  // Stage 1: Delete → Login → Onboarding → Cashout $0.50
  async function stepDeleteAccount() {
    st('s1', 'running', '注销账号...');
    if (!getUserId() || !getToken()) { st('s1', 'error', '未登录'); return false; }
    spaNav('/debug'); await sleep(1500);
    let btn = null;
    for (let i = 0; i < 10; i++) { btn = findBtn('删除账户'); if (btn) break; await sleep(500); }
    if (!btn) { st('s1', 'error', '找不到删除按钮'); return false; }
    const orig = window.confirm; window.confirm = () => true;
    btn.click(); await sleep(3000); window.confirm = orig;
    for (let i = 0; i < 10; i++) { await sleep(500); if (location.pathname.includes('/onboarding') || !getAuth()?.token) break; }
    st('s1', 'done', '已注销 ✓'); return true;
  }

  async function stepQuickLogin() {
    st('s1', 'running', '快速登录...');
    spaNav('/onboarding'); await sleep(1500);
    let btn = null;
    for (let i = 0; i < 15; i++) { btn = findBtn('quick login'); if (btn) break; await sleep(500); }
    if (!btn) { st('s1', 'error', '找不到 Quick Login'); return false; }
    btn.click(); await sleep(1000);
    for (let i = 0; i < 20; i++) { await sleep(500); const s = getAuth(); if (s?.token && s?.userInfo) break; }
    st('s1', 'done', '已登录 ✓'); return true;
  }

  async function stepOnboarding() {
    st('s1', 'running', '注册中...');
    const s = getAuth(); if (s?.userState === 'FullRegister') { st('s1', 'done', '已注册 ✓'); return true; }
    spaNav('/onboardingcontainer'); await sleep(1500);

    // Username
    const nameInput = await waitForEl('input[type="text"]', 5000).catch(() => null);
    if (nameInput) { nameInput.focus(); setNativeValue(nameInput, CFG.username || randName()); await sleep(300); const b = findBtn(['claim']); if (b) b.click(); await sleep(3500); }

    // Age
    const ageInput = document.querySelector('input[type="number"]');
    if (ageInput) { ageInput.focus(); setNativeValue(ageInput, String(CFG.age)); await sleep(300); const b = findBtn(['claim']); if (b) b.click(); await sleep(3500); }

    // Photo
    let photoBtn = findBtn(['claim']);
    if (!photoBtn || photoBtn.disabled) {
      let file; try { file = CFG.photoUrl ? await fetchImageAsFile(CFG.photoUrl) : null; } catch {}
      if (file) {
        const fi = document.querySelector('input[type="file"][accept*="image"]');
        if (fi) { injectFile(fi, file); await sleep(2000); const crop = findBtn(['upload']); if (crop) { crop.click(); await sleep(1500); } }
      }
      // Retry claim up to 3 times
      for (let att = 0; att < 3; att++) {
        await sleep(1000); photoBtn = findBtn(['claim']);
        if (photoBtn && !photoBtn.disabled) { photoBtn.click(); break; }
        await sleep(5000);
      }
      // Wait for phone page
      for (let w = 0; w < 30; w++) {
        await sleep(1000);
        if (document.body.innerText.includes('US+1') || getAuth()?.userState === 'FullRegister') break;
      }
    } else { photoBtn.click(); await sleep(3500); }

    // Phone
    await sleep(1000);
    if (document.body.innerText.includes('US+1')) {
      const pi = document.querySelector('input[inputmode="numeric"]');
      if (pi) {
        await typeInto(pi, '2025551234'); await sleep(500);
        const nb = findBtn(['next']); if (nb) nb.click(); await sleep(2000);
        for (let i = 0; i < 10; i++) { const cb = findBtn(['confirm']); if (cb) { cb.click(); break; } await sleep(500); }
      }
    }

    // Wait
    for (let i = 0; i < 15; i++) { await sleep(1000); if (getAuth()?.userState === 'FullRegister') break; }
    await sleep(1500); await dismissModals(true);
    st('s1', 'done', '注册完成 ✓'); return true;
  }

  async function stepStage1Cashout() {
    st('s1', 'running', '提现 $0.50...');
    const s = getAuth(); if (s?.cash === 0) { spaNav('/'); st('s1', 'done', '已提现 ✓'); return true; }
    await doCashout();
    st('s1', 'done', 'Stage 1 完成 ✓'); return true;
  }

  // Stage 2: $7.00
  async function stepStage2() {
    st('s2', 'running', '完成 Stage 2 任务...');
    await finishTasks([102, 103, 105, 112, 118, 110]); // Camera, Mic, Location, APK, Face, Instagram
    st('s2', 'running', 'Mock Call 凑收益...');
    await runMockCalls(5); // 5 × $0.6 = $3.0 > $2.10
    st('s2', 'running', '提现 $7.00...');
    await sleep(2000);
    await doCashout();
    st('s2', 'done', 'Stage 2 完成 ✓'); return true;
  }

  // Stage 3: $8.00
  async function stepStage3() {
    st('s3', 'running', '完成 Stage 3 任务...');
    await finishTasks([135]); // Location App
    st('s3', 'running', 'Mock Call 凑收益...');
    await runMockCalls(15); // 15 × $0.6 = $9.0 > $8
    st('s3', 'running', '提现 $8.00...');
    await sleep(2000);
    await doCashout();
    st('s3', 'done', 'Stage 3 完成 ✓'); return true;
  }

  // Stage 4: $12.00
  async function stepStage4() {
    st('s4', 'running', 'Mock Call 凑收益...');
    await runMockCalls(18); // 18 × $0.6 = $10.8 > $10, duration also accumulates
    st('s4', 'running', '提现 $12.00...');
    await sleep(2000);
    await doCashout();
    st('s4', 'done', 'Stage 4 完成 ✓'); return true;
  }

  // Stage 5: $25.00
  async function stepStage5() {
    st('s5', 'running', 'Mock Call 凑收益...');
    await runMockCalls(35); // 35 × $0.6 = $21.0 > $20, duration also accumulates
    st('s5', 'running', '提现 $25.00...');
    await sleep(2000);
    await doCashout();
    st('s5', 'done', 'Stage 5 完成 ✓'); return true;
  }

  // ═══════════════════════════════════════════════
  // Run-all (survives reload)
  // ═══════════════════════════════════════════════
  function saveState(i) { localStorage.setItem(STATE_KEY, JSON.stringify({ step: i, ts: Date.now() })); }
  function clearState() { localStorage.removeItem(STATE_KEY); }
  function getState() {
    try { const s = JSON.parse(localStorage.getItem(STATE_KEY)); return (Date.now() - s.ts < 10*60*1000) ? s : null; }
    catch { return null; }
  }

  const S1_STEPS = [
    { key: 's1-del', fn: stepDeleteAccount },
    { key: 's1-login', fn: stepQuickLogin },
    { key: 's1-onboard', fn: stepOnboarding },
    { key: 's1-cashout', fn: stepStage1Cashout },
  ];

  async function runS1() {
    st('s1', 'running', '一键 Stage 1...'); disableAll(true);
    for (let i = 0; i < S1_STEPS.length; i++) {
      saveState(i);
      const ok = await S1_STEPS[i].fn();
      if (!ok) { st('s1', 'error', `停止于 ${S1_STEPS[i].key}`); clearState(); disableAll(false); return; }
      await sleep(800);
    }
    clearState(); st('s1', 'done', 'Stage 1 全部完成 ✓'); disableAll(false);
  }

  function resumeS1() {
    const s = getState(); if (!s) return;
    const next = s.step + 1;
    if (next >= S1_STEPS.length) { clearState(); return; }
    log('Resuming S1 from step', next);
    setTimeout(async () => {
      disableAll(true);
      for (let i = next; i < S1_STEPS.length; i++) {
        saveState(i); const ok = await S1_STEPS[i].fn();
        if (!ok) { clearState(); disableAll(false); return; } await sleep(800);
      }
      clearState(); st('s1', 'done', 'Stage 1 全部完成 ✓'); disableAll(false);
    }, 3000);
  }

  // ═══════════════════════════════════════════════
  // Status + UI helpers
  // ═══════════════════════════════════════════════
  let panelEl = null, fabEl = null, expanded = false;

  function st(key, state, msg) {
    if (!panelEl) return;
    const el = panelEl.querySelector(`#st-${key}`);
    if (el) { el.textContent = msg; el.className = `st ${state}`; }
    log(`[${key}] ${msg}`);
  }

  function disableAll(v) {
    if (!panelEl) return;
    panelEl.querySelectorAll('.row button').forEach(b => b.disabled = v);
  }

  function togglePanel() {
    expanded = !expanded;
    panelEl.classList.toggle('open', expanded);
    fabEl.textContent = expanded ? '✕' : '⚡';
  }

  function refreshInfo() {
    if (!panelEl) return;
    const el = panelEl.querySelector('#user-info');
    if (!el) return;
    const s = getAuth();
    if (s?.userInfo) el.innerHTML = `<b>ID:</b> ${s.userInfo.userId||'?'} | ${s.userInfo.username||'-'} | ${s.userState||'?'}`;
    else el.innerHTML = getToken() ? 'Token 存在 | 无用户信息' : '<b>未登录</b>';
  }

  // ═══════════════════════════════════════════════
  // Panel UI
  // ═══════════════════════════════════════════════
  const CSS = `
#autobot-fab{position:fixed;bottom:20px;right:20px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#00bcd4,#0f3460);color:#fff;border:none;cursor:pointer;z-index:999999;box-shadow:0 4px 16px rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;transition:transform .2s}
#autobot-fab:hover{transform:scale(1.1)}
#autobot-panel{position:fixed;bottom:78px;right:20px;width:340px;max-height:82vh;overflow-y:auto;background:#1a1a2e;color:#eee;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.45);z-index:999998;font-family:-apple-system,sans-serif;font-size:12px;transform:scale(.9);opacity:0;pointer-events:none;transform-origin:bottom right;transition:transform .25s,opacity .25s}
#autobot-panel.open{transform:scale(1);opacity:1;pointer-events:auto}
#autobot-panel .hdr{display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:#16213e;border-radius:12px 12px 0 0}
#autobot-panel .hdr h3{margin:0;font-size:13px;font-weight:700;color:#00bcd4}
#autobot-panel .hdr .cb{background:none;border:none;color:#888;cursor:pointer;font-size:16px}
#autobot-panel .body{padding:8px 12px}
#autobot-panel .info{padding:5px 7px;background:#0f3460;border-radius:6px;margin-bottom:8px;font-size:11px;color:#aaa}
#autobot-panel .info b{color:#00bcd4}
#autobot-panel .cfg label{display:block;margin-bottom:3px;font-size:10px;color:#aaa}
#autobot-panel .cfg input{width:100%;padding:5px 7px;background:#0f3460;border:1px solid #444;border-radius:5px;color:#eee;font-size:11px;box-sizing:border-box;margin-bottom:5px}
#autobot-panel .cfg input:focus{outline:none;border-color:#00bcd4}
#autobot-panel .grp{margin-bottom:6px}
#autobot-panel .grp-hdr{display:flex;align-items:center;justify-content:space-between;padding:6px 0;cursor:pointer;border-bottom:1px solid #333;user-select:none}
#autobot-panel .grp-hdr span{font-size:12px;font-weight:600;color:#00bcd4}
#autobot-panel .grp-hdr .arr{color:#666;font-size:10px;transition:transform .2s}
#autobot-panel .grp-hdr .arr.open{transform:rotate(90deg)}
#autobot-panel .grp-body{overflow:hidden;transition:max-height .3s;max-height:0}
#autobot-panel .grp-body.open{max-height:500px}
#autobot-panel .grp-body .inner{padding:6px 0}
#autobot-panel .row{display:flex;align-items:center;gap:6px;margin-bottom:4px}
#autobot-panel .row button{flex-shrink:0;padding:5px 8px;background:#0f3460;color:#eee;border:1px solid #00bcd4;border-radius:5px;cursor:pointer;font-size:10px;font-weight:600;white-space:nowrap}
#autobot-panel .row button:hover{background:#1a5276}
#autobot-panel .row button:disabled{opacity:.4;cursor:not-allowed}
#autobot-panel .row button.wide{flex:1}
#autobot-panel .row button.warn{border-color:#ff9800}
#autobot-panel .row button.green{border-color:#4caf50}
#autobot-panel .row button.accent{background:linear-gradient(135deg,#00bcd4,#0f3460);border:none;padding:8px;font-size:12px;font-weight:700;border-radius:7px;width:100%}
#autobot-panel .st{flex:1;font-size:10px;color:#888;word-break:break-all}
#autobot-panel .st.running{color:#ffeb3b}
#autobot-panel .st.done{color:#4caf50}
#autobot-panel .st.error{color:#f44336}
#autobot-panel .st.warning{color:#ff9800}
`;

  function grpHTML(id, title, contentHTML, openDefault = false) {
    return `<div class="grp" id="grp-${id}">
      <div class="grp-hdr" data-grp="${id}"><span>${title}</span><span class="arr ${openDefault?'open':''}">▶</span></div>
      <div class="grp-body ${openDefault?'open':''}"><div class="inner">${contentHTML}</div></div>
    </div>`;
  }

  function createPanel() {
    if (document.getElementById('autobot-fab')) return;
    const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);

    fabEl = document.createElement('button'); fabEl.id = 'autobot-fab'; fabEl.textContent = '⚡';
    fabEl.addEventListener('click', togglePanel); document.body.appendChild(fabEl);

    const p = document.createElement('div'); p.id = 'autobot-panel';
    p.innerHTML = `
      <div class="hdr"><h3>AutoBot v3</h3><button class="cb" id="btn-close">✕</button></div>
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
            <option value="200010">200010 4th Duration</option>
            <option value="200011">200011 5th Duration</option>
          </select></div>
        `)}
      </div>
    `;
    document.body.appendChild(p); panelEl = p;

    // Group toggle
    p.querySelectorAll('.grp-hdr').forEach(hdr => {
      hdr.addEventListener('click', () => {
        const body = hdr.nextElementSibling;
        const arr = hdr.querySelector('.arr');
        body.classList.toggle('open'); arr.classList.toggle('open');
      });
    });

    p.querySelector('#btn-close').addEventListener('click', togglePanel);

    // Config
    const bind = (id, key) => p.querySelector(id).addEventListener('input', e => { CFG[key] = e.target.value.trim(); saveCfg(); });
    bind('#cfg-username', 'username'); bind('#cfg-age', 'age'); bind('#cfg-paypal', 'paypalEmail');
    bind('#cfg-photo', 'photoUrl'); bind('#cfg-price', 'mockPrice');

    // Stage 1 buttons
    p.querySelector('#btn-del').addEventListener('click', () => stepDeleteAccount());
    p.querySelector('#btn-login').addEventListener('click', () => stepQuickLogin());
    p.querySelector('#btn-onboard').addEventListener('click', () => stepOnboarding());
    p.querySelector('#btn-cashout1').addEventListener('click', () => stepStage1Cashout());
    p.querySelector('#btn-s1-all').addEventListener('click', () => runS1());

    // Stage 2-5
    p.querySelector('#btn-s2').addEventListener('click', () => stepStage2());
    p.querySelector('#btn-s3').addEventListener('click', () => stepStage3());
    p.querySelector('#btn-s4').addEventListener('click', () => stepStage4());
    p.querySelector('#btn-s5').addEventListener('click', () => stepStage5());

    // Tools
    p.querySelector('#btn-post').addEventListener('click', () => autoPost());
    p.querySelector('#btn-mock').addEventListener('click', () => triggerMockCall());
    p.querySelector('#btn-mock-off').addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '1'); alert('Mock 视频已关闭'); });
    p.querySelector('#btn-mock-on').addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '0'); alert('Mock 视频已开启'); });
    p.querySelector('#btn-task').addEventListener('click', () => {
      const id = p.querySelector('#cfg-taskid').value.trim();
      if (id) finishTaskViaDebug(Number(id));
    });

    refreshInfo(); setInterval(refreshInfo, 3000);
  }

  // ═══════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════
  function init() {
    log('AutoBot v3 loaded');
    createPanel(); resumeS1();
  }

  if (document.readyState === 'complete' || document.body) init();
  else { document.addEventListener('DOMContentLoaded', init); setTimeout(() => { if (!document.getElementById('autobot-fab')) init(); }, 2000); }
})();
