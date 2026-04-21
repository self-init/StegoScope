/**
 * Histogram filter.
 */
export const histogramFilter = {
  id: 'histogram',
  name: 'Histogram',
  slow: false,
  presets: [
    { name: 'Graph All',     params: { mode: 'graph',    channel: 'All'  } },
    { name: 'Stretch Luma',  params: { mode: 'stretch',  channel: 'Luma' } },
    { name: 'Equalize Luma', params: { mode: 'equalize', channel: 'Luma' } },
  ],
  defaultPreset: 'Graph All',
  paramSchema: [
    {
      id: 'mode', label: 'Mode', type: 'select',
      options: [
        { value: 'graph',    label: 'Graph' },
        { value: 'stretch',  label: 'Auto-Stretch' },
        { value: 'equalize', label: 'Equalize' },
      ],
    },
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'R',    label: 'Red' },
        { value: 'G',    label: 'Green' },
        { value: 'B',    label: 'Blue' },
        { value: 'Luma', label: 'Luma' },
        { value: 'All',  label: 'All (RGB)' },
      ],
    },
  ],

  apply(imageData, params) {
    const { mode, channel } = params;
    if (mode === 'graph') return renderHistogramGraph(imageData, channel);
    if (mode === 'stretch') return stretchMode(imageData, channel);
    return equalizeMode(imageData, channel);
  },
};

function computeHistograms(img, needLuma) {
  const src = img.data;
  const hr = new Uint32Array(256);
  const hg = new Uint32Array(256);
  const hb = new Uint32Array(256);
  const hy = new Uint32Array(256);
  for (let i = 0; i < src.length; i += 4) {
    hr[src[i]]++; hg[src[i + 1]]++; hb[src[i + 2]]++;
    if (needLuma) {
      const y = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      hy[y]++;
    }
  }
  return { hr, hg, hb, hy };
}

function renderHistogramGraph(img, channel) {
  const { hr, hg, hb, hy } = computeHistograms(img, true);
  const W = img.width, H = img.height;
  const out = new ImageData(W, H);
  const dst = out.data;
  for (let i = 3; i < dst.length; i += 4) dst[i] = 255;

  const bars = channel === 'All'
    ? [{ data: hr, color: [255,  80,  80] }, { data: hg, color: [100, 220, 100] }, { data: hb, color: [100, 150, 255] }]
    : channel === 'Luma'
      ? [{ data: hy, color: [220, 220, 220] }]
      : channel === 'R' ? [{ data: hr, color: [255, 80, 80] }]
      : channel === 'G' ? [{ data: hg, color: [100, 220, 100] }]
                        : [{ data: hb, color: [100, 150, 255] }];

  let maxCount = 1;
  for (const b of bars) for (let i = 0; i < 256; i++) if (b.data[i] > maxCount) maxCount = b.data[i];

  for (const b of bars) {
    for (let bin = 0; bin < 256; bin++) {
      const x0 = Math.floor((bin       / 256) * W);
      const x1 = Math.floor(((bin + 1) / 256) * W);
      const barH = Math.round((b.data[bin] / maxCount) * (H - 2));
      for (let y = H - barH; y < H; y++) {
        for (let x = x0; x < x1; x++) {
          const o = (y * W + x) * 4;
          dst[o    ] = Math.min(255, dst[o    ] + b.color[0] / bars.length);
          dst[o + 1] = Math.min(255, dst[o + 1] + b.color[1] / bars.length);
          dst[o + 2] = Math.min(255, dst[o + 2] + b.color[2] / bars.length);
        }
      }
    }
  }
  return out;
}

function stretchMode(img, channel) {
  const out = new ImageData(img.width, img.height);
  const src = img.data, dst = out.data;
  if (channel === 'Luma' || channel === 'All') {
    const ranges = [findRange(src, 0), findRange(src, 1), findRange(src, 2)];
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const [lo, hi] = ranges[c];
        const v = src[i + c];
        dst[i + c] = hi > lo ? (((v - lo) / (hi - lo)) * 255) | 0 : v;
      }
      dst[i + 3] = 255;
    }
  } else {
    const ci = { R: 0, G: 1, B: 2 }[channel];
    const [lo, hi] = findRange(src, ci);
    for (let i = 0; i < src.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        if (c === ci) dst[i + c] = hi > lo ? (((src[i + c] - lo) / (hi - lo)) * 255) | 0 : src[i + c];
        else dst[i + c] = src[i + c];
      }
      dst[i + 3] = 255;
    }
  }
  return out;
}

function findRange(src, ci) {
  let lo = 255, hi = 0;
  for (let i = ci; i < src.length; i += 4) {
    const v = src[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return [lo, hi];
}

function equalizeMode(img, channel) {
  const out = new ImageData(img.width, img.height);
  const src = img.data, dst = out.data;
  const total = img.width * img.height;

  if (channel === 'Luma') {
    const lut = new Uint8Array(256);
    const h = new Uint32Array(256);
    for (let i = 0; i < src.length; i += 4) {
      const y = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      h[y]++;
    }
    let sum = 0;
    for (let i = 0; i < 256; i++) { sum += h[i]; lut[i] = ((sum / total) * 255) | 0; }
    for (let i = 0; i < src.length; i += 4) {
      const y  = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0;
      const y2 = lut[y];
      const scale = y > 0 ? y2 / y : 1;
      dst[i    ] = Math.min(255, src[i    ] * scale) | 0;
      dst[i + 1] = Math.min(255, src[i + 1] * scale) | 0;
      dst[i + 2] = Math.min(255, src[i + 2] * scale) | 0;
      dst[i + 3] = 255;
    }
    return out;
  }

  if (channel === 'All') {
    for (let c = 0; c < 3; c++) {
      const lut = channelLut(src, c, total);
      for (let i = 0; i < src.length; i += 4) dst[i + c] = lut[src[i + c]];
    }
    for (let i = 3; i < dst.length; i += 4) dst[i] = 255;
    return out;
  }

  const ci = { R: 0, G: 1, B: 2 }[channel];
  const lut = channelLut(src, ci, total);
  for (let i = 0; i < src.length; i += 4) {
    dst[i    ] = (ci === 0) ? lut[src[i    ]] : src[i    ];
    dst[i + 1] = (ci === 1) ? lut[src[i + 1]] : src[i + 1];
    dst[i + 2] = (ci === 2) ? lut[src[i + 2]] : src[i + 2];
    dst[i + 3] = 255;
  }
  return out;
}

function channelLut(src, ci, total) {
  const h = new Uint32Array(256);
  for (let i = ci; i < src.length; i += 4) h[src[i]]++;
  let sum = 0;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) { sum += h[i]; lut[i] = ((sum / total) * 255) | 0; }
  return lut;
}
