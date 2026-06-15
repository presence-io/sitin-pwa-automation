import { log, warn } from '../core/helpers';
import { fbPut, fbDelete, fbListen } from '../shared/firebase';
import { getDeviceId } from './remote';

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: EventSource | null = null;

async function capture(): Promise<string | null> {
  try {
    const canvas = document.createElement('canvas');
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w;
    canvas.height = h;

    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('#autobot-panel, #autobot-fab, #autobot-minibar, #__vconsole, .vc-mask').forEach(el => el.remove());

    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <foreignObject width="100%" height="100%">${html}</foreignObject>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.3));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
}

async function captureAndUpload(): Promise<void> {
  const image = await capture();
  if (!image) return;
  const base64 = image.split(',')[1];
  const deviceId = getDeviceId();
  await fbPut(`screens/${deviceId}`, {
    image: base64,
    width: window.innerWidth,
    height: window.innerHeight,
    url: location.pathname + location.search,
    timestamp: Date.now(),
  });
}

function startSync(fps = 1): void {
  if (syncTimer) return;
  log('Screen sync started');
  captureAndUpload();
  syncTimer = setInterval(captureAndUpload, 1000 / fps);
}

function stopSync(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
    const deviceId = getDeviceId();
    fbDelete(`screens/${deviceId}`);
    log('Screen sync stopped');
  }
}

export function listenSyncControl(): void {
  const deviceId = getDeviceId();
  if (syncSource) syncSource.close();

  syncSource = fbListen(`syncControl/${deviceId}`, async () => {
    try {
      const resp = await fetch(`https://autobot-remote-default-rtdb.firebaseio.com/syncControl/${deviceId}.json`);
      const data = await resp.json();
      if (data?.screenSync) {
        startSync(data.fps || 1);
      } else {
        stopSync();
      }
    } catch {}
  });
}

export function cleanupSync(): void {
  stopSync();
  if (syncSource) { syncSource.close(); syncSource = null; }
}
