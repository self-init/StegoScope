// Precomputed cosine table for 8-point DCT
const N = 8;
const COS_TABLE = (() => {
  const t = new Float32Array(N * N);
  for (let k = 0; k < N; k++)
    for (let n = 0; n < N; n++)
      t[k * N + n] = Math.cos(Math.PI * k * (2 * n + 1) / (2 * N));
  return t;
})();
const SQRT2_OVER_N = Math.sqrt(2 / N);
const INV_SQRT2    = Math.SQRT1_2;

// 2D type-II DCT of an 8×8 block (in-place into output array)
function dct8x8(block, out) {
  const tmp = new Float32Array(N * N);
  // Row DCT
  for (let r = 0; r < N; r++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) sum += block[r * N + n] * COS_TABLE[k * N + n];
      tmp[r * N + k] = (k === 0 ? INV_SQRT2 : 1) * sum * SQRT2_OVER_N;
    }
  }
  // Column DCT
  for (let c = 0; c < N; c++) {
    for (let k = 0; k < N; k++) {
      let sum = 0;
      for (let n = 0; n < N; n++) sum += tmp[n * N + c] * COS_TABLE[k * N + n];
      out[k * N + c] = (k === 0 ? INV_SQRT2 : 1) * sum * SQRT2_OVER_N;
    }
  }
}

// Colormap
const STOPS_VIRIDIS = [
  [68,1,84],[72,33,115],[64,67,135],[52,100,142],[41,130,142],
  [32,158,135],[55,184,120],[112,207,86],[180,222,44],[253,231,37],
];
const STOPS_HOT = [
  [0,0,0],[96,0,0],[192,0,0],[255,0,0],[255,96,0],
  [255,192,0],[255,255,0],[255,255,128],[255,255,255],
];

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

export const dctFilter = {
  id: 'dct',
  name: 'DCT Analysis',
  slow: true,
  meta: false,
  presets: [
    { name: 'AC Energy',    params: { mode: 'ac',  colormap: 'viridis' } },
    { name: 'DC Component', params: { mode: 'dc',  colormap: 'viridis' } },
    { name: 'High-Freq AC', params: { mode: 'hf',  colormap: 'hot'     } },
    { name: 'Avg DCT Block',params: { mode: 'avg', colormap: 'viridis' } },
  ],
  defaultPreset: 'AC Energy',
  paramSchema: [
    {
      id: 'mode', label: 'Mode', type: 'select',
      options: [
        { value: 'ac',  label: 'AC Energy (per block)'    },
        { value: 'dc',  label: 'DC Component'             },
        { value: 'hf',  label: 'High-Freq AC (per block)' },
        { value: 'avg', label: 'Average DCT Block (64px)' },
      ],
    },
    {
      id: 'colormap', label: 'Colormap', type: 'select',
      options: [
        { value: 'viridis', label: 'Viridis' },
        { value: 'hot',     label: 'Hot'     },
      ],
    },
  ],

  apply(imageData, params) {
    const { mode, colormap } = params;
    const stops = colormap === 'hot' ? STOPS_HOT : STOPS_VIRIDIS;
    const { data, width: w, height: h } = imageData;

    // Cap at 1024px to keep it fast
    const MAX_DIM = 1024;
    const scale   = Math.min(1, MAX_DIM / Math.max(w, h));
    const sw      = Math.max(N, (w * scale + 0.5) | 0);
    const sh      = Math.max(N, (h * scale + 0.5) | 0);

    // Sample luma at reduced resolution
    const luma = new Float32Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      const sy = Math.min(h - 1, (y / scale + 0.5) | 0);
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(w - 1, (x / scale + 0.5) | 0);
        const i  = (sy * w + sx) * 4;
        luma[y * sw + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }

    if (mode === 'avg') {
      // Compute average 8×8 DCT block and display magnified to 64×64
      const avgCoeffs = new Float32Array(N * N);
      const block = new Float32Array(N * N);
      const coeffs = new Float32Array(N * N);
      let blockCount = 0;

      for (let by = 0; by + N <= sh; by += N) {
        for (let bx = 0; bx + N <= sw; bx += N) {
          for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
              block[r * N + c] = luma[(by + r) * sw + (bx + c)] - 128;
          dct8x8(block, coeffs);
          for (let i = 0; i < N * N; i++) avgCoeffs[i] += Math.abs(coeffs[i]);
          blockCount++;
        }
      }
      if (blockCount > 0)
        for (let i = 0; i < N * N; i++) avgCoeffs[i] /= blockCount;

      // Normalize (skip DC for display)
      let mx = 0;
      for (let i = 1; i < N * N; i++) if (avgCoeffs[i] > mx) mx = avgCoeffs[i];
      if (mx === 0) mx = 1;

      const tileSize = 8; // each coefficient shown as tileSize×tileSize pixels
      const outSz    = N * tileSize;
      const out = new ImageData(outSz, outSz);
      const dst = out.data;

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const v = r === 0 && c === 0 ? avgCoeffs[0] / (avgCoeffs[0] || 1) : avgCoeffs[r * N + c] / mx;
          const [cr, cg, cb] = lerp3(stops, v);
          for (let dy = 0; dy < tileSize; dy++) {
            for (let dx = 0; dx < tileSize; dx++) {
              const idx = ((r * tileSize + dy) * outSz + (c * tileSize + dx)) * 4;
              dst[idx]     = cr;
              dst[idx + 1] = cg;
              dst[idx + 2] = cb;
              dst[idx + 3] = 255;
            }
          }
        }
      }
      return out;
    }

    // Per-block heatmap modes
    const block   = new Float32Array(N * N);
    const coeffs  = new Float32Array(N * N);
    const energies = [];

    for (let by = 0; by + N <= sh; by += N) {
      for (let bx = 0; bx + N <= sw; bx += N) {
        for (let r = 0; r < N; r++)
          for (let c = 0; c < N; c++)
            block[r * N + c] = luma[(by + r) * sw + (bx + c)] - 128;
        dct8x8(block, coeffs);

        let energy = 0;
        if (mode === 'dc') {
          energy = Math.abs(coeffs[0]);
        } else if (mode === 'hf') {
          // High-frequency: lower-right triangle of coefficient matrix
          for (let r = 0; r < N; r++)
            for (let c = 0; c < N; c++)
              if (r + c >= N) energy += coeffs[r * N + c] * coeffs[r * N + c];
          energy = Math.sqrt(energy);
        } else { // ac
          for (let i = 1; i < N * N; i++) energy += coeffs[i] * coeffs[i];
          energy = Math.sqrt(energy);
        }
        energies.push(energy);
      }
    }

    // Normalize
    let mx = 0;
    for (const e of energies) if (e > mx) mx = e;
    if (mx === 0) mx = 1;

    const out = new ImageData(sw, sh);
    const dst = out.data;
    let bi = 0;
    for (let by = 0; by + N <= sh; by += N) {
      for (let bx = 0; bx + N <= sw; bx += N) {
        const [cr, cg, cb] = lerp3(stops, energies[bi++] / mx);
        const bh = Math.min(N, sh - by);
        const bw = Math.min(N, sw - bx);
        for (let dy = 0; dy < bh; dy++)
          for (let dx = 0; dx < bw; dx++) {
            const idx = ((by + dy) * sw + (bx + dx)) * 4;
            dst[idx]     = cr;
            dst[idx + 1] = cg;
            dst[idx + 2] = cb;
            dst[idx + 3] = 255;
          }
      }
    }
    return out;
  },
};
