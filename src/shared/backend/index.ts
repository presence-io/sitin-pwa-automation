// Backend selector. The injection picks a backend via the script tag:
//
//   <script src=".../autobot.js"
//           data-backend="relay"
//           data-backend-config='{"url":"https://relay.example.com"}'></script>
//
//   firebase  -> {"databaseURL":"https://xxx.firebaseio.com"}   (global, zero-config)
//   relay     -> {"url":"https://relay.example.com"}            (self-hosted, China-friendly)
//   cloudbase -> {"env":"...","region":"ap-shanghai"}           (managed CN; needs 安全来源)
//
// localStorage (autobot_backend / autobot_backend_config) overrides too, so the
// backend can be switched without editing the host page. Falls back to a built-in
// reference env only when nothing is configured — real deployments always set one.

import type { Backend, BackendConfig } from './types';
import { makeFirebaseBackend } from './firebase';
import { makeRelayBackend } from './relay';
import { makeCloudbaseBackend } from './cloudbase';

// Default when nothing is configured: the original Firebase RTDB, so a zero-config
// injection keeps the current production behavior. Adopters override via
// data-backend (relay for self-host/China, cloudbase for managed CN).
const DEFAULT_CONFIG: BackendConfig = {
  backend: 'firebase',
  databaseURL: 'https://autobot-remote-default-rtdb.firebaseio.com',
};

function readConfig(): BackendConfig {
  let backend = '';
  let raw = '';
  try {
    const scripts = document.querySelectorAll('script[src*="autobot"]');
    for (const s of scripts) {
      const d = (s as HTMLScriptElement).dataset;
      if (d.backend) { backend = d.backend; raw = d.backendConfig || ''; break; }
    }
  } catch {}
  if (!backend) {
    backend = localStorage.getItem('autobot_backend') || '';
    raw = localStorage.getItem('autobot_backend_config') || '';
  }
  if (!backend) return DEFAULT_CONFIG;
  let cfg: any = {};
  if (raw) { try { cfg = JSON.parse(raw); } catch (e) { console.error('[fb] bad data-backend-config JSON', e); } }
  return { backend: backend as BackendConfig['backend'], ...cfg };
}

export function selectBackend(): Backend {
  const cfg = readConfig();
  switch (cfg.backend) {
    case 'firebase': return makeFirebaseBackend(cfg as any);
    case 'relay': return makeRelayBackend(cfg as any);
    case 'cloudbase': return makeCloudbaseBackend(cfg as any);
    default:
      console.error('[fb] unknown backend', cfg.backend, '— falling back to firebase');
      return makeFirebaseBackend(DEFAULT_CONFIG as any);
  }
}
