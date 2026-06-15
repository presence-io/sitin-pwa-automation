export async function captureScreenshot(): Promise<string | null> {
  try {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const autobotEls = clone.querySelectorAll('#autobot-panel, #autobot-fab, #autobot-minibar');
    autobotEls.forEach(el => el.remove());

    const html = new XMLSerializer().serializeToString(clone);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
      <foreignObject width="100%" height="100%">
        ${html}
      </foreignObject>
    </svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);

    return new Promise<string | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d')!.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    });
  } catch {
    return null;
  }
}
