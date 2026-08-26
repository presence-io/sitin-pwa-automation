import { log, warn } from '../core/helpers';
import { setConn } from '../core/bus';
import { configManager } from './config';
import { runSuite, cancelRun, wasCancelled } from './runner';
import { generateReport, printReportToConsole } from './reporter';
import { fetchRemoteSuite } from './repository';
import { runStage, runAllStages } from '../stages/runner';
import { st as panelSt, disableAll as panelDisableAll } from '../ui/panel';
import {
  fbPut, fbGet, fbPatch, fbDelete, fbListen,
  type FbSub, type DeviceInfo, type RemoteCommand, type CommandProgress,
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

// Optional human-friendly name for this device, set from the panel. Sent with
// every register/heartbeat so the dashboard can show "我的红米" instead of a
// random id. Empty string means "no label" (dashboard falls back to deviceId).
function getDeviceLabel(): string {
  return localStorage.getItem('autobot_device_label') || '';
}

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let commandsSub: FbSub | null = null;
const dispatchedCommands = new Set<string>();
let onCommandCallback: ((cmd: RemoteCommand) => void) | null = null;

async function registerDevice(): Promise<void> {
  const deviceId = getDeviceId();
  const info: DeviceInfo = {
    deviceId,
    project: configManager.getProject(),
    status: 'online',
    lastSeen: Date.now(),
    userAgent: navigator.userAgent,
    label: getDeviceLabel(),
    title: document.title,
  };
  await fbPut(`devices/${deviceId}`, info);
  log('Device registered:', deviceId);
}

async function sendHeartbeat(): Promise<void> {
  const deviceId = getDeviceId();
  try {
    // Carry identity fields so a heartbeat that runs after the device was deleted
    // recreates a complete record, not a deviceId-less stub the dashboard chokes on.
    await fbPatch(`devices/${deviceId}`, {
      deviceId,
      status: 'online',
      lastSeen: Date.now(),
      project: configManager.getProject(),
      userAgent: navigator.userAgent,
      label: getDeviceLabel(),
      title: document.title,
    });
    setConn('online');
  } catch {
    setConn('reconnecting');
  }
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
  if (commandsSub) commandsSub.close();

  // CloudBase watch fires on any change to the commands collection. We re-read the
  // whole collection and dispatch pending commands addressed to us exactly once —
  // dedup by id, since a command's status only flips to 'running' once we start it
  // and the watch may fire several times before that write propagates.
  commandsSub = fbListen('commands', async () => {
    setConn('online');
    const data = await fbGet<Record<string, RemoteCommand>>('commands');
    if (!data) return;
    for (const cmd of Object.values(data)) {
      if (cmd && cmd.status === 'pending' && isCommandForMe(cmd) && !dispatchedCommands.has(cmd.id)) {
        dispatchedCommands.add(cmd.id);
        log('Received remote command:', cmd.id);
        onCommandCallback?.(cmd);
      }
    }
  });

  log('Listening for remote commands (CloudBase watch)');
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

    const finalStatus = wasCancelled() ? 'aborted' : (report.summary.failed > 0 ? 'failed' : 'completed');
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
  setConn('connecting');
  try {
    await registerDevice();
    setConn('online');
  } catch (e) {
    // Register is the connectivity probe; on failure keep listeners running so heartbeat/SSE can recover.
    setConn('error');
    warn('Device register failed:', e);
  }
  startHeartbeat();
  listenForCommands();
  onRemoteCommand((cmd) => {
    if (cmd.action === 'abort') {
      log('Abort requested:', cmd.id);
      cancelRun();
      fbPatch(`commands/${cmd.id}`, { status: 'completed' }).catch(() => {});
    } else if (cmd.action === 'stage') executeStageCommand(cmd);
    else executeRemoteCommand(cmd);
  });
  cleanOldCommands().catch(() => {});
}

async function executeStageCommand(cmd: RemoteCommand): Promise<void> {
  await fbPatch(`commands/${cmd.id}`, { status: 'running' });
  const deviceId = getDeviceId();
  const stageIdx = cmd.stageIndex ?? -1;

  try {
    let ok: boolean;
    if (stageIdx === -1) {
      ok = await runAllStages(panelSt, panelDisableAll);
    } else {
      panelDisableAll(true);
      ok = await runStage(stageIdx, panelSt);
      panelDisableAll(false);
    }

    await fbPatch(`commands/${cmd.id}`, { status: ok ? 'completed' : 'failed' });
    await reportProgress(cmd.id, {
      status: ok ? 'completed' : 'failed',
      updatedAt: Date.now(),
    });
  } catch (e) {
    await fbPatch(`commands/${cmd.id}`, { status: 'failed' });
    await reportProgress(cmd.id, { status: 'failed', updatedAt: Date.now() });
  }
}

function stopRemote(): void {
  stopHeartbeat();
  if (commandsSub) { commandsSub.close(); commandsSub = null; }
  const deviceId = getDeviceId();
  fbPatch(`devices/${deviceId}`, { status: 'offline' });
}

export {
  getDeviceId, setDeviceId,
  getOnlineDevices, sendCommand, getCommands,
  startRemote, stopRemote,
};
