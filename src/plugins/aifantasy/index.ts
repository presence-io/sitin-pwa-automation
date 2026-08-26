import { log } from '../../core/helpers';
import { registerPlugin } from '../registry';
import type { ProjectPlugin, PanelHost, StatusFn } from '../types';
import { CFG, saveCfg, getAuth, getToken, isInApp } from './config';
import { stepDeleteAccount, stepQuickLogin, stepOnboarding, stepStage1Cashout } from './stage1';
import { doCashout } from './cashout';
import { finishTaskViaDebug, completeTask } from './tasks';
import { triggerMockCall, runMockCalls, installAutoAccept, removeAutoAccept } from './mockCall';
import { autoPost } from './post';
import { runS1, resumeS1 } from '../../stages';

// ── Functions callable from test suites via the `call` action ──
const dummySt: StatusFn = (key, _state, msg) => log(`[${key}] ${msg}`);

const callFunctions: Record<string, (args: any[]) => Promise<void>> = {
  deleteAccount: async () => { await stepDeleteAccount(dummySt); },
  quickLogin: async () => { await stepQuickLogin(dummySt); },
  onboarding: async () => { await stepOnboarding(dummySt); },
  cashout: async () => { await doCashout(); },
  installAutoAccept: async () => { installAutoAccept(); },
  removeAutoAccept: async () => { removeAutoAccept(); },
  completeTask: async (args) => { await completeTask(Number(args[0]), String(args[1] || '')); },
  finishTask: async (args) => { await finishTaskViaDebug(Number(args[0])); },
  mockCalls: async (args) => { await runMockCalls(Number(args[0]) || 1); removeAutoAccept(); },
  mockCallsAuto: async (args) => {
    const earnRequired = Number(args[0]) || 0;
    const durationRequired = Number(args[1]) || 0;
    const pricePerMin = parseFloat(CFG.mockPrice) || 10;
    const callsForEarn = earnRequired > 0 ? Math.ceil(earnRequired / pricePerMin) : 0;
    const callsForDuration = durationRequired > 0 ? Math.ceil(durationRequired) : 0;
    const count = Math.max(callsForEarn, callsForDuration) + 1;
    log(`mockCallsAuto: earn=$${earnRequired}, dur=${durationRequired}min, price=$${pricePerMin}/min → ${count} calls`);
    await runMockCalls(count);
    removeAutoAccept();
  },
  triggerMock: async () => { await triggerMockCall(); },
};

// ── Panel identity line (login state) ──
function identityHtml(): string {
  const s = getAuth();
  if (s?.userInfo) return `<b>ID:</b> ${s.userInfo.userId || '?'} | ${s.userInfo.username || '-'} | ${s.userState || '?'} | ${isInApp() ? 'APP' : 'H5'}`;
  return getToken() ? `Token 存在 | ${isInApp() ? 'APP' : 'H5'}` : '<b>未登录</b>';
}

// ── App-specific panel sections ──
function grpHTML(id: string, title: string, contentHTML: string, openDefault = false) {
  return `<div class="grp" id="grp-${id}">
    <div class="grp-hdr" data-grp="${id}"><span>${title}</span><span class="arr ${openDefault ? 'open' : ''}">▶</span></div>
    <div class="grp-body ${openDefault ? 'open' : ''}"><div class="inner">${contentHTML}</div></div>
  </div>`;
}

