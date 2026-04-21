/**
 * JPEG Ghost.
 * Re-encodes the current image at `quality`, computes per-block MSE vs
 * original, renders heatmap. Low-error regions at a given Q = already at
 * that quality = recompression artifact.
 */
export const jpegGhostFilter = {
  id: 'jpeg-ghost',
  name: 'JPEG Ghost',
  slow: true,
  presets: [
    { name: 'Q50', params: { quality: 50, blockSize: 16 } },
    { name: 'Q70', params: { quality: 70, blockSize: 16 } },
    { name: 'Q85', params: { quality: 85, blockSize: 16 } },
    { name: 'Q90', params: { quality: 90, blockSize: 16 } },
  ],
  defaultPreset: 'Q70',
  paramSchema: [
    { id: 'quality', label: 'Quality', type: 'range', min: 30, max: 95, step: 5 },
    {
      id: 'blockSize', label: 'Block Size', type: 'select',
      options: [
        { value: 8,  label: '8 px' },
        { value: 16, label: '16 px' },
      ],
    },
  ],

  apply(imageData, params) {
    const quality = +params.quality;
    const blockSize = (params.blockSize | 0) || 16;
    const W = imageData.width, H = imageData.height;

    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = W; tmpCanvas.height = H;
    tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);

    return new Promise((resolve) => {
      tmpCanvas.toBlob((blob) => {
        if (!blob) { resolve(imageData); return; }
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const cmpCanvas = document.createElement('canvas');
          cmpCanvas.width = W; cmpCanvas.height = H;
          const cmpCtx = cmpCanvas.getContext('2d');
          cmpCtx.drawImage(img, 0, 0);
          const cmp = cmpCtx.getImageData(0, 0, W, H).data;

          const out = new ImageData(W, H);
          const src = imageData.data;
          const dst = out.data;
          const bs = blockSize;

          const bW = Math.ceil(W / bs);
          const bH = Math.ceil(H / bs);
          const mse = new Float32Array(bW * bH);
          let maxMse = 1e-6;
          for (let by = 0; by < bH; by++) {
            for (let bx = 0; bx < bW; bx++) {
              let sum = 0, count = 0;
              const x0 = bx * bs, y0 = by * bs;
              const x1 = Math.min(x0 + bs, W), y1 = Math.min(y0 + bs, H);
              for (let y = y0; y < y1; y++) {
                for (let x = x0; x < x1; x++) {
                  const o = (y * W + x) * 4;
                  const dr = src[o    ] - cmp[o    ];
                  const dg = src[o + 1] - cmp[o + 1];
                  const db = src[o + 2] - cmp[o + 2];
                  sum += dr*dr + dg*dg + db*db;
                  count += 3;
                }
              }
              const m = count ? sum / count : 0;
              mse[by * bW + bx] = m;
              if (m > maxMse) maxMse = m;
            }
          }

          for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
              const bx = (x / bs) | 0;
              const by = (y / bs) | 0;
              const m = mse[by * bW + bx] / maxMse;
              const t = 1 - m;
              const o = (y * W + x) * 4;
              const [r, g, b] = viridis(t);
              dst[o]     = r;
              dst[o + 1] = g;
              dst[o + 2] = b;
              dst[o + 3] = 255;
            }
          }
          resolve(out);
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(imageData); };
        img.src = url;
      }, 'image/jpeg', quality / 100);
    });
  },
};

function viridis(t) {
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const r = (68 + t * (253 - 68))  | 0;
  const g = (1  + t * (231 - 1))   | 0;
  const b = (84 + t * (37  - 84))  | 0;
  return [r, g, b];
}
