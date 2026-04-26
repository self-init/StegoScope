// Colormap stops for entropy heatmap
const CMAPS = {
  viridis: [
    [68,1,84],[72,33,115],[64,67,135],[52,100,142],[41,130,142],
    [32,158,135],[55,184,120],[112,207,86],[180,222,44],[253,231,37],
  ],
  inferno: [
    [0,0,4],[23,11,58],[65,12,108],[101,21,110],[139,34,103],
    [176,55,90],[209,81,64],[237,115,27],[249,156,3],[252,255,164],
  ],
  hot: [
    [0,0,0],[96,0,0],[192,0,0],[255,0,0],[255,96,0],
    [255,192,0],[255,255,0],[255,255,128],[255,255,255],
  ],
  jet: [
    [0,0,128],[0,0,255],[0,128,255],[0,255,255],[128,255,128],
    [255,255,0],[255,128,0],[255,0,0],[128,0,0],
  ],
};

function lerp3(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const f = t * n;
  const i = Math.min(Math.floor(f), n - 1);
  const u = f - i;
  const [r0, g0, b0] = stops[i];
  const [r1, g1, b1] = stops[i + 1];
  return [
    (r0 + u * (r1 - r0) + 0.5) | 0,
    (g0 + u * (g1 - g0) + 0.5) | 0,
    (b0 + u * (b1 - b0) + 0.5) | 0,
  ];
}

function blockEntropy(data, w, h, bx, by, bsz) {
  const counts = new Uint32Array(256);
  let total = 0;
  for (let dy = 0; dy < bsz; dy++) {
    const py = by + dy;
    if (py >= h) break;
    for (let dx = 0; dx < bsz; dx++) {
      const px = bx + dx;
      if (px >= w) break;
      const i = (py * w + px) * 4;
      const luma = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] + 0.5) | 0;
      counts[luma]++;
      total++;
    }
  }
  if (total < 2) return 0;
  let e = 0;
  for (let v = 0; v < 256; v++) {
    if (counts[v] === 0) continue;
    const p = counts[v] / total;
    e -= p * Math.log2(p);
  }
  return e / 8; // max 8 bits → normalize to 0-1
}

export const entropyFilter = {
  id: 'entropy',
  name: 'Entropy Map',
  presets: [
    { name: '8×8 blocks',   params: { blockSize: 8,  colormap: 'viridis' } },
    { name: '16×16 blocks', params: { blockSize: 16, colormap: 'viridis' } },
    { name: '32×32 blocks', params: { blockSize: 32, colormap: 'inferno' } },
    { name: '64×64 blocks', params: { blockSize: 64, colormap: 'hot'     } },
  ],
  defaultPreset: '16×16 blocks',
  paramSchema: [
    {
      id: 'blockSize', label: 'Block Size', type: 'select',
      options: [
        { value: 4,  label: '4×4'   },
        { value: 8,  label: '8×8'   },
        { value: 16, label: '16×16' },
        { value: 32, label: '32×32' },
        { value: 64, label: '64×64' },
      ],
    },
    {
      id: 'colormap', label: 'Colormap', type: 'select',
      options: [
        { value: 'viridis', label: 'Viridis' },
        { value: 'inferno', label: 'Inferno' },
        { value: 'hot',     label: 'Hot'     },
        { value: 'jet',     label: 'Jet'     },
      ],
    },
  ],

  apply(imageData, params) {
    const bsz   = params.blockSize | 0 || 16;
    const stops = CMAPS[params.colormap] ?? CMAPS.viridis;
    const { data, width: w, height: h } = imageData;
    const out = new ImageData(w, h);
    const dst = out.data;

    for (let by = 0; by < h; by += bsz) {
      for (let bx = 0; bx < w; bx += bsz) {
        const e = blockEntropy(data, w, h, bx, by, bsz);
        const [r, g, b] = lerp3(stops, e);
        const bh = Math.min(bsz, h - by);
        const bw = Math.min(bsz, w - bx);
        for (let dy = 0; dy < bh; dy++) {
          for (let dx = 0; dx < bw; dx++) {
            const i = ((by + dy) * w + (bx + dx)) * 4;
            dst[i]     = r;
            dst[i + 1] = g;
            dst[i + 2] = b;
            dst[i + 3] = 255;
          }
        }
      }
    }
    return out;
  },
};
