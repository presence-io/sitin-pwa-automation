import { log, warn } from '../core/helpers';
import { fbPut, fbDelete, fbListen } from '../shared/firebase';
import { getDeviceId } from './remote';

let syncTimer: ReturnType<typeof setInterval> | null = null;
let syncSource: EventSource | null = null;

async function captureAndUpload(): Promise<void> {
  const deviceId = getDeviceId();
  const w = window.innerWidth;
  const h = window.innerHeight;
  const url = location.pathname + location.search;
  const title = document.title;

  // Collect visible text summary for dashboard display
  const visibleText = document.body.innerText.slice(0, 300).replace(/\s+/g, ' ').trim();

  const payload: any = {
    width: w,
    height: h,
    url,
    title,
    visibleText,
    timestamp: Date.now(),
  };

  // Try Canvas screenshot — works on same-origin pages without cross-origin images
  const image = await captureCanvas();
  if (image) {
    payload.image = image;
  }

  await fbPut(`screens/${deviceId}`, payload);
}

async function captureCanvas(): Promise<string | null> {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    // Draw page background
    const bgColor = window.getComputedStyle(document.body).backgroundColor || '#fff';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    // Try foreignObject approach
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('#autobot-panel, #autobot-fab, #autobot-minibar, #__vconsole, .vc-mask, img, video, canvas').forEach(el => el.remove());

    // Remove all external stylesheets that might cause taint
    clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <foreignObject width="100%" height="100%">${html}</foreignObject>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);

    return new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(blobUrl);
          resolve(canvas.toDataURL('image/jpeg', 0.3).split(',')[1]);
        } catch {
          URL.revokeObjectURL(blobUrl);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(null); };
      img.src = blobUrl;
    });
  } catch {
    return null;
  }
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
