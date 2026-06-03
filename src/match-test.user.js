// ==UserScript==
// @name         AutoBot Match Test
// @namespace    autobot-test
// @version      0.0.1
// @description  测试 Tampermonkey 是否在当前页面生效
// @match        *://*/*
// @run-at       document-start
// ==/UserScript==

console.log('%c[AutoBot:test]', 'color:#ff5722;font-weight:bold;font-size:16px',
  'Tampermonkey IS running on this page!', {
    url: location.href,
    origin: location.origin,
    timestamp: new Date().toISOString()
  }
);

alert('[AutoBot:test] Tampermonkey 在此页面生效了！\n\nURL: ' + location.href);
