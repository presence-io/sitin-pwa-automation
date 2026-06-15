import { log, warn } from '../core/helpers';
import { configManager } from './config';
import { runSuite } from './runner';
import { generateReport, printReportToConsole } from './reporter';
import { fetchRemoteSuite } from './repository';
import type { TestReport, TestSuite } from './types';

const DB_URL = 'https://autobot-remote-default-rtdb.firebaseio.com';

export interface DeviceInfo {
  deviceId: string;
  project: string | null;
  status: 'online' | 'offline';
  lastSeen: number;
  userAgent: string;
}

export interface RemoteCommand {
  id: string;
  targetDevice: string;
  action: 'run';
  project: string;
  suite: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  result?: TestReport | null;
}

function getDeviceId(): string {
  let id = localStorage.getItem('autobot_device_id');
  if (!id) {
    const ua = navigator.userAgent;
    const short = ua.includes('iPhone') ? 'iPhone' :
                  ua.includes('Android') ? 'Android' :
                  ua.includes('Mac') ? 'Mac' :
                  ua.includes('Windows') ? 'Win' : 'Device';
    id = `${short}-${Math.random().toString(36).slice(2, 6)}`;
    localStorage.setItem('autobot_device_id', id);
  }
  return id;
}

export function setDeviceId(id: string): void {
  localStorage.setItem('autobot_device_id', id);
}

async function fbPut(path: string, data: any): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

async function fbPatch(path: string, data: any): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

async function fbGet<T>(path: string): Promise<T | null> {
  try {
    const resp = await fetch(`${DB_URL}/${path}.json`);
    if (!resp.ok) return null;
    return await resp.json();
  } catch { return null; }
}

async function fbDelete(path: string): Promise<void> {
  await fetch(`${DB_URL}/${path}.json`, { method: 'DELETE' });
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let eventSource: EventSource | null = null;
let onCommandCallback: ((cmd: RemoteCommand) => void) | null = null;
let onDeviceListCallback: ((devices: DeviceInfo[]) => void) | null = null;

async function registerDevice(): Promise<void> {
  const deviceId = getDeviceId();
  const info: DeviceInfo = {
    deviceId,
    project: configManager.getProject(),
    status: 'online',
    lastSeen: Date.now(),
    userAgent: navigator.userAgent,
  };
  await fbPut(`devices/${deviceId}`, info);
  log('Device registered:', deviceId);
}

async function sendHeartbeat(): Promise<void> {
  const deviceId = getDeviceId();
  await fbPatch(`devices/${deviceId}`, {
    status: 'online',
    lastSeen: Date.now(),
    project: configManager.getProject(),
  });
}

function startHeartbeat(): void {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => sendHeartbeat(), 30000);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

function listenForCommands(): void {
  if (eventSource) eventSource.close();

  const deviceId = getDeviceId();
  const url = `${DB_URL}/commands.json?orderBy="targetDevice"&equalTo="${deviceId}"`;

  eventSource = new EventSource(url);

  eventSource.addEventListener('put', (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data);
      if (!payload.data) return;

      const commands: Record<string, RemoteCommand> = typeof payload.data === 'object' && !payload.data.id
        ? payload.data
        : { [payload.path.replace('/', '')]: payload.data };

      for (const [key, cmd] of Object.entries(commands)) {
        if (cmd && cmd.status === 'pending') {
          log('Received remote command:', cmd.id);
          onCommandCallback?.(cmd);
        }
      }
    } catch (err) {
      warn('SSE parse error:', err);
    }
  });

  eventSource.addEventListener('patch', (e: MessageEvent) => {
    try {
      const payload = JSON.parse(e.data);
      if (!payload.data) return;
      const cmd = payload.data as Partial<RemoteCommand>;
      if (cmd.status === 'pending' && cmd.id) {
        onCommandCallback?.(cmd as RemoteCommand);
      }
    } catch {}
  });

  eventSource.onerror = () => {
    warn('SSE connection error, will auto-reconnect');
  };

  log('Listening for remote commands (SSE)');
}

async function executeRemoteCommand(cmd: RemoteCommand): Promise<void> {
  await fbPatch(`commands/${cmd.id}`, { status: 'running' });

  try {
    const manifest = await fbGet<any>(`devices/${cmd.targetDevice}`);
    const suite = await fetchRemoteSuite(cmd.project, cmd.suite);

    if (!suite) {
      await fbPatch(`commands/${cmd.id}`, { status: 'failed', result: { error: 'Suite not found' } });
      return;
    }

    log('Executing remote command:', cmd.suite);
    const results = await runSuite(suite, (msg) => log(`[remote] ${msg}`));
    const report = generateReport(suite.name, results);
    printReportToConsole(report);

    await fbPatch(`commands/${cmd.id}`, {
      status: report.summary.failed > 0 ? 'failed' : 'completed',
      result: {
        suite: report.suite,
        summary: report.summary,
        duration: report.duration,
        timestamp: report.timestamp,
      },
    });
  } catch (e) {
    await fbPatch(`commands/${cmd.id}`, { status: 'failed', result: { error: String(e) } });
  }
}

export async function sendCommand(targetDevice: string, project: string, suite: string): Promise<string> {
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cmd: RemoteCommand = {
    id,
    targetDevice,
    action: 'run',
    project,
    suite,
    status: 'pending',
    createdAt: Date.now(),
    result: null,
  };
  await fbPut(`commands/${id}`, cmd);
  log('Command sent:', id, '→', targetDevice);
  return id;
}

export async function getOnlineDevices(): Promise<DeviceInfo[]> {
  const data = await fbGet<Record<string, DeviceInfo>>('devices');
  if (!data) return [];
  const cutoff = Date.now() - 60000;
  return Object.values(data).filter(d => d.status === 'online' && d.lastSeen > cutoff);
}

export async function getCommands(): Promise<RemoteCommand[]> {
  const data = await fbGet<Record<string, RemoteCommand>>('commands');
  if (!data) return [];
  return Object.values(data).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
}

export async function cleanOldCommands(): Promise<void> {
  const data = await fbGet<Record<string, RemoteCommand>>('commands');
  if (!data) return;
  const cutoff = Date.now() - 3600000;
  for (const [key, cmd] of Object.entries(data)) {
    if (cmd.createdAt < cutoff) await fbDelete(`commands/${key}`);
  }
}

export function onRemoteCommand(cb: (cmd: RemoteCommand) => void): void {
  onCommandCallback = cb;
}

export async function startRemote(): Promise<void> {
  await registerDevice();
  startHeartbeat();
  listenForCommands();
  onRemoteCommand((cmd) => executeRemoteCommand(cmd));
  await cleanOldCommands();
}

export function stopRemote(): void {
  stopHeartbeat();
  if (eventSource) { eventSource.close(); eventSource = null; }
  const deviceId = getDeviceId();
  fbPatch(`devices/${deviceId}`, { status: 'offline' });
}

export { getDeviceId };
