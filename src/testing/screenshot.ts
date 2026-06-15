export async function captureScreenshot(): Promise<string | null> {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;

    const bgColor = window.getComputedStyle(document.body).backgroundColor || '#fff';
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, w, h);

    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('#autobot-panel, #autobot-fab, #autobot-minibar, #__vconsole, .vc-mask, img, video, canvas').forEach(el => el.remove());
    clone.querySelectorAll('link[rel="stylesheet"]').forEach(el => el.remove());

    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <foreignObject width="100%" height="100%">${html}</foreignObject>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas.toDataURL('image/jpeg', 0.6));
        } catch {
          URL.revokeObjectURL(url);
          resolve(null);
        }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch {
    return null;
  }
}