function mountPanel(host: PanelHost): void {
  const { container, st, disableAll } = host;

  container.innerHTML = `
    ${grpHTML('cfg', '⚙ 配置', `
      <div class="cfg">
        <label>用户名 (留空随机)</label><input id="cfg-username" value="${CFG.username}">
        <label>年龄</label><input type="number" id="cfg-age" value="${CFG.age}">
        <label>PayPal 邮箱</label><input id="cfg-paypal" value="${CFG.paypalEmail}">
        <label>头像 URL</label><input id="cfg-photo" value="${CFG.photoUrl}">
        <label>Mock 单价 ($/min)</label><input id="cfg-price" value="${CFG.mockPrice}">
      </div>
    `)}

    ${grpHTML('s1', '新用户流程 — 注销 → 登录 → onboarding → $0.50', `
      <div class="row"><button id="btn-del">注销账号</button><span class="st" id="st-s1">待执行</span></div>
      <div class="row"><button id="btn-login">快速登录</button></div>
      <div class="row"><button id="btn-onboard">完成注册</button></div>
      <div class="row"><button id="btn-cashout1">提现 $0.50</button></div>
      <div class="row"><button id="btn-s1-all" class="accent">一键跑完整流程</button></div>
    `, true)}

    ${grpHTML('tools', '🛠 工具', `
      <div class="row"><button id="btn-post" class="wide">自动发帖</button><span class="st" id="st-post">—</span></div>
      <div class="row"><button id="btn-mock" class="wide">触发 Mock Call</button><span class="st" id="st-mock">—</span></div>
      <div class="row">
        <button id="btn-mock-off" class="wide warn">关闭 Mock 视频</button>
        <button id="btn-mock-on" class="wide green">开启 Mock 视频</button>
      </div>
      <div class="row"><button id="btn-task" class="wide">完成指定任务</button><select id="cfg-taskid" style="width:144px;margin-bottom:0;font-size:10px">
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
  `;

  // Group toggles (self-contained, like the teaching/testing sections)
  container.querySelectorAll('.grp-hdr').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const body = hdr.nextElementSibling as HTMLElement;
      const arr = hdr.querySelector('.arr') as HTMLElement;
      body.classList.toggle('open'); arr.classList.toggle('open');
    });
  });

  // Config bindings
  const bind = (id: string, key: keyof typeof CFG) =>
    container.querySelector(id)!.addEventListener('input', (e) => {
      (CFG as any)[key] = (e.target as HTMLInputElement).value.trim(); saveCfg();
    });
  bind('#cfg-username', 'username'); bind('#cfg-age', 'age'); bind('#cfg-paypal', 'paypalEmail');
  bind('#cfg-photo', 'photoUrl'); bind('#cfg-price', 'mockPrice');

  // Stage 1
  container.querySelector('#btn-del')!.addEventListener('click', () => stepDeleteAccount(st));
  container.querySelector('#btn-login')!.addEventListener('click', () => stepQuickLogin(st));
  container.querySelector('#btn-onboard')!.addEventListener('click', () => stepOnboarding(st));
  container.querySelector('#btn-cashout1')!.addEventListener('click', () => stepStage1Cashout(st));
  container.querySelector('#btn-s1-all')!.addEventListener('click', () => runS1(st, disableAll));

  // Tools
  container.querySelector('#btn-post')!.addEventListener('click', () => autoPost((msg) => st('post', 'running', msg)));
  container.querySelector('#btn-mock')!.addEventListener('click', () => triggerMockCall());
  container.querySelector('#btn-mock-off')!.addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '1'); alert('Mock 视频已关闭'); });
  container.querySelector('#btn-mock-on')!.addEventListener('click', () => { localStorage.setItem('debug_disable_auto_mock', '0'); alert('Mock 视频已开启'); });
  container.querySelector('#btn-task')!.addEventListener('click', () => {
    const id = (container.querySelector('#cfg-taskid') as HTMLSelectElement).value.trim();
    if (id) finishTaskViaDebug(Number(id));
  });

  resumeS1(st, disableAll);
}

const aifantasyPlugin: ProjectPlugin = {
  // Project key exactly as configured in the injection (script[data-project] /
  // localStorage autobot_project) — the whole system (Firebase suites/{id},
  // dashboard) uses 'gracechat'. The target app is aifantasy, but the historical
  // project key stays 'gracechat' so plugin selection actually matches; renaming
  // the key would need reconfiguring the injection + migrating Firebase.
  id: 'gracechat',
  panelTitle: 'AutoBot v4',
  stages: [
    { id: 's1', name: '新用户完整流程', amount: '$0.50', suiteFile: 'stage1.json' },
  ],
  callFunctions,
  identityHtml,
  mountPanel,
};

registerPlugin(aifantasyPlugin, { default: true });

export default aifantasyPlugin;
