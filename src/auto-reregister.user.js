// ==UserScript==
// @name         Sitin PWA Auto Re-register
// @namespace    https://github.com/sitin-pwa-automation
// @version      2.0.0
// @description  一键注销账号 → Quick Login → 注册 → 第一笔提现
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

console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'script entry', location.href, document.readyState);

(function () {
  'use strict';

  // ═══════════════════════════════════════════════
  // Config
  // ═══════════════════════════════════════════════
  const CONFIG = {
    username: '',          // 留空自动生成
    age: 22,
    paypalEmail: '',      // PayPal 邮箱
  };

  // ═══════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...args) => console.log('%c[AutoBot]', 'color:#00bcd4;font-weight:bold', ...args);
  const warn = (...args) => console.warn('%c[AutoBot]', 'color:#ff9800;font-weight:bold', ...args);

  function generateUsername() {
    const adj = ['Happy','Lucky','Sweet','Cool','Cute','Fun','Nice','Star'];
    const noun = ['Cat','Dog','Bunny','Bird','Fox','Bear','Panda','Tiger'];
    return adj[Math.floor(Math.random()*adj.length)] + noun[Math.floor(Math.random()*noun.length)] + (Math.floor(Math.random()*9000)+1000);
  }

  function waitForEl(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { obs.disconnect(); resolve(el); }
      });
      obs.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { obs.disconnect(); reject(new Error(`waitForEl timeout: ${selector}`)); }, timeout);
    });
  }

  function waitForUrl(pattern, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (typeof pattern === 'string' ? location.pathname.includes(pattern) : pattern.test(location.pathname)) {
          resolve(); return true;
        }
        return false;
      };
      if (check()) return;
      const iv = setInterval(() => { if (check()) clearInterval(iv); }, 300);
      setTimeout(() => { clearInterval(iv); reject(new Error(`waitForUrl timeout: ${pattern}`)); }, timeout);
    });
  }

  function setNativeValue(el, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function getAuthStore() {
    try {
      const raw = localStorage.getItem('auth-storage');
      return raw ? (JSON.parse(raw)?.state || null) : null;
    } catch { return null; }
  }
  function getToken() { return localStorage.getItem('haven_token') || ''; }
  function getUserId() { return getAuthStore()?.userInfo?.userId || null; }

  // Find a button by text content (case insensitive, partial match)
  function findBtn(texts) {
    if (typeof texts === 'string') texts = [texts];
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const t = btn.textContent?.trim().toLowerCase() || '';
      for (const text of texts) {
        if (t.includes(text.toLowerCase()) && !btn.disabled) return btn;
      }
    }
    return null;
  }

  // Navigate via SPA router (avoids full page reload that kills the script)
  function spaNavigate(path) {
    // Push to history and dispatch popstate so React Router picks it up
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }

  // ═══════════════════════════════════════════════
  // Step 1: Delete Account
  // ═══════════════════════════════════════════════
  async function stepDeleteAccount() {
    updateStatus('delete', 'running', '正在注销账号...');
    const userId = getUserId();
    if (!userId || !getToken()) {
      updateStatus('delete', 'error', '未登录，无法注销');
      return false;
    }
    log('Deleting account, userId:', userId);

    try {
      if (!location.pathname.includes('/debug')) {
        spaNavigate('/debug');
        await sleep(1500);
      }

      // Wait for debug page to render
      let deleteBtn = null;
      for (let i = 0; i < 10; i++) {
        deleteBtn = findBtn('删除账户');
        if (deleteBtn) break;
        await sleep(500);
      }

      if (!deleteBtn) {
        updateStatus('delete', 'error', '找不到删除账户按钮');
        return false;
      }

      const origConfirm = window.confirm;
      window.confirm = () => true;
      deleteBtn.click();
      await sleep(3000);
      window.confirm = origConfirm;

      // Wait for logout
      for (let i = 0; i < 10; i++) {
        await sleep(500);
        const store = getAuthStore();
        if (!store?.token || !store?.userInfo || location.pathname.includes('/onboarding')) {
          updateStatus('delete', 'done', '账号已注销 ✓');
          return true;
        }
      }

      updateStatus('delete', 'done', '注销已执行 ✓');
      return true;
    } catch (e) {
      updateStatus('delete', 'error', `注销失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Step 2: Quick Login (dev only, deviceId login)
  // ═══════════════════════════════════════════════
  async function stepQuickLogin() {
    updateStatus('login', 'running', '正在快速登录...');

    try {
      // Navigate to login page
      if (!location.pathname.includes('/onboarding')) {
        spaNavigate('/onboarding');
        await sleep(1500);
      }

      // Wait for Quick Login button (only available in non-production)
      let quickBtn = null;
      for (let i = 0; i < 15; i++) {
        quickBtn = findBtn('quick login');
        if (quickBtn) break;
        await sleep(500);
      }

      if (!quickBtn) {
        updateStatus('login', 'error', '找不到 Quick Login 按钮（仅开发环境可用）');
        return false;
      }

      quickBtn.click();
      log('Quick Login clicked');

      // Wait for login to complete
      for (let i = 0; i < 20; i++) {
        await sleep(500);
        const store = getAuthStore();
        if (store?.token && store?.userInfo) {
          const state = store.userState;
          if (state === 'FullRegister') {
            updateStatus('login', 'done', `已登录 (已注册用户) userId: ${store.userInfo.userId} ✓`);
            return true;
          }
          if (state === 'SimpleRegister' || location.pathname.includes('/onboardingcontainer')) {
            updateStatus('login', 'done', `已登录 (新用户) userId: ${store.userInfo.userId} ✓`);
            return true;
          }
        }
      }

      // Check once more
      const store = getAuthStore();
      if (store?.token) {
        updateStatus('login', 'done', '登录成功 ✓');
        return true;
      }

      updateStatus('login', 'error', '登录超时');
      return false;
    } catch (e) {
      updateStatus('login', 'error', `登录失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Step 3: Complete Onboarding
  // ═══════════════════════════════════════════════
  async function stepOnboarding() {
    updateStatus('onboarding', 'running', '正在完成注册...');

    // If already fully registered, skip
    const store = getAuthStore();
    if (store?.userState === 'FullRegister') {
      updateStatus('onboarding', 'done', '已是完整注册用户，跳过 ✓');
      return true;
    }

    try {
      if (!location.pathname.includes('/onboardingcontainer')) {
        spaNavigate('/onboardingcontainer');
        await sleep(1500);
      }

      // ── Page 1: Username ──
      log('Onboarding step 1: username');
      await sleep(1000);
      const usernameInput = await waitForEl('input[type="text"]', 5000).catch(() => null);
      if (usernameInput) {
        const name = CONFIG.username || generateUsername();
        log('Filling username:', name);
        usernameInput.focus();
        setNativeValue(usernameInput, name);
        await sleep(300);
        const btn = findBtn(['continue', 'next']);
        if (btn) btn.click();
        await sleep(3000); // wait for animation + next page
      }

      // ── Page 2: Age ──
      log('Onboarding step 2: age');
      await sleep(500);
      const ageInput = document.querySelector('input[type="text"], input[inputmode="numeric"]');
      if (ageInput) {
        ageInput.focus();
        setNativeValue(ageInput, String(CONFIG.age));
        await sleep(300);
        const btn = findBtn(['continue', 'next']);
        if (btn) btn.click();
        await sleep(3000);
      }

      // ── Page 3: Photo ──
      log('Onboarding step 3: photo (click continue/skip)');
      await sleep(500);
      let photoBtn = findBtn(['continue', 'next', 'skip', 'done']);
      if (photoBtn) {
        photoBtn.click();
        await sleep(3000);
      }

      // ── Page 4: Phone (may be skipped if logged in via verified phone) ──
      log('Onboarding step 4: phone (if needed)');
      await sleep(500);
      const phoneInput = document.querySelector('input[inputmode="numeric"], input[type="tel"]');
      if (phoneInput) {
        // Fill a dummy phone or skip
        phoneInput.focus();
        setNativeValue(phoneInput, '2025551234');
        await sleep(300);
      }
      let finalBtn = findBtn(['continue', 'next', 'submit', 'done']);
      if (finalBtn) {
        finalBtn.click();
        await sleep(3000);
      }

      // Wait for registration to complete
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        const s = getAuthStore();
        if (s?.userState === 'FullRegister' || location.pathname === '/') {
          updateStatus('onboarding', 'done', '注册完成 ✓');
          return true;
        }
      }

      updateStatus('onboarding', 'warning', '注册流程已执行，请检查');
      return true;
    } catch (e) {
      updateStatus('onboarding', 'error', `注册失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Step 4: Bind PayPal
  // ═══════════════════════════════════════════════
  async function stepBindPaypal() {
    updateStatus('paypal', 'running', '正在绑定 PayPal...');

    if (!CONFIG.paypalEmail) {
      updateStatus('paypal', 'error', '请填写 PayPal 邮箱');
      return false;
    }

    try {
      if (!location.pathname.includes('/cashout')) {
        spaNavigate('/cashout');
        await sleep(2000);
      }

      // Find PayPal card and click
      await sleep(1000);
      const paypalImgs = document.querySelectorAll('img[src*="paypal"]');
      if (paypalImgs.length > 0) {
        const card = paypalImgs[0].closest('button, div[role="button"], div[class*="card"]');
        if (card) { card.click(); await sleep(2000); }
      }

      // Fill email in modal
      await sleep(500);
      const emailInput = document.querySelector('input[type="email"], input[placeholder*="email"], input[placeholder*="PayPal"]');
      if (emailInput) {
        emailInput.focus();
        setNativeValue(emailInput, CONFIG.paypalEmail);
        await sleep(300);
        const btn = findBtn(['submit', 'bind', 'confirm', 'save', 'done']);
        if (btn) { btn.click(); await sleep(2000); }
      }

      updateStatus('paypal', 'done', 'PayPal 绑定已执行 ✓');
      return true;
    } catch (e) {
      updateStatus('paypal', 'error', `绑定失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Step 5: First Cashout ($0.50)
  // ═══════════════════════════════════════════════
  async function stepCashout() {
    updateStatus('cashout', 'running', '正在发起提现...');

    try {
      if (!location.pathname.includes('/cashout')) {
        spaNavigate('/cashout');
        await sleep(2000);
      }

      await sleep(1000);
      const cashoutBtn = findBtn(['cash out', 'cashout', 'withdraw', 'claim']);
      if (cashoutBtn) {
        cashoutBtn.click();
        await sleep(2000);

        // Walk through modal confirmations
        for (let i = 0; i < 10; i++) {
          await sleep(1500);
          const btn = findBtn(['confirm', 'cash out', 'continue', 'ok', 'yes']);
          if (btn) { btn.click(); await sleep(1000); }
        }
        updateStatus('cashout', 'done', '提现已发起 ✓');
        return true;
      }

      updateStatus('cashout', 'warning', '未找到提现按钮');
      return false;
    } catch (e) {
      updateStatus('cashout', 'error', `提现失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Run All
  // ═══════════════════════════════════════════════
  async function runAll() {
    updateStatus('all', 'running', '一键执行中...');
    panelEl.querySelector('#btn-run-all').disabled = true;

    const steps = [
      { key: 'delete', fn: stepDeleteAccount },
      { key: 'login', fn: stepQuickLogin },
      { key: 'onboarding', fn: stepOnboarding },
      { key: 'paypal', fn: stepBindPaypal },
      { key: 'cashout', fn: stepCashout },
    ];

    for (const step of steps) {
      const ok = await step.fn();
      if (!ok) {
        updateStatus('all', 'error', `在 [${step.key}] 停止`);
        panelEl.querySelector('#btn-run-all').disabled = false;
        return;
      }
      await sleep(800);
    }

    updateStatus('all', 'done', '全部完成 ✓');
    panelEl.querySelector('#btn-run-all').disabled = false;
  }

  // ═══════════════════════════════════════════════
  // UI Panel
  // ═══════════════════════════════════════════════
  let panelEl = null;
  let expanded = false;

  const PANEL_STYLE = `
    #autobot-fab {
      position: fixed; bottom: 20px; right: 20px; width: 48px; height: 48px;
      border-radius: 50%; background: linear-gradient(135deg, #00bcd4, #0f3460);
      color: #fff; border: none; cursor: pointer; z-index: 999999;
      box-shadow: 0 4px 16px rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: bold; transition: transform .2s;
    }
    #autobot-fab:hover { transform: scale(1.1); }
    #autobot-fab.has-panel { background: #16213e; border: 2px solid #00bcd4; }

    #autobot-panel {
      position: fixed; bottom: 78px; right: 20px; width: 320px; max-height: 80vh;
      overflow-y: auto; background: #1a1a2e; color: #eee; border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.45); z-index: 999998;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 13px;
      transform: scale(0.9); opacity: 0; pointer-events: none;
      transform-origin: bottom right; transition: transform .25s ease, opacity .25s ease;
    }
    #autobot-panel.open { transform: scale(1); opacity: 1; pointer-events: auto; }
    #autobot-panel .hdr {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: #16213e; border-radius: 12px 12px 0 0;
      user-select: none;
    }
    #autobot-panel .hdr h3 { margin: 0; font-size: 14px; font-weight: 700; color: #00bcd4; }
    #autobot-panel .hdr .close-btn {
      background: none; border: none; color: #888; cursor: pointer; font-size: 18px; padding: 0 4px; line-height: 1;
    }
    #autobot-panel .hdr .close-btn:hover { color: #eee; }
    #autobot-panel .body { padding: 10px 14px; }
    #autobot-panel .cfg { margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid #333; }
    #autobot-panel .cfg label { display: block; margin-bottom: 4px; font-size: 11px; color: #aaa; }
    #autobot-panel .cfg input {
      width: 100%; padding: 6px 8px; background: #0f3460; border: 1px solid #444;
      border-radius: 6px; color: #eee; font-size: 12px; box-sizing: border-box; margin-bottom: 6px;
    }
    #autobot-panel .cfg input:focus { outline: none; border-color: #00bcd4; }
    #autobot-panel .row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
    #autobot-panel .row button {
      flex-shrink: 0; padding: 6px 10px; background: #0f3460; color: #eee;
      border: 1px solid #00bcd4; border-radius: 6px; cursor: pointer;
      font-size: 11px; font-weight: 600; white-space: nowrap;
    }
    #autobot-panel .row button:hover { background: #1a5276; }
    #autobot-panel .row button:disabled { opacity: .5; cursor: not-allowed; }
    #autobot-panel .st { flex: 1; font-size: 11px; color: #888; word-break: break-all; }
    #autobot-panel .st.running { color: #ffeb3b; }
    #autobot-panel .st.done { color: #4caf50; }
    #autobot-panel .st.error { color: #f44336; }
    #autobot-panel .st.warning { color: #ff9800; }
    #autobot-panel .divider { height: 1px; background: #333; margin: 10px 0; }
    #autobot-panel #btn-run-all {
      width: 100%; padding: 10px; background: linear-gradient(135deg, #00bcd4, #0f3460);
      color: #fff; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-weight: 700;
    }
    #autobot-panel #btn-run-all:hover { opacity: .9; }
    #autobot-panel #btn-run-all:disabled { opacity: .5; cursor: not-allowed; }
    #autobot-panel .info { padding: 6px 8px; background: #0f3460; border-radius: 6px; margin-bottom: 10px; font-size: 11px; color: #aaa; }
    #autobot-panel .info strong { color: #00bcd4; }
  `;

  function togglePanel() {
    expanded = !expanded;
    panelEl.classList.toggle('open', expanded);
    fabEl.classList.toggle('has-panel', expanded);
    fabEl.textContent = expanded ? '✕' : '⚡';
  }

  let fabEl = null;

  function createPanel() {
    console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'createPanel()');
    if (document.getElementById('autobot-fab')) return;

    if (typeof GM_addStyle === 'function') { GM_addStyle(PANEL_STYLE); }
    else { const s = document.createElement('style'); s.textContent = PANEL_STYLE; document.head.appendChild(s); }

    // FAB button
    const fab = document.createElement('button');
    fab.id = 'autobot-fab';
    fab.textContent = '⚡';
    fab.title = 'PWA AutoBot';
    fab.addEventListener('click', togglePanel);
    document.body.appendChild(fab);
    fabEl = fab;

    // Panel
    const p = document.createElement('div');
    p.id = 'autobot-panel';
    p.innerHTML = `
      <div class="hdr">
        <h3>PWA AutoBot</h3>
        <button class="close-btn" id="btn-close" title="收起">✕</button>
      </div>
      <div class="body">
        <div class="info" id="user-info">加载中...</div>
        <div class="cfg">
          <label>用户名 (留空自动生成)</label>
          <input type="text" id="cfg-username" placeholder="自动生成" value="${CONFIG.username}">
          <label>年龄</label>
          <input type="number" id="cfg-age" value="${CONFIG.age}">
          <label>PayPal 邮箱</label>
          <input type="email" id="cfg-paypal" placeholder="your@email.com" value="${CONFIG.paypalEmail}">
        </div>
        <div class="row"><button id="btn-s1">1. 注销账号</button><span class="st" id="st-delete">待执行</span></div>
        <div class="row"><button id="btn-s2">2. 快速登录</button><span class="st" id="st-login">待执行</span></div>
        <div class="row"><button id="btn-s3">3. 完成注册</button><span class="st" id="st-onboarding">待执行</span></div>
        <div class="row"><button id="btn-s4">4. 绑定 PayPal</button><span class="st" id="st-paypal">待执行</span></div>
        <div class="row"><button id="btn-s5">5. 第一笔提现</button><span class="st" id="st-cashout">待执行</span></div>
        <div class="divider"></div>
        <div class="row"><span class="st" id="st-all" style="text-align:center;width:100%">—</span></div>
        <button id="btn-run-all">一键执行全部流程</button>
      </div>
    `;
    document.body.appendChild(p);
    panelEl = p;

    console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'Panel + FAB injected');

    // Close button inside panel header
    p.querySelector('#btn-close').addEventListener('click', togglePanel);

    // Config bindings
    p.querySelector('#cfg-username').addEventListener('input', e => { CONFIG.username = e.target.value.trim(); });
    p.querySelector('#cfg-age').addEventListener('input', e => { CONFIG.age = parseInt(e.target.value) || 22; });
    p.querySelector('#cfg-paypal').addEventListener('input', e => { CONFIG.paypalEmail = e.target.value.trim(); });

    // Step buttons
    p.querySelector('#btn-s1').addEventListener('click', () => stepDeleteAccount());
    p.querySelector('#btn-s2').addEventListener('click', () => stepQuickLogin());
    p.querySelector('#btn-s3').addEventListener('click', () => stepOnboarding());
    p.querySelector('#btn-s4').addEventListener('click', () => stepBindPaypal());
    p.querySelector('#btn-s5').addEventListener('click', () => stepCashout());
    p.querySelector('#btn-run-all').addEventListener('click', () => runAll());

    // User info refresh
    refreshUserInfo();
    setInterval(refreshUserInfo, 3000);
  }

  function updateStatus(step, state, msg) {
    if (!panelEl) return;
    const el = panelEl.querySelector(`#st-${step}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `st ${state}`;
    log(`[${step}] ${msg}`);
  }

  function refreshUserInfo() {
    if (!panelEl) return;
    const el = panelEl.querySelector('#user-info');
    if (!el) return;
    const s = getAuthStore();
    if (s?.userInfo) {
      el.innerHTML = `<strong>已登录</strong> | ID: ${s.userInfo.userId||'?'} | ${s.userInfo.username||'未设置'} | ${s.userState||'?'}`;
    } else if (getToken()) {
      el.innerHTML = '<strong>有 Token</strong> | 无用户信息';
    } else {
      el.innerHTML = '<strong>未登录</strong>';
    }
  }

  // ═══════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════
  function init() {
    console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'init()', { readyState: document.readyState, body: !!document.body });
    log('PWA AutoBot v2.0 loaded');
    createPanel();
  }

  if (document.readyState === 'complete') {
    init();
  } else if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
    setTimeout(() => { if (!document.getElementById('autobot-panel')) init(); }, 2000);
  }
})();
