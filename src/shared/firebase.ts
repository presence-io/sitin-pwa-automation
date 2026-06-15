export const DB_URL = 'https://autobot-remote-default-rtdb.firebaseio.com';

export async function fbPut(path: string, data: any): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, { method: 'PUT', body: JSON.stringify(data) });
}

export async function fbPatch(path: string, data: any): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, { method: 'PATCH', body: JSON.stringify(data) });
}

export async function fbGet<T>(path: string): Promise<T | null> {
  try {
    const resp = await fetch(`${DB_URL}/${path}.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

export async function fbDelete(path: string): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, { method: 'DELETE' });
}

export function fbListen(path: string, onEvent: (data: any) => void): EventSource {
  let source = createSource();
  let lastEventTime = Date.now();
  let healthCheck: ReturnType<typeof setInterval> | null = null;

  function createSource(): EventSource {
    const s = new EventSource(`${DB_URL}/${path}.json`);
    s.addEventListener('put', (e: MessageEvent) => {
      lastEventTime = Date.now();
      try { onEvent(JSON.parse(e.data)); } catch {}
    });
    s.addEventListener('patch', (e: MessageEvent) => {
      lastEventTime = Date.now();
      try { onEvent(JSON.parse(e.data)); } catch {}
    });
    s.addEventListener('keep-alive', () => { lastEventTime = Date.now(); });
    s.onerror = () => {
      // EventSource auto-reconnects on error, just track the time
      lastEventTime = Date.now();
    };
    return s;
  }

  // Check every 60s — if no event received in 90s, force reconnect
  healthCheck = setInterval(() => {
    if (Date.now() - lastEventTime > 90000) {
      source.close();
      source = createSource();
      lastEventTime = Date.now();
    }
  }, 60000);

  // Override close to also clear the health check
  const origClose = source.close.bind(source);
  source.close = () => {
    if (healthCheck) { clearInterval(healthCheck); healthCheck = null; }
    origClose();
  };

  return source;
}

export interface DeviceInfo {
  deviceId: string;
  project: string | null;
  status: 'online' | 'offline';
  lastSeen: number;
  userAgent: string;
}

export interface RemoteCommand {
  id: string;
  targets: string[];
  action: 'run' | 'abort';
  project: string;
  suite: string;
  suiteData?: any;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdBy?: string;
  createdAt: number;
  result?: any;
}

export interface CommandProgress {
  status: 'running' | 'completed' | 'failed';
  progress?: { current: number; total: number; currentCase: string };
  summary?: { total: number; passed: number; failed: number; skipped: number };
  duration?: number;
  report?: any;
  updatedAt: number;
}
