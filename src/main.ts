import { log } from './core/helpers';
import { createPanel } from './ui/panel';

function init() {
  log('AutoBot v4 loaded');
  createPanel();
}

if (document.readyState === 'complete' || document.body) init();
else {
  document.addEventListener('DOMContentLoaded', init);
  setTimeout(() => { if (!document.getElementById('autobot-fab')) init(); }, 2000);
}
