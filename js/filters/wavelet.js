/**
 * Haar wavelet residual / detail filter.
 */
export const waveletFilter = {
  id: 'wavelet',
  name: 'Wavelet',
  slow: false,
  presets: [
    { name: 'Residual L1', params: { level: 1, mode: 'residual', threshold: 8 } },
    { name: 'Residual L2', params: { level: 2, mode: 'residual', threshold: 8 } },
    { name: 'Detail L1',   params: { level: 1, mode: 'detail',   threshold: 0 } },
  ],
  defaultPreset: 'Residual L1',
  paramSchema: [
    { id: 'level',     label: 'Level',     type: 'range', min: 1, max: 3,  step: 1 },
    {
      id: 'mode', label: 'Mode', type: 'select',
      options: [
        { value: 'residual', label: 'Residual' },
        { value: 'detail',   label: 'Detail (HH)' },
      ],
    },
    { id: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 32, step: 1 },
  ],

  apply(imageData, params) {
    const level = (params.level | 0) || 1;
    const mode = params.mode;
    const threshold = +params.threshold || 0;
    const W = imageData.width, H = imageData.height;
    const out = new ImageData(W, H);

    for (let ch = 0; ch < 3; ch++) {
      const plane = extractPlane(imageData, ch);
      if (mode === 'residual') {
        const coef = haarThenThreshold(plane, W, H, level, threshold);
        const recon = invHaar(coef, W, H, level);
        for (let i = 0; i < plane.length; i++) {
          const r = plane[i] - recon[i];
          writeChannel(out, i, ch, 128 + r);
        }
      } else {
        const hh = haarDetailOnly(plane, W, H, level);
        for (let i = 0; i < hh.length; i++) {
          writeChannel(out, i, ch, 128 + hh[i] * 4);
        }
      }
    }
    for (let i = 3; i < out.data.length; i += 4) out.data[i] = 255;
    return out;
  },
};

function extractPlane(img, ch) {
  const n = img.width * img.height;
  const plane = new Float32Array(n);
  const src = img.data;
  for (let p = 0, i = 0; p < n; p++, i += 4) plane[p] = src[i + ch];
  return plane;
}

function writeChannel(img, pixelIdx, ch, value) {
  if (value < 0) value = 0; else if (value > 255) value = 255;
  img.data[pixelIdx * 4 + ch] = value | 0;
}

function haarThenThreshold(plane, W, H, level, threshold) {
  const coef = plane.slice();
  let w = W, h = H;
  for (let l = 0; l < level; l++) {
    haarStep(coef, W, w, h);
    w = w >> 1; h = h >> 1;
    if (w < 1 || h < 1) break;
  }
  if (threshold > 0) {
    let cw = W, ch = H;
    for (let l = 0; l < level; l++) {
      const hw = cw >> 1, hh = ch >> 1;
      softThresholdRegion(coef, W, hw, 0,  hw, hh, threshold);
      softThresholdRegion(coef, W, 0,  hh, hw, hh, threshold);
      softThresholdRegion(coef, W, hw, hh, hw, hh, threshold);
      cw = hw; ch = hh;
    }
  }
  return coef;
}

function invHaar(coef, W, H, level) {
  const out = coef.slice();
  let w = W >> level, h = H >> level;
  for (let l = 0; l < level; l++) {
    const fw = w << 1, fh = h << 1;
    invHaarStep(out, W, fw, fh);
    w = fw; h = fh;
  }
  return out;
}

function haarDetailOnly(plane, W, H, level) {
  const coef = plane.slice();
  let w = W, h = H;
  for (let l = 0; l < level; l++) {
    haarStep(coef, W, w, h);
    w = w >> 1; h = h >> 1;
    if (w < 1 || h < 1) break;
  }
  const out = new Float32Array(W * H);
  const hw = w, hh = h;
  const prevW = hw << 1, prevH = hh << 1;
  for (let y = 0; y < prevH; y++) {
    for (let x = 0; x < prevW; x++) {
      if (x >= hw && y >= hh) out[y * W + x] = coef[y * W + x];
    }
  }
  return out;
}

function haarStep(coef, stride, w, h) {
  const tmp = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x + 1 < w; x += 2) {
      const a = coef[y * stride + x];
      const b = coef[y * stride + x + 1];
      tmp[x >> 1]              = (a + b) * 0.5;
      tmp[(w >> 1) + (x >> 1)] = (a - b) * 0.5;
    }
    for (let x = 0; x < w; x++) coef[y * stride + x] = tmp[x];
  }
  const tmpC = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y + 1 < h; y += 2) {
      const a = coef[y * stride + x];
      const b = coef[(y + 1) * stride + x];
      tmpC[y >> 1]              = (a + b) * 0.5;
      tmpC[(h >> 1) + (y >> 1)] = (a - b) * 0.5;
    }
    for (let y = 0; y < h; y++) coef[y * stride + x] = tmpC[y];
  }
}

function invHaarStep(coef, stride, w, h) {
  const tmpC = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    const halfH = h >> 1;
    for (let y = 0; y < halfH; y++) {
      const lo = coef[y * stride + x];
      const hi = coef[(halfH + y) * stride + x];
      tmpC[2 * y]     = lo + hi;
      tmpC[2 * y + 1] = lo - hi;
    }
    for (let y = 0; y < h; y++) coef[y * stride + x] = tmpC[y];
  }
  const tmpR = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    const halfW = w >> 1;
    for (let x = 0; x < halfW; x++) {
      const lo = coef[y * stride + x];
      const hi = coef[y * stride + halfW + x];
      tmpR[2 * x]     = lo + hi;
      tmpR[2 * x + 1] = lo - hi;
    }
    for (let x = 0; x < w; x++) coef[y * stride + x] = tmpR[x];
  }
}

function softThresholdRegion(coef, stride, x0, y0, w, h, thr) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y0 + y) * stride + (x0 + x);
      const v = coef[i];
      if (v > thr) coef[i] = v - thr;
      else if (v < -thr) coef[i] = v + thr;
      else coef[i] = 0;
    }
  }
}
