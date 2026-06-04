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
  // Config (persisted to localStorage)
  // ═══════════════════════════════════════════════
  const AUTOBOT_CONFIG_KEY = 'autobot_config';

  function loadConfig() {
    try {
      const raw = localStorage.getItem(AUTOBOT_CONFIG_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  }
  function saveConfig() {
    localStorage.setItem(AUTOBOT_CONFIG_KEY, JSON.stringify(CONFIG));
  }

  const savedCfg = loadConfig();
  const CONFIG = {
    username: savedCfg.username ?? '',
    age: savedCfg.age ?? 22,
    paypalEmail: savedCfg.paypalEmail ?? 'autobot_test@gmail.com',
    photoUrl: savedCfg.photoUrl ?? 'https://file.archat.us/cai/user_custom_avatar/2100048298/e41dd7af-75e5-43c4-a88f-d3521824879e.jpg',
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

  // Type text into a React controlled input character by character
  async function typeIntoInput(el, text) {
    el.focus();
    await sleep(100);
    // Clear first
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(50);
    // Type char by char
    for (const ch of text) {
      const cur = el.value || '';
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, cur + ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(20);
    }
    log('Typed into input:', el.value);
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

  // Generate a random avatar image (canvas-based, returns a File)
  function generateAvatarFile() {
    const size = 400;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Random background gradient
    const hue = Math.floor(Math.random() * 360);
    const grad = ctx.createLinearGradient(0, 0, size, size);
    grad.addColorStop(0, `hsl(${hue}, 70%, 80%)`);
    grad.addColorStop(1, `hsl(${(hue + 60) % 360}, 70%, 65%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Simple face: skin-tone circle
    ctx.fillStyle = '#FFDBB4';
    ctx.beginPath();
    ctx.arc(size/2, size/2 - 10, 120, 0, Math.PI * 2);
    ctx.fill();

    // Eyes
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.arc(size/2 - 35, size/2 - 30, 10, 0, Math.PI * 2);
    ctx.arc(size/2 + 35, size/2 - 30, 10, 0, Math.PI * 2);
    ctx.fill();

    // Smile
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(size/2, size/2 + 10, 40, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();

    // Hair
    ctx.fillStyle = `hsl(${Math.floor(Math.random()*40)+10}, 40%, 25%)`;
    ctx.beginPath();
    ctx.ellipse(size/2, size/2 - 100, 130, 60, 0, Math.PI, 0);
    ctx.fill();

    return new Promise((resolve) => {
      canvas.toBlob((blob) => {
        resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
      }, 'image/jpeg', 0.9);
    });
  }

  // Fetch an image URL and return as File (via canvas to guarantee valid image blob)
  function fetchImageAsFile(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error('Canvas toBlob failed')); return; }
          resolve(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
      };
      img.onerror = () => reject(new Error('Image load failed: ' + url));
      img.src = url;
    });
  }

  // Inject a File into a file input element (triggers React's onChange)
  function injectFileToInput(inputEl, file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Auto-dismiss any reward/congrats/popup modals
  // skipCashout: don't click "Cash out" buttons (used after onboarding to avoid triggering cashout flow)
  async function dismissModals(skipCashout = false) {
    log('[dismissModals] start, skipCashout:', skipCashout);
    for (let round = 0; round < 8; round++) {
      const allBtns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      log(`[dismissModals] round ${round}, visible buttons:`, allBtns.map(b => `"${b.textContent?.trim()}" disabled=${b.disabled}`));

      const closeImgs = [...document.querySelectorAll('img')].filter(i => i.alt?.toLowerCase().includes('close') && i.offsetParent !== null);
      log(`[dismissModals] close images:`, closeImgs.length);

      // Build keyword list based on context
      const keywords = ['continue earning', 'got it', 'continue', 'ok', 'close'];
      if (!skipCashout) keywords.push('cash out');

      const btn = findBtn(keywords);
      if (btn) {
        log('[dismissModals] clicking button:', btn.textContent.trim());
        btn.click();
        await sleep(1200);
        continue;
      }

      // aria-label close button
      const closeBtn = document.querySelector('button[aria-label="Close"], button[aria-label="close"]');
      if (closeBtn && closeBtn.offsetParent !== null) {
        log('[dismissModals] clicking close button (aria-label)');
        closeBtn.click();
        await sleep(1000);
        continue;
      }

      // img[alt="close"] clickable directly
      if (closeImgs.length > 0) {
        log('[dismissModals] clicking close img');
        closeImgs[0].click();
        await sleep(1000);
        continue;
      }

      log('[dismissModals] nothing to dismiss, done');
      break;
    }
  }

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
        const btn = findBtn(['claim', 'continue', 'next']);
        if (btn) { log('Click:', btn.textContent.trim()); btn.click(); }
        await sleep(3500); // wait for money animation (2s) + transition
      }

      // ── Page 2: Age ──
      log('Onboarding step 2: age');
      await sleep(500);
      const ageInput = document.querySelector('input[type="number"], input[inputmode="numeric"]');
      if (ageInput) {
        ageInput.focus();
        setNativeValue(ageInput, String(CONFIG.age));
        await sleep(300);
        const btn = findBtn(['claim', 'continue', 'next']);
        if (btn) { log('Click:', btn.textContent.trim()); btn.click(); }
        await sleep(3500);
      }

      // ── Page 3: Photo ──
      log('Onboarding step 3: photo');
      await sleep(500);

      // Check if photo button is disabled (no photo uploaded yet)
      let photoBtn = findBtn(['claim']);
      if (!photoBtn || photoBtn.disabled) {
        log('No photo yet, auto-uploading...');

        // Prepare photo file
        let photoFile;
        try {
          if (CONFIG.photoUrl) {
            log('Fetching photo from URL:', CONFIG.photoUrl);
            photoFile = await fetchImageAsFile(CONFIG.photoUrl);
          } else {
            log('Generating random avatar');
            photoFile = await generateAvatarFile();
          }
        } catch (e) {
          warn('Failed to prepare photo:', e);
          updateStatus('onboarding', 'warning', '头像准备失败，需手动上传');
          return false;
        }

        // Find hidden file input and inject file
        const fileInput = document.querySelector('input[type="file"][accept*="image"]');
        if (fileInput) {
          log('Injecting file into input');
          injectFileToInput(fileInput, photoFile);
          await sleep(2000);

          // Handle crop modal — find and click confirm/save/done button
          for (let i = 0; i < 5; i++) {
            await sleep(800);
            const cropBtn = findBtn(['upload', 'save', 'done', 'confirm', 'crop', 'ok']);
            if (cropBtn) {
              log('Crop modal: clicking', cropBtn.textContent.trim());
              cropBtn.click();
              await sleep(1500);
              break;
            }
          }

          // Now click the Claim button and wait for page transition
          // Beauty check may fail randomly — retry up to 3 times
          let photoAdvanced = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            await sleep(1000);
            photoBtn = findBtn(['claim']);
            if (!photoBtn || photoBtn.disabled) {
              warn('Photo Claim button not ready on attempt', attempt);
              await sleep(2000);
              continue;
            }

            log('Click Claim (attempt', attempt + 1, '):', photoBtn.textContent.trim());
            photoBtn.click();

            // Wait for photo upload + beauty check + page transition (up to 30s)
            log('Waiting for photo upload + page transition...');
            for (let w = 0; w < 30; w++) {
              await sleep(1000);
              const s = getAuthStore();
              const pageText = document.body.innerText || '';
              if (pageText.includes('US+1') || pageText.includes('Phone Number')) {
                log('Phone page appeared after photo step');
                photoAdvanced = true;
                break;
              }
              if (s?.userState === 'FullRegister' || location.pathname === '/') {
                log('Registration completed after photo step');
                await sleep(1500);
                await dismissModals();
                updateStatus('onboarding', 'done', '注册完成 ✓');
                return true;
              }
              if (w % 5 === 0) log('Still waiting for photo step...', w + 's');
            }

            if (photoAdvanced) break;
            warn('Beauty check may have failed, retrying... (attempt', attempt + 1, ')');
            await sleep(1000);
          }

          if (!photoAdvanced) {
            updateStatus('onboarding', 'warning', '头像步骤多次重试仍未通过');
            return false;
          }
        } else {
          // No file input found, try clicking upload area to trigger it
          warn('File input not found, trying upload area click');
          const uploadArea = document.querySelector('[class*="dashed"]');
          if (uploadArea) uploadArea.click();
          await sleep(1000);

          const fi = document.querySelector('input[type="file"]');
          if (fi) {
            injectFileToInput(fi, photoFile);
            await sleep(3000);
            const cropBtn = findBtn(['save', 'done', 'confirm', 'ok']);
            if (cropBtn) { cropBtn.click(); await sleep(1500); }
            photoBtn = findBtn(['claim']);
            if (photoBtn && !photoBtn.disabled) { photoBtn.click(); await sleep(3500); }
          } else {
            updateStatus('onboarding', 'warning', '找不到文件上传入口');
            return false;
          }
        }
      } else {
        log('Photo already uploaded, clicking:', photoBtn.textContent.trim());
        photoBtn.click();
        await sleep(3500);
      }

      // ── Page 4: Phone (already detected above, or detect now) ──
      log('Onboarding step 4: checking phone page...');
      await sleep(500);

      // Check if phone page is visible
      let phonePage = false;
      for (let i = 0; i < 5; i++) {
        const allText = document.body.innerText || '';
        if (allText.includes('US+1') || allText.includes('Phone Number')) {
          phonePage = true;
          break;
        }
        const s = getAuthStore();
        if (s?.userState === 'FullRegister' || location.pathname === '/') {
          updateStatus('onboarding', 'done', '注册完成 ✓');
          return true;
        }
        await sleep(600);
      }

      if (phonePage) {
        log('Phone page detected');
        const phoneInput = document.querySelector('input[inputmode="numeric"]');
        if (phoneInput) {
          phoneInput.focus();
          await sleep(200);

          // Clear existing value first
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(phoneInput, '');
          phoneInput.dispatchEvent(new Event('input', { bubbles: true }));
          await sleep(100);

          // Type digits one by one
          const digits = '2025551234';
          for (const ch of digits) {
            const cur = phoneInput.value || '';
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(phoneInput, cur + ch);
            phoneInput.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
            await sleep(50);
          }
          log('Phone filled:', phoneInput.value);
          await sleep(500);

          // Click "Next" button
          const nextBtn = findBtn(['next']);
          if (nextBtn) {
            log('Click:', nextBtn.textContent.trim());
            nextBtn.click();
          } else {
            warn('Next button not found on phone page');
          }
          await sleep(2000);

          // Handle confirm dialog — wait for it to appear and click "Confirm"
          for (let i = 0; i < 10; i++) {
            await sleep(500);
            const confirmBtn = findBtn(['confirm']);
            if (confirmBtn) {
              log('Click confirm dialog');
              confirmBtn.click();
              await sleep(2000);
              break;
            }
            log('Waiting for confirm dialog...', i);
          }
        } else {
          warn('Phone input not found on phone page');
        }
      } else {
        log('Phone page not visible, skipping');
      }

      // Wait for registration to complete
      for (let i = 0; i < 15; i++) {
        await sleep(1000);
        const s = getAuthStore();
        if (s?.userState === 'FullRegister' || location.pathname === '/') {
          // Auto-dismiss any reward/congrats modals (but NOT cashout — we handle that later)
          await sleep(1500);
          await dismissModals(true);
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
  // Step 4: Bind PayPal (+ handle cashout reminder modal)
  // ═══════════════════════════════════════════════
  async function stepBindPaypal() {
    updateStatus('paypal', 'running', '正在绑定 PayPal...');

    if (!CONFIG.paypalEmail) {
      updateStatus('paypal', 'error', '请填写 PayPal 邮箱');
      return false;
    }

    try {
      // After onboarding, Stage 1 cashout reminder modal may be showing
      // It has a "Cash out" button — clicking it starts the cashout flow
      // which then shows BindPaypalModal if no PayPal is bound.
      // So: click "Cash out" on the reminder → fill PayPal email in bind modal → done

      // Step A: If cashout reminder modal is visible, click "Cash out" to proceed
      await sleep(1000);
      let cashoutBtn = findBtn(['cash out']);
      if (cashoutBtn) {
        log('[PayPal] Cashout reminder modal detected, clicking Cash out to trigger bind flow');
        cashoutBtn.click();
        await sleep(2000);
      } else {
        // No modal — navigate to cashout page manually
        log('[PayPal] No cashout modal, navigating to /cashout');
        if (!location.pathname.includes('/cashout')) {
          spaNavigate('/cashout');
          await sleep(2000);
        }
        // Find and click PayPal payment card
        await sleep(1000);
        const paypalImgs = document.querySelectorAll('img[src*="paypal"]');
        if (paypalImgs.length > 0) {
          const card = paypalImgs[0].closest('button, div[role="button"], div[class*="card"]');
          if (card) { card.click(); await sleep(2000); }
        }
      }

      // Step B: Wait for PayPal email input to appear (BindPaypalModal)
      // IMPORTANT: exclude inputs inside #autobot-panel to avoid matching our own config input
      log('[PayPal] Waiting for email input...');
      let emailInput = null;
      for (let i = 0; i < 10; i++) {
        const candidates = [...document.querySelectorAll('input[type="email"]')]
          .filter(inp => !inp.closest('#autobot-panel') && inp.offsetParent !== null);
        log(`[PayPal] round ${i}, email inputs (excl panel):`, candidates.map(inp => ({
          placeholder: inp.placeholder,
          value: inp.value,
        })));
        if (candidates.length > 0) {
          emailInput = candidates[0];
          break;
        }
        await sleep(800);
      }

      if (emailInput) {
        log('[PayPal] About to type into email input, current value:', emailInput.value);
        await typeIntoInput(emailInput, CONFIG.paypalEmail);
        log('[PayPal] After typing, input value:', emailInput.value);
        await sleep(500);

        // Dump all visible buttons to find the right submit one
        const allBtns = [...document.querySelectorAll('button')].filter(b => b.offsetParent !== null);
        log('[PayPal] visible buttons:', allBtns.map(b => `"${b.textContent?.trim()}" disabled=${b.disabled}`));

        // Click submit/bind button
        const submitBtn = findBtn(['next', 'submit', 'bind', 'confirm', 'save', 'done']);
        if (submitBtn) {
          log('[PayPal] Clicking submit:', submitBtn.textContent.trim());
          submitBtn.click();
          // After PayPal bind in Stage 1, cashout flow continues automatically
          // (BIND_PAYPAL → PROCESSING → SUCCESS), so handle those modals here
          log('[PayPal] Waiting for cashout flow to complete...');
          for (let i = 0; i < 20; i++) {
            await sleep(1500);
            // Check for success or processing modals
            const actionBtn = [...document.querySelectorAll('button')]
              .filter(b => !b.closest('#autobot-panel') && b.offsetParent !== null)
              .find(b => {
                const t = b.textContent?.trim().toLowerCase() || '';
                return (t.includes('got it') || t.includes('continue earning') || t.includes('ok')) && !b.disabled;
              });
            if (actionBtn) {
              log('[PayPal] Cashout success, clicking:', actionBtn.textContent.trim());
              actionBtn.click();
              await sleep(1000);
              break;
            }
          }
          await dismissModals();
        } else {
          warn('[PayPal] No submit button found!');
        }
        updateStatus('paypal', 'done', 'PayPal 绑定完成 ✓');
      } else {
        warn('[PayPal] Email input not found — maybe already bound?');
        updateStatus('paypal', 'warning', '未找到邮箱输入框，可能已绑定');
      }

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

    // Check if cashout was already done during PayPal step (Stage 1 auto-flow)
    const store = getAuthStore();
    if (store?.cash === 0 || store?.videoCallCash === 0) {
      log('[Cashout] Balance is 0, cashout likely already completed in PayPal step');
      spaNavigate('/');
      await sleep(1000);
      updateStatus('cashout', 'done', '提现已完成（PayPal 步骤中自动完成），已返回首页 ✓');
      return true;
    }

    try {
      if (!location.pathname.includes('/cashout')) {
        spaNavigate('/cashout');
        await sleep(2000);
      }

      // Wait for cashout page to fully render
      await sleep(2000);

      // Dismiss any lingering modals/popups first (APK install dialog etc.)
      await dismissModals();
      await sleep(1000);

      // Find the Cash Out button specifically — it's inside StageTaskContainer,
      // text is exactly "Cash Out", and it must NOT be disabled
      let cashoutBtn = null;
      const allBtns = document.querySelectorAll('button');
      for (const btn of allBtns) {
        const text = btn.textContent?.trim() || '';
        // Match "Cash Out" exactly (not "Claim", not "Go", not disabled)
        if (text === 'Cash Out' && !btn.disabled) {
          cashoutBtn = btn;
          break;
        }
      }

      if (!cashoutBtn) {
        // Maybe tasks not completed yet — try to find any Cash Out button even if disabled
        let anyFound = false;
        for (const btn of allBtns) {
          if (btn.textContent?.trim() === 'Cash Out') {
            anyFound = true;
            log('Found Cash Out button but it is disabled:', btn.disabled);
            break;
          }
        }
        if (anyFound) {
          updateStatus('cashout', 'warning', 'Cash Out 按钮不可用（任务未完成或余额不足）');
        } else {
          updateStatus('cashout', 'warning', '未找到 Cash Out 按钮');
        }
        return false;
      }

      log('Clicking Cash Out button');
      cashoutBtn.click();
      await sleep(2000);

      // Walk through cashout modal flow
      // States: BIND_PAYPAL → PROCESSING → SUCCESS, or skip to PROCESSING if already bound
      for (let i = 0; i < 15; i++) {
        await sleep(1500);

        // Look for actionable buttons in the modal (but NOT the underlying Cash Out button)
        const modalBtns = document.querySelectorAll('button');
        for (const btn of modalBtns) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          // Skip the underlying Cash Out buttons
          if (btn.textContent?.trim() === 'Cash Out') continue;

          if ((text.includes('confirm') || text.includes('continue') || text.includes('ok') ||
               text.includes('done') || text.includes('got it') || text.includes('continue earning') ||
               text.includes('next')) &&
              !btn.disabled) {
            log('Modal action:', btn.textContent.trim());
            btn.click();
            await sleep(1000);
            break;
          }
        }

        // Check if we're back to normal (no modal overlay)
        const store = getAuthStore();
        const cashAfter = store?.cash || 0;
        // If modal closed and we see success indicators, we're done
      }

      await dismissModals();
      // Navigate back to home
      spaNavigate('/');
      await sleep(1000);
      updateStatus('cashout', 'done', '提现已发起，已返回首页 ✓');
      return true;
    } catch (e) {
      updateStatus('cashout', 'error', `提现失败: ${e.message}`);
      return false;
    }
  }

  // ═══════════════════════════════════════════════
  // Run All (survives page reload via localStorage)
  // ═══════════════════════════════════════════════
  const AUTOBOT_STATE_KEY = 'autobot_run_state';

  const ALL_STEPS = [
    { key: 'delete', fn: stepDeleteAccount },
    { key: 'login', fn: stepQuickLogin },
    { key: 'onboarding', fn: stepOnboarding },
    { key: 'paypal', fn: stepBindPaypal },
    { key: 'cashout', fn: stepCashout },
  ];

  function saveRunState(stepIndex) {
    localStorage.setItem(AUTOBOT_STATE_KEY, JSON.stringify({ step: stepIndex, ts: Date.now() }));
  }
  function clearRunState() {
    localStorage.removeItem(AUTOBOT_STATE_KEY);
  }
  function getRunState() {
    try {
      const raw = localStorage.getItem(AUTOBOT_STATE_KEY);
      if (!raw) return null;
      const state = JSON.parse(raw);
      // Expire after 5 minutes
      if (Date.now() - state.ts > 5 * 60 * 1000) { clearRunState(); return null; }
      return state;
    } catch { return null; }
  }

  async function runAll(startFrom = 0) {
    updateStatus('all', 'running', '一键执行中...');
    if (panelEl) panelEl.querySelector('#btn-run-all').disabled = true;

    for (let i = startFrom; i < ALL_STEPS.length; i++) {
      const step = ALL_STEPS[i];
      log(`[runAll] step ${i + 1}/${ALL_STEPS.length}: ${step.key}`);

      // Save state BEFORE executing — if page reloads, we resume from this step
      saveRunState(i);

      const ok = await step.fn();
      if (!ok) {
        updateStatus('all', 'error', `在 [${step.key}] 停止`);
        clearRunState();
        if (panelEl) panelEl.querySelector('#btn-run-all').disabled = false;
        return;
      }
      await sleep(800);
    }

    clearRunState();
    updateStatus('all', 'done', '全部完成 ✓');
    if (panelEl) panelEl.querySelector('#btn-run-all').disabled = false;
  }

  // Check for pending run-all after page reload
  function resumeIfNeeded() {
    const state = getRunState();
    if (!state) return;
    const nextStep = state.step + 1; // The step that saved state already ran (delete), skip to next
    if (nextStep >= ALL_STEPS.length) { clearRunState(); return; }
    log(`[runAll] Resuming after page reload, continuing from step ${nextStep + 1} (${ALL_STEPS[nextStep].key})`);
    updateStatus('all', 'running', `页面刷新后恢复，从 [${ALL_STEPS[nextStep].key}] 继续...`);
    // Wait a bit for page to settle, then resume
    setTimeout(() => runAll(nextStep), 3000);
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
          <label>头像 URL (留空自动生成随机头像)</label>
          <input type="text" id="cfg-photo" placeholder="https://... 或留空" value="${CONFIG.photoUrl}">
        </div>
        <div class="row"><button id="btn-s1">1. 注销账号</button><span class="st" id="st-delete">待执行</span></div>
        <div class="row"><button id="btn-s2">2. 快速登录</button><span class="st" id="st-login">待执行</span></div>
        <div class="row"><button id="btn-s3">3. 完成注册</button><span class="st" id="st-onboarding">待执行</span></div>
        <div class="row"><button id="btn-s4">4. 绑定 PayPal</button><span class="st" id="st-paypal">待执行</span></div>
        <div class="row"><button id="btn-s5">5. 第一笔提现</button><span class="st" id="st-cashout">待执行</span></div>
        <div class="divider"></div>
        <div class="row"><span class="st" id="st-all" style="text-align:center;width:100%">—</span></div>
        <button id="btn-run-all">一键执行全部流程</button>
        <div class="divider"></div>
        <div class="row">
          <button id="btn-disable-mock" style="border-color:#ff9800;flex:1">关闭 Mock 视频</button>
          <button id="btn-enable-mock" style="border-color:#4caf50;flex:1">开启 Mock 视频</button>
        </div>
      </div>
    `;
    document.body.appendChild(p);
    panelEl = p;

    console.log('%c[AutoBot:boot]', 'color:#ff5722;font-weight:bold', 'Panel + FAB injected');

    // Close button inside panel header
    p.querySelector('#btn-close').addEventListener('click', togglePanel);

    // Config bindings — save to localStorage on every change
    p.querySelector('#cfg-username').addEventListener('input', e => { CONFIG.username = e.target.value.trim(); saveConfig(); });
    p.querySelector('#cfg-age').addEventListener('input', e => { CONFIG.age = parseInt(e.target.value) || 22; saveConfig(); });
    p.querySelector('#cfg-paypal').addEventListener('input', e => { CONFIG.paypalEmail = e.target.value.trim(); saveConfig(); });
    p.querySelector('#cfg-photo').addEventListener('input', e => { CONFIG.photoUrl = e.target.value.trim(); saveConfig(); });

    // Step buttons
    p.querySelector('#btn-s1').addEventListener('click', () => stepDeleteAccount());
    p.querySelector('#btn-s2').addEventListener('click', () => stepQuickLogin());
    p.querySelector('#btn-s3').addEventListener('click', () => stepOnboarding());
    p.querySelector('#btn-s4').addEventListener('click', () => stepBindPaypal());
    p.querySelector('#btn-s5').addEventListener('click', () => stepCashout());
    p.querySelector('#btn-run-all').addEventListener('click', () => runAll());

    // Mock video toggle
    p.querySelector('#btn-disable-mock').addEventListener('click', () => {
      localStorage.setItem('debug_disable_auto_mock', '1');
      log('Mock 视频已关闭');
      alert('Mock 视频已关闭（刷新页面生效）');
    });
    p.querySelector('#btn-enable-mock').addEventListener('click', () => {
      localStorage.setItem('debug_disable_auto_mock', '0');
      log('Mock 视频已开启');
      alert('Mock 视频已开启（刷新页面生效）');
    });

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
    log('PWA AutoBot v2.1 loaded');
    createPanel();
    resumeIfNeeded();
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
