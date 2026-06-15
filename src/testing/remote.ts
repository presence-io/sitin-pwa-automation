import { log, warn } from '../core/helpers';
import { configManager } from './config';
import { runSuite } from './runner';
import { generateReport, printReportToConsole } from './reporter';
import { fetchRemoteSuite } from './repository';
import {
  DB_URL, fbPut, fbGet, fbPatch, fbDelete,
  type DeviceInfo, type RemoteCommand, type CommandProgress,
} from '../shared/firebase';
import type { TestReport, TestSuite } from './types';

export type { DeviceInfo, RemoteCommand, CommandProgress };

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

function setDeviceId(id: string): void {
  localStorage.setItem('autobot_device_id', id);
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let eventSource: EventSource | null = null;
let sseHealthTimer: ReturnType<typeof setInterval> | null = null;
let lastSSEEvent = 0;
let onCommandCallback: ((cmd: RemoteCommand) => void) | null = null;

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

function isCommandForMe(cmd: RemoteCommand): boolean {
  const myId = getDeviceId();
  if (cmd.targets && Array.isArray(cmd.targets)) return cmd.targets.includes(myId);
  if ((cmd as any).targetDevice) return (cmd as any).targetDevice === myId;
  return false;
}

function listenForCommands(): void {
  if (eventSource) eventSource.close();
  if (sseHealthTimer) { clearInterval(sseHealthTimer); sseHealthTimer = null; }

  function connect() {
    const url = `${DB_URL}/commands.json`;
    eventSource = new EventSource(url);
    lastSSEEvent = Date.now();

    eventSource.addEventListener('put', (e: MessageEvent) => {
      lastSSEEvent = Date.now();
      try {
        const payload = JSON.parse(e.data);
        if (!payload.data) return;

        const commands: Record<string, RemoteCommand> =
          typeof payload.data === 'object' && !payload.data.id
            ? payload.data
            : { [payload.path.replace('/', '')]: payload.data };

        for (const [, cmd] of Object.entries(commands)) {
          if (cmd && cmd.status === 'pending' && isCommandForMe(cmd)) {
            log('Received remote command:', cmd.id);
            onCommandCallback?.(cmd);
          }
        }
      } catch (err) {
        warn('SSE parse error:', err);
      }
    });

    eventSource.addEventListener('patch', (e: MessageEvent) => {
      lastSSEEvent = Date.now();
      try {
        const payload = JSON.parse(e.data);
        if (!payload.data) return;
        const cmd = payload.data as Partial<RemoteCommand>;
        if (cmd.status === 'pending' && cmd.id) {
          const full = cmd as RemoteCommand;
          if (isCommandForMe(full)) onCommandCallback?.(full);
        }
      } catch {}
    });

    eventSource.addEventListener('keep-alive', () => { lastSSEEvent = Date.now(); });

    eventSource.onerror = () => {
      lastSSEEvent = Date.now();
      warn('SSE connection error, will auto-reconnect');
    };
  }

  connect();

  // Health check: if no SSE event in 90s, force reconnect
  sseHealthTimer = setInterval(() => {
    if (Date.now() - lastSSEEvent > 90000) {
      log('SSE stale, reconnecting...');
      if (eventSource) eventSource.close();
      connect();
    }
  }, 60000);

  log('Listening for remote commands (SSE)');
}

async function reportProgress(cmdId: string, progress: CommandProgress): Promise<void> {
  const deviceId = getDeviceId();
  await fbPut(`results/${cmdId}/${deviceId}`, progress);
}

async function executeRemoteCommand(cmd: RemoteCommand): Promise<void> {
  await fbPatch(`commands/${cmd.id}`, { status: 'running' });
  const deviceId = getDeviceId();

  try {
    let suite: TestSuite | null = null;

    if (cmd.suiteData) {
      suite = cmd.suiteData as TestSuite;
    } else {
      suite = await fetchRemoteSuite(cmd.project, cmd.suite);
    }

    if (!suite) {
      await reportProgress(cmd.id, { status: 'failed', updatedAt: Date.now() });
      await fbPatch(`commands/${cmd.id}`, { status: 'failed' });
      return;
    }

    const total = suite.cases.length;
    await reportProgress(cmd.id, {
      status: 'running',
      progress: { current: 0, total, currentCase: '' },
      updatedAt: Date.now(),
    });

    log('Executing remote command:', cmd.suite);
    let completed = 0;
    const results = await runSuite(suite, (msg) => {
      log(`[remote] ${msg}`);
      const match = msg.match(/^\((\d+)\/(\d+)\)\s+(.+)/);
      if (match) {
        completed = parseInt(match[1]);
        reportProgress(cmd.id, {
          status: 'running',
          progress: { current: completed, total, currentCase: match[3] },
          updatedAt: Date.now(),
        });
      }
    });

    const report = generateReport(suite.name, results);
    printReportToConsole(report);

    const finalStatus = report.summary.failed > 0 ? 'failed' : 'completed';
    await reportProgress(cmd.id, {
      status: finalStatus,
      summary: report.summary,
      duration: report.duration,
      report,
      updatedAt: Date.now(),
    });
    await fbPatch(`commands/${cmd.id}`, { status: finalStatus });
  } catch (e) {
    await reportProgress(cmd.id, { status: 'failed', updatedAt: Date.now() });
    await fbPatch(`commands/${cmd.id}`, { status: 'failed' });
  }
}

async function sendCommand(targetDevice: string, project: string, suite: string): Promise<string> {
  const id = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const cmd: RemoteCommand = {
    id,
    targets: [targetDevice],
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

async function getOnlineDevices(): Promise<DeviceInfo[]> {
  const data = await fbGet<Record<string, DeviceInfo>>('devices');
  if (!data) return [];
  const cutoff = Date.now() - 60000;
  return Object.values(data).filter(d => d.status === 'online' && d.lastSeen > cutoff);
}

async function getCommands(): Promise<RemoteCommand[]> {
  const data = await fbGet<Record<string, RemoteCommand>>('commands');
  if (!data) return [];
  return Object.values(data).sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
}

async function cleanOldCommands(): Promise<void> {
  const data = await fbGet<Record<string, RemoteCommand>>('commands');
  if (!data) return;
  const cutoff = Date.now() - 3600000;
  for (const [key, cmd] of Object.entries(data)) {
    if (cmd.createdAt < cutoff) await fbDelete(`commands/${key}`);
  }
}

function onRemoteCommand(cb: (cmd: RemoteCommand) => void): void {
  onCommandCallback = cb;
}

async function startRemote(): Promise<void> {
  await registerDevice();
  startHeartbeat();
  listenForCommands();
  onRemoteCommand((cmd) => executeRemoteCommand(cmd));
  await cleanOldCommands();
}

function stopRemote(): void {
  stopHeartbeat();
  if (sseHealthTimer) { clearInterval(sseHealthTimer); sseHealthTimer = null; }
  if (eventSource) { eventSource.close(); eventSource = null; }
  const deviceId = getDeviceId();
  fbPatch(`devices/${deviceId}`, { status: 'offline' });
}

export {
  getDeviceId, setDeviceId,
  getOnlineDevices, sendCommand, getCommands,
  startRemote, stopRemote,
};
