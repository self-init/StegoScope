import { readBuffer, parseExif } from './util/exif.js';

/**
 * Thumbnail extract + compare filter.
 */
export const thumbnailFilter = {
  id: 'thumbnail',
  name: 'Thumbnail',
  slow: false,
  meta: true,
  presets: [{ name: 'Show', params: {} }],
  defaultPreset: 'Show',
  paramSchema: [],

  async apply(imageData, _params, sourceCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };
    if (!parsed.thumbnailBytes) {
      return { entries: [{ label: 'Thumbnail', detail: 'absent', severity: 'info' }] };
    }

    const blob = new Blob([parsed.thumbnailBytes], { type: 'image/jpeg' });
    const url = URL.createObjectURL(blob);
    let img;
    try {
      img = await loadImg(url);
    } catch {
      URL.revokeObjectURL(url);
      return { entries: [{ label: 'Thumbnail', detail: 'present but undecodable', severity: 'warn' }] };
    }
    URL.revokeObjectURL(url);

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = img.naturalWidth;
    thumbCanvas.height = img.naturalHeight;
    thumbCanvas.getContext('2d').drawImage(img, 0, 0);

    const down = document.createElement('canvas');
    down.width = thumbCanvas.width;
    down.height = thumbCanvas.height;
    down.getContext('2d').drawImage(sourceCanvas, 0, 0, down.width, down.height);

    const thumbData = thumbCanvas.getContext('2d').getImageData(0, 0, thumbCanvas.width, thumbCanvas.height);
    const downData  = down.getContext('2d').getImageData(0, 0, down.width, down.height);
    const ssim = computeSsim(thumbData, downData);

    return {
      entries: [
        { label: 'Thumbnail', detail: 'present', severity: 'info' },
        { label: 'Size',      detail: `${thumbCanvas.width}x${thumbCanvas.height}` },
        {
          label:    'SSIM vs main',
          detail:   ssim.toFixed(3),
          severity: ssim < 0.85 ? 'alert' : 'info',
        },
      ],
    };
  },
};

function loadImg(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function computeSsim(a, b) {
  const W = Math.min(a.width, b.width);
  const H = Math.min(a.height, b.height);
  const la = lumaArray(a, W, H);
  const lb = lumaArray(b, W, H);
  const n = W * H;

  let sumA = 0, sumB = 0;
  for (let i = 0; i < n; i++) { sumA += la[i]; sumB += lb[i]; }
  const muA = sumA / n, muB = sumB / n;

  let varA = 0, varB = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    const da = la[i] - muA, db = lb[i] - muB;
    varA += da * da; varB += db * db; cov += da * db;
  }
  varA /= n; varB /= n; cov /= n;

  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;
  const num = (2 * muA * muB + C1) * (2 * cov + C2);
  const den = (muA * muA + muB * muB + C1) * (varA + varB + C2);
  return num / den;
}

function lumaArray(img, W, H) {
  const out = new Float32Array(W * H);
  const src = img.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * img.width + x) * 4;
      out[y * W + x] = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
    }
  }
  return out;
}
