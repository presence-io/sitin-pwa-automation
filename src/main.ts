import { log } from './core/helpers';
import { createPanel } from './ui/panel';
import { configManager } from './testing/config';
import { resolveActivePlugin } from './plugins/registry';
import './plugins/aifantasy'; // self-registers as the default project plugin
import { tracker } from './testing/tracker';
import { startRemote } from './testing/remote';
import { listenSyncControl } from './testing/screensync';
import { installLogCapture } from './testing/logsync';
import { installNetworkCapture } from './testing/networksync';

async function init() {
  installLogCapture();
  installNetworkCapture();
  log('AutoBot v4 loaded');
  await configManager.init();
  resolveActivePlugin(configManager.getProject());
  tracker.install(configManager.getTrackers());
  createPanel();
  startRemote();
  listenSyncControl();
}

if (document.readyState === 'complete' || document.body) init();
else {
  document.addEventListener('DOMContentLoaded', () => init());
  setTimeout(() => { if (!document.getElementById('autobot-fab')) init(); }, 2000);
}
