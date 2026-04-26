import { jpegRoundTrip } from './util/jpeg.js';

/**
 * JPEG Ghost.
 * Re-encodes the current image at `quality`, computes per-block MSE vs
 * original, renders heatmap. Uses OffscreenCanvas — works in workers.
 */
export const jpegGhostFilter = {
  id: 'jpeg-ghost',
  name: 'JPEG Ghost',
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

  async apply(imageData, params) {
    const quality = +params.quality;
    const blockSize = (params.blockSize | 0) || 16;
    const W = imageData.width, H = imageData.height;

    const compressed = await jpegRoundTrip(imageData, quality);
    const out = new ImageData(W, H);
    const src = imageData.data;
    const dst = out.data;
    const cmp = compressed.data;
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
    return out;
  },
};

function viridis(t) {
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const r = (68 + t * (253 - 68))  | 0;
  const g = (1  + t * (231 - 1))   | 0;
  const b = (84 + t * (37  - 84))  | 0;
  return [r, g, b];
}
