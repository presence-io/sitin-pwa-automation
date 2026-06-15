import { log } from './core/helpers';
import { createPanel } from './ui/panel';
import { configManager } from './testing/config';
import { tracker } from './testing/tracker';
import { startRemote } from './testing/remote';

async function init() {
  log('AutoBot v4 loaded');
  await configManager.init();
  tracker.install(configManager.getTrackers());
  createPanel();
  startRemote();
}

if (document.readyState === 'complete' || document.body) init();
else {
  document.addEventListener('DOMContentLoaded', () => init());
  setTimeout(() => { if (!document.getElementById('autobot-fab')) init(); }, 2000);
}
