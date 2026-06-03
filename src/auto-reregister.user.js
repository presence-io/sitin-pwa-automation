// ==UserScript==
// @name         Sitin PWA Auto Re-register
// @namespace    https://github.com/sitin-pwa-automation
// @version      1.1.0
// @description  一键注销账号 → 重新注册 → 第一笔提现 自动化脚本
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

// ── 也可以不用油猴，直接在浏览器 Console 粘贴执行，或通过 <script> 标签注入 ──

(function () {
  'use strict';

  // ═══════════════════════════════════════════════
  // Config
  // ═══════════════════════════════════════════════
  const CONFIG = {
    phoneNumber: '',       // 填入美国手机号，如 '2025551234'
    username: '',          // 注册用户名（留空则自动生成）
    age: 22,              // 注册年龄
    paypalEmail: '',      // PayPal 邮箱
    autoPhotoUrl: '',     // 头像图片 URL（留空则跳过自动上传）
  };

  // ═══════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log = (...args) => console.log('%c[AutoBot]', 'color:#00bcd4;font-weight:bold', ...args);
  const warn = (...args) => console.warn('%c[AutoBot]', 'color:#ff9800;font-weight:bold', ...args);
  const err = (...args) => console.error('%c[AutoBot]', 'color:#f44336;font-weight:bold', ...args);

  function generateUsername() {
    const adjectives = ['Happy', 'Lucky', 'Sweet', 'Cool', 'Cute', 'Fun', 'Nice', 'Star'];
    const nouns = ['Cat', 'Dog', 'Bunny', 'Bird', 'Fox', 'Bear', 'Panda', 'Tiger'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const num = Math.floor(Math.random() * 9000) + 1000;
    return `${adj}${noun}${num}`;
  }

  // Wait for an element to appear in the DOM
  function waitForEl(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector);
      if (el) return resolve(el);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) { observer.disconnect(); resolve(el); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); reject(new Error(`waitForEl timeout: ${selector}`)); }, timeout);
    });
  }

  // Wait for URL to match
  function waitForUrl(pattern, timeout = 15000) {
    return new Promise((resolve, reject) => {
      const check = () => {
        if (typeof pattern === 'string' ? location.pathname.includes(pattern) : pattern.test(location.pathname)) {
          return resolve();
        }
      };
      check();
      const interval = setInterval(() => { check(); }, 300);
      setTimeout(() => { clearInterval(interval); reject(new Error(`waitForUrl timeout: ${pattern}`)); }, timeout);
    });
  }

  // Simulate React-compatible input change
  function setNativeValue(el, value) {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeInputValueSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Get zustand store state from localStorage
  function getAuthStore() {
    try {
      const raw = localStorage.getItem('auth-storage');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed?.state || null;
    } catch { return null; }
  }

  function getToken() {
    return localStorage.getItem('haven_token') || '';
  }

  function getUserId() {
    const store = getAuthStore();
    return store?.userInfo?.userId || null;
  }

  // ═══════════════════════════════════════════════
  // Proto API helpers — binary protobuf over HTTP
  // ═══════════════════════════════════════════════
  // The PWA uses protobuf binary encoding: [4-byte protoId BE] + [protobuf payload]
  // Since we can't easily import proto definitions in userscript,
  // we'll use DOM manipulation + page navigation for most steps.
  // For API calls that are simple, we directly operate the page.

  // ═══════════════════════════════════════════════
  // Step functions
  // ═══════════════════════════════════════════════

  // ── Step 1: Delete Account ──
  async function stepDeleteAccount() {
    updateStatus('delete', 'running', '正在注销账号...');
    const userId = getUserId();
    const token = getToken();

    if (!userId || !token) {
      updateStatus('delete', 'error', '未登录，无法注销');
      return false;
    }

    log('Deleting account for userId:', userId);

    // Navigate to debug page and trigger delete
    // Alternatively, we can use the page's internal functions via __ZUSTAND__
    // The simplest approach: navigate to /debug and click the delete button
    try {
      // Try to access the page's React internals
      // zustand stores are accessible via the persist middleware localStorage key
      // But actual API calls need the httpClient which uses protobuf encoding

      // Strategy: navigate to debug page, find and click delete button
      if (!location.pathname.includes('/debug')) {
        location.href = '/debug';
        await sleep(2000);
        await waitForUrl('/debug');
        await sleep(1000);
      }

      // Find the delete account button
      const buttons = document.querySelectorAll('button');
      let deleteBtn = null;
      for (const btn of buttons) {
        if (btn.textContent?.includes('删除账户')) {
          deleteBtn = btn;
          break;
        }
      }

      if (!deleteBtn) {
        updateStatus('delete', 'error', '找不到删除账户按钮，请确认在 Debug 页面');
        return false;
      }

      // Override confirm to auto-accept
      const origConfirm = window.confirm;
      window.confirm = () => true;

      deleteBtn.click();
      await sleep(3000);

      window.confirm = origConfirm;

      // Check if logged out (redirected to /onboarding)
      await sleep(2000);
      const currentStore = getAuthStore();
      if (!currentStore?.token && !currentStore?.userInfo) {
        updateStatus('delete', 'done', '账号已注销 ✓');
        return true;
      }

      // If redirect happened
      if (location.pathname.includes('/onboarding')) {
        updateStatus('delete', 'done', '账号已注销 ✓');
        return true;
      }

      updateStatus('delete', 'done', '注销操作已执行，等待跳转...');
      await sleep(2000);
      return true;
    } catch (e) {
      err('Delete account failed:', e);
      updateStatus('delete', 'error', `注销失败: ${e.message}`);
      return false;
    }
  }

  // ── Step 2: Enter phone number & send OTP ──
  async function stepSendOtp() {
    updateStatus('otp', 'running', '正在输入手机号...');

    const phone = CONFIG.phoneNumber;
    if (!phone) {
      updateStatus('otp', 'error', '请先在脚本 CONFIG 中填写手机号');
      return false;
    }

    try {
      // Navigate to phone login page
      if (!location.pathname.includes('/login/phone')) {
        location.href = '/login/phone';
        await sleep(2000);
        await waitForUrl('/login/phone');
        await sleep(1000);
      }

      // Find phone input
      const input = await waitForEl('input[inputmode="numeric"]');
      input.focus();
      setNativeValue(input, phone);
      await sleep(500);

      // Find and click "Send code" button
      const buttons = document.querySelectorAll('button');
      let sendBtn = null;
      for (const btn of buttons) {
        if (btn.textContent?.trim().toLowerCase().includes('send code')) {
          sendBtn = btn;
          break;
        }
      }

      if (!sendBtn || sendBtn.disabled) {
        updateStatus('otp', 'error', '发送按钮不可用，手机号可能格式不对');
        return false;
      }

      sendBtn.click();
      log('OTP send clicked, waiting...');
      await sleep(3000);

      // Check if we moved to OTP step (looking for "6-digit code" text)
      const h1s = document.querySelectorAll('h1');
      for (const h1 of h1s) {
        if (h1.textContent?.includes('6-digit')) {
          updateStatus('otp', 'done', 'OTP 已发送，请手动输入验证码 ✓');
          return true;
        }
      }

      updateStatus('otp', 'warning', 'OTP 可能已发送，请检查手机');
      return true;
    } catch (e) {
      err('Send OTP failed:', e);
      updateStatus('otp', 'error', `发送 OTP 失败: ${e.message}`);
      return false;
    }
  }

  // ── Step 3: Wait for OTP verification & login ──
  async function stepWaitLogin() {
    updateStatus('login', 'running', '等待验证码输入并登录...');

    try {
      // Poll for login state
      for (let i = 0; i < 120; i++) { // 2 minutes max
        await sleep(1000);
        const store = getAuthStore();
        if (store?.token && store?.userInfo) {
          log('Login detected! userId:', store.userInfo.userId);
          updateStatus('login', 'done', `登录成功 userId: ${store.userInfo.userId} ✓`);
          return true;
        }

        // Also check if we're on onboarding container (means login succeeded, pending registration)
        if (location.pathname.includes('/onboardingcontainer')) {
          updateStatus('login', 'done', '登录成功，进入注册流程 ✓');
          return true;
        }

        if (i % 10 === 0 && i > 0) {
          updateStatus('login', 'running', `等待验证码输入... (${i}s)`);
        }
      }

      updateStatus('login', 'error', '等待超时，请手动输入验证码后重试');
      return false;
    } catch (e) {
      err('Wait login failed:', e);
      updateStatus('login', 'error', `等待登录失败: ${e.message}`);
      return false;
    }
  }

  // ── Step 4: Complete Onboarding ──
  async function stepOnboarding() {
    updateStatus('onboarding', 'running', '正在完成注册...');

    try {
      // Navigate to onboarding if not there
      if (!location.pathname.includes('/onboardingcontainer')) {
        location.href = '/onboardingcontainer';
        await sleep(2000);
        await waitForUrl('/onboardingcontainer');
        await sleep(1000);
      }

      // ── Page 1: Username ──
      log('Onboarding: filling username...');
      await sleep(1000);

      const usernameInput = await waitForEl('input[type="text"]', 5000).catch(() => null);
      if (usernameInput) {
        const name = CONFIG.username || generateUsername();
        usernameInput.focus();
        setNativeValue(usernameInput, name);
        await sleep(500);

        // Click continue button
        await clickContinueButton();
        await sleep(3000);
      }

      // ── Page 2: Age ──
      log('Onboarding: filling age...');
      await sleep(1000);

      const ageInput = document.querySelector('input[type="text"], input[inputmode="numeric"]');
      if (ageInput) {
        ageInput.focus();
        setNativeValue(ageInput, String(CONFIG.age || 22));
        await sleep(500);
        await clickContinueButton();
        await sleep(3000);
      }

      // ── Page 3: Photo ──
      log('Onboarding: photo step...');
      await sleep(1000);
      // Photo might require actual file upload; click continue/skip if available
      await clickContinueButton();
      await sleep(3000);

      // ── Page 4: Phone (if needed) ──
      log('Onboarding: phone step...');
      await sleep(1000);
      const phoneInput = document.querySelector('input[inputmode="numeric"], input[type="tel"]');
      if (phoneInput && CONFIG.phoneNumber) {
        phoneInput.focus();
        setNativeValue(phoneInput, CONFIG.phoneNumber);
        await sleep(500);
      }

      // Final submit
      await clickContinueButton();
      await sleep(3000);

      // Check if we're redirected to home
      for (let i = 0; i < 10; i++) {
        await sleep(1000);
        const store = getAuthStore();
        if (store?.userState === 'FullRegister' || location.pathname === '/') {
          updateStatus('onboarding', 'done', '注册完成 ✓');
          return true;
        }
      }

      updateStatus('onboarding', 'warning', '注册流程已执行，请检查状态');
      return true;
    } catch (e) {
      err('Onboarding failed:', e);
      updateStatus('onboarding', 'error', `注册失败: ${e.message}`);
      return false;
    }
  }

  // ── Step 5: Bind PayPal ──
  async function stepBindPaypal() {
    updateStatus('paypal', 'running', '正在绑定 PayPal...');

    if (!CONFIG.paypalEmail) {
      updateStatus('paypal', 'error', '请先在脚本 CONFIG 中填写 PayPal 邮箱');
      return false;
    }

    try {
      // Navigate to cashout page
      if (!location.pathname.includes('/cashout')) {
        location.href = '/cashout';
        await sleep(2000);
        await waitForUrl('/cashout');
        await sleep(1500);
      }

      // Find PayPal payment method card and click it
      const paypalCards = document.querySelectorAll('img[alt*="PayPal"], img[src*="paypal"]');
      if (paypalCards.length > 0) {
        const card = paypalCards[0].closest('button, div[role="button"], [class*="card"]');
        if (card) {
          card.click();
          await sleep(2000);
        }
      }

      // If a modal appears asking for PayPal email, fill it
      await sleep(1000);
      const emailInputs = document.querySelectorAll('input[type="email"], input[placeholder*="PayPal"], input[placeholder*="email"]');
      if (emailInputs.length > 0) {
        const emailInput = emailInputs[0];
        emailInput.focus();
        setNativeValue(emailInput, CONFIG.paypalEmail);
        await sleep(500);

        // Find submit button in modal
        const modalButtons = document.querySelectorAll('button');
        for (const btn of modalButtons) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          if (text.includes('submit') || text.includes('bind') || text.includes('confirm') || text.includes('save')) {
            btn.click();
            await sleep(2000);
            break;
          }
        }
      }

      updateStatus('paypal', 'done', 'PayPal 绑定操作已执行 ✓');
      return true;
    } catch (e) {
      err('Bind PayPal failed:', e);
      updateStatus('paypal', 'error', `绑定 PayPal 失败: ${e.message}`);
      return false;
    }
  }

  // ── Step 6: First Cashout ──
  async function stepCashout() {
    updateStatus('cashout', 'running', '正在发起第一笔提现...');

    try {
      // Navigate to cashout page
      if (!location.pathname.includes('/cashout')) {
        location.href = '/cashout';
        await sleep(2000);
        await waitForUrl('/cashout');
        await sleep(1500);
      }

      // Find the first stage cashout button (StageOne = $0.50)
      await sleep(1000);
      const allButtons = document.querySelectorAll('button');
      let cashoutBtn = null;

      for (const btn of allButtons) {
        const text = btn.textContent?.trim().toLowerCase() || '';
        if (text.includes('cash out') || text.includes('cashout') || text.includes('withdraw') || text.includes('claim')) {
          cashoutBtn = btn;
          break;
        }
      }

      if (cashoutBtn && !cashoutBtn.disabled) {
        cashoutBtn.click();
        await sleep(2000);

        // Handle cashout modal flow
        // The modal might show REMINDER → BIND_PAYPAL / PROCESSING → SUCCESS
        for (let i = 0; i < 10; i++) {
          await sleep(1500);
          const confirmBtns = document.querySelectorAll('button');
          for (const btn of confirmBtns) {
            const text = btn.textContent?.trim().toLowerCase() || '';
            if (text.includes('confirm') || text.includes('cash out') || text.includes('continue') || text.includes('ok')) {
              if (!btn.disabled) {
                btn.click();
                await sleep(1500);
                break;
              }
            }
          }
        }

        updateStatus('cashout', 'done', '提现请求已发起 ✓');
        return true;
      } else {
        updateStatus('cashout', 'warning', '未找到可用的提现按钮，可能任务未完成');
        return false;
      }
    } catch (e) {
      err('Cashout failed:', e);
      updateStatus('cashout', 'error', `提现失败: ${e.message}`);
      return false;
    }
  }

  // Helper: click the main continue/next button on current page
  async function clickContinueButton() {
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent?.trim().toLowerCase() || '';
      if (
        (text.includes('continue') || text.includes('next') || text.includes('submit') || text.includes('done')) &&
        !btn.disabled
      ) {
        btn.click();
        return;
      }
    }
    warn('No continue button found');
  }

  // ── One-Click: Run All Steps ──
  async function runAll() {
    updateStatus('all', 'running', '一键执行中...');
    panelEl.querySelector('#btn-run-all').disabled = true;

    const steps = [
      { key: 'delete', fn: stepDeleteAccount },
      { key: 'otp', fn: stepSendOtp },
      { key: 'login', fn: stepWaitLogin },
      { key: 'onboarding', fn: stepOnboarding },
      { key: 'paypal', fn: stepBindPaypal },
      { key: 'cashout', fn: stepCashout },
    ];

    for (const step of steps) {
      const ok = await step.fn();
      if (!ok) {
        updateStatus('all', 'error', `在 [${step.key}] 步骤停止`);
        panelEl.querySelector('#btn-run-all').disabled = false;
        return;
      }
      await sleep(1000);
    }

    updateStatus('all', 'done', '全部完成 ✓');
    panelEl.querySelector('#btn-run-all').disabled = false;
  }

  // ═══════════════════════════════════════════════
  // UI Panel
  // ═══════════════════════════════════════════════

  let panelEl = null;
  let panelVisible = true;

  const PANEL_STYLE = `
    #autobot-panel {
      position: fixed;
      top: 10px;
      right: 10px;
      width: 320px;
      max-height: 90vh;
      overflow-y: auto;
      background: #1a1a2e;
      color: #eee;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      z-index: 999999;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px;
      transition: transform 0.3s ease, opacity 0.3s ease;
    }
    #autobot-panel.collapsed {
      width: auto;
      max-height: none;
      overflow: hidden;
    }
    #autobot-panel .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: #16213e;
      border-radius: 12px 12px 0 0;
      cursor: move;
      user-select: none;
    }
    #autobot-panel .panel-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 700;
      color: #00bcd4;
    }
    #autobot-panel .panel-body {
      padding: 10px 14px;
    }
    #autobot-panel .config-section {
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #333;
    }
    #autobot-panel .config-section label {
      display: block;
      margin-bottom: 4px;
      font-size: 11px;
      color: #aaa;
    }
    #autobot-panel .config-section input {
      width: 100%;
      padding: 6px 8px;
      background: #0f3460;
      border: 1px solid #444;
      border-radius: 6px;
      color: #eee;
      font-size: 12px;
      box-sizing: border-box;
      margin-bottom: 6px;
    }
    #autobot-panel .config-section input:focus {
      outline: none;
      border-color: #00bcd4;
    }
    #autobot-panel .step-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    #autobot-panel .step-row button {
      flex-shrink: 0;
      padding: 6px 10px;
      background: #0f3460;
      color: #eee;
      border: 1px solid #00bcd4;
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      font-weight: 600;
      white-space: nowrap;
      transition: background 0.2s;
    }
    #autobot-panel .step-row button:hover {
      background: #1a5276;
    }
    #autobot-panel .step-row button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    #autobot-panel .step-status {
      flex: 1;
      font-size: 11px;
      color: #888;
      word-break: break-all;
    }
    #autobot-panel .step-status.running { color: #ffeb3b; }
    #autobot-panel .step-status.done { color: #4caf50; }
    #autobot-panel .step-status.error { color: #f44336; }
    #autobot-panel .step-status.warning { color: #ff9800; }
    #autobot-panel .divider {
      height: 1px;
      background: #333;
      margin: 10px 0;
    }
    #autobot-panel #btn-run-all {
      width: 100%;
      padding: 10px;
      background: linear-gradient(135deg, #00bcd4, #0f3460);
      color: #fff;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 700;
      transition: opacity 0.2s;
    }
    #autobot-panel #btn-run-all:hover { opacity: 0.9; }
    #autobot-panel #btn-run-all:disabled { opacity: 0.5; cursor: not-allowed; }
    #autobot-panel .toggle-btn {
      background: none;
      border: none;
      color: #aaa;
      cursor: pointer;
      font-size: 16px;
      padding: 2px 6px;
    }
    #autobot-panel .user-info {
      padding: 6px 8px;
      background: #0f3460;
      border-radius: 6px;
      margin-bottom: 10px;
      font-size: 11px;
      color: #aaa;
    }
    #autobot-panel .user-info strong { color: #00bcd4; }
  `;

  function createPanel() {
    if (typeof GM_addStyle === 'function') {
      GM_addStyle(PANEL_STYLE);
    } else {
      const style = document.createElement('style');
      style.textContent = PANEL_STYLE;
      document.head.appendChild(style);
    }

    const panel = document.createElement('div');
    panel.id = 'autobot-panel';
    panel.innerHTML = `
      <div class="panel-header">
        <h3>PWA AutoBot</h3>
        <button class="toggle-btn" id="btn-toggle">−</button>
      </div>
      <div class="panel-body" id="panel-body">
        <div class="user-info" id="user-info">加载中...</div>

        <div class="config-section">
          <label>手机号 (美国号码，不含+1)</label>
          <input type="text" id="cfg-phone" placeholder="2025551234" value="${CONFIG.phoneNumber}">
          <label>用户名 (留空自动生成)</label>
          <input type="text" id="cfg-username" placeholder="自动生成" value="${CONFIG.username}">
          <label>年龄</label>
          <input type="number" id="cfg-age" value="${CONFIG.age}">
          <label>PayPal 邮箱</label>
          <input type="email" id="cfg-paypal" placeholder="your@email.com" value="${CONFIG.paypalEmail}">
        </div>

        <div class="step-row">
          <button id="btn-step-delete">1. 注销账号</button>
          <span class="step-status" id="status-delete">待执行</span>
        </div>
        <div class="step-row">
          <button id="btn-step-otp">2. 发送 OTP</button>
          <span class="step-status" id="status-otp">待执行</span>
        </div>
        <div class="step-row">
          <button id="btn-step-login">3. 等待登录</button>
          <span class="step-status" id="status-login">待执行</span>
        </div>
        <div class="step-row">
          <button id="btn-step-onboarding">4. 完成注册</button>
          <span class="step-status" id="status-onboarding">待执行</span>
        </div>
        <div class="step-row">
          <button id="btn-step-paypal">5. 绑定 PayPal</button>
          <span class="step-status" id="status-paypal">待执行</span>
        </div>
        <div class="step-row">
          <button id="btn-step-cashout">6. 第一笔提现</button>
          <span class="step-status" id="status-cashout">待执行</span>
        </div>

        <div class="divider"></div>

        <div class="step-row">
          <span class="step-status" id="status-all" style="text-align:center;width:100%;">—</span>
        </div>
        <button id="btn-run-all">一键执行全部流程</button>
      </div>
    `;

    document.body.appendChild(panel);
    panelEl = panel;

    // Bind config inputs
    panel.querySelector('#cfg-phone').addEventListener('input', (e) => { CONFIG.phoneNumber = e.target.value.trim(); });
    panel.querySelector('#cfg-username').addEventListener('input', (e) => { CONFIG.username = e.target.value.trim(); });
    panel.querySelector('#cfg-age').addEventListener('input', (e) => { CONFIG.age = parseInt(e.target.value) || 22; });
    panel.querySelector('#cfg-paypal').addEventListener('input', (e) => { CONFIG.paypalEmail = e.target.value.trim(); });

    // Bind step buttons
    panel.querySelector('#btn-step-delete').addEventListener('click', () => stepDeleteAccount());
    panel.querySelector('#btn-step-otp').addEventListener('click', () => stepSendOtp());
    panel.querySelector('#btn-step-login').addEventListener('click', () => stepWaitLogin());
    panel.querySelector('#btn-step-onboarding').addEventListener('click', () => stepOnboarding());
    panel.querySelector('#btn-step-paypal').addEventListener('click', () => stepBindPaypal());
    panel.querySelector('#btn-step-cashout').addEventListener('click', () => stepCashout());
    panel.querySelector('#btn-run-all').addEventListener('click', () => runAll());

    // Toggle panel body
    panel.querySelector('#btn-toggle').addEventListener('click', () => {
      panelVisible = !panelVisible;
      panel.querySelector('#panel-body').style.display = panelVisible ? 'block' : 'none';
      panel.querySelector('#btn-toggle').textContent = panelVisible ? '−' : '+';
      if (!panelVisible) panel.classList.add('collapsed');
      else panel.classList.remove('collapsed');
    });

    // Draggable header
    makeDraggable(panel, panel.querySelector('.panel-header'));

    // Update user info periodically
    updateUserInfo();
    setInterval(updateUserInfo, 3000);
  }

  function updateStatus(step, state, msg) {
    if (!panelEl) return;
    const el = panelEl.querySelector(`#status-${step}`);
    if (!el) return;
    el.textContent = msg;
    el.className = `step-status ${state}`;
    log(`[${step}] ${state}: ${msg}`);
  }

  function updateUserInfo() {
    if (!panelEl) return;
    const el = panelEl.querySelector('#user-info');
    if (!el) return;

    const store = getAuthStore();
    const token = getToken();

    if (store?.userInfo) {
      const u = store.userInfo;
      el.innerHTML = `
        <strong>已登录</strong> |
        ID: ${u.userId || '?'} |
        ${u.username || '未设置'} |
        状态: ${store.userState || '?'}
      `;
    } else if (token) {
      el.innerHTML = '<strong>有 Token</strong> | 无用户信息';
    } else {
      el.innerHTML = '<strong>未登录</strong>';
    }
  }

  function makeDraggable(panel, handle) {
    let offsetX, offsetY, isDragging = false;
    handle.addEventListener('mousedown', (e) => {
      isDragging = true;
      offsetX = e.clientX - panel.getBoundingClientRect().left;
      offsetY = e.clientY - panel.getBoundingClientRect().top;
      panel.style.transition = 'none';
    });
    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = (e.clientX - offsetX) + 'px';
      panel.style.top = (e.clientY - offsetY) + 'px';
      panel.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      isDragging = false;
      panel.style.transition = '';
    });
  }

  // ═══════════════════════════════════════════════
  // Init
  // ═══════════════════════════════════════════════
  function init() {
    log('PWA AutoBot loaded');
    createPanel();
  }

  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
