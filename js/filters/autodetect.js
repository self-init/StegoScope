import { readBuffer, parseExif } from './util/exif.js';
import { jpegRoundTrip } from './util/jpeg.js';

/**
 * Autodetect — runs forensic heuristics and reports anomalies.
 * Uses createImageBitmap + OffscreenCanvas for JPEG decode — works in workers.
 */
export const autodetectFilter = {
  id: 'autodetect',
  name: 'Auto-Detect',
  meta: true,
  presets: [{ name: 'All', params: {} }],
  defaultPreset: 'All',
  paramSchema: [],

  async apply(imageData, _params, _srcCanvas, rawFile) {
    const entries = [];

    alphaLsbStego(imageData, entries);
    bitplaneEntropy(imageData, entries);
    crossChannelLsbCorrelation(imageData, entries);

    if (rawFile) {
      const buf = await readBuffer(rawFile);
      const bytes = new Uint8Array(buf);

      trailingBytes(bytes, entries);
      embeddedMagic(bytes, entries);
      dimensionMismatch(buf, imageData, entries);
      await doubleJpegHint(imageData, entries);
    }

    if (!entries.length) entries.push({ label: 'Clean', detail: 'no anomalies found', severity: 'info' });
    return { entries };
  },
};

// Heuristic 1: Alpha LSB stego
function alphaLsbStego(img, entries) {
  const src = img.data;
  const n = img.width * img.height;
  let alphaMean = 0, ones = 0;
  for (let i = 3; i < src.length; i += 4) alphaMean += src[i];
  alphaMean /= n;
  let alphaVariance = 0;
  for (let i = 3; i < src.length; i += 4) {
    const d = src[i] - alphaMean;
    alphaVariance += d * d;
    if (src[i] & 1) ones++;
  }
  alphaVariance /= n;

  const p = ones / n;
  const entropy = p === 0 || p === 1 ? 0 : -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
  const alphaVaries = alphaVariance > 0.5;

  entries.push({
    label: 'Alpha channel',
    detail: alphaVaries
      ? `mean=${alphaMean.toFixed(1)} var=${alphaVariance.toFixed(2)} bit0 p=${p.toFixed(4)} H=${entropy.toFixed(3)}`
      : `uniform (mean=${alphaMean.toFixed(1)})`,
    severity: 'info',
  });

  const suspicious = alphaVaries && p > 0.48 && p < 0.52 && entropy > 0.98;
  if (suspicious) {
    entries.push({
      label:    'Alpha LSB stego',
      detail:   `p=${p.toFixed(4)} H=${entropy.toFixed(3)} — bit-0 distribution suspiciously uniform`,
      severity: 'alert',
    });
  }
}

// Heuristic 2: Bit-plane entropy asymmetry
function bitplaneEntropy(img, entries) {
  const src = img.data;
  const n = img.width * img.height;
  const channels = [
    { name: 'R',    idx: 0    },
    { name: 'G',    idx: 1    },
    { name: 'B',    idx: 2    },
    { name: 'A',    idx: 3    },
    { name: 'Luma', idx: null },
  ];
  const results = [];
  for (const c of channels) {
    let ones = 0;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const v = c.idx == null
        ? ((0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) | 0)
        : src[i + c.idx];
      if (v & 1) ones++;
    }
    const r = ones / n;
    const h = r === 0 || r === 1 ? 0 : -(r * Math.log2(r) + (1 - r) * Math.log2(1 - r));
    results.push({ name: c.name, entropy: h });
    entries.push({
      label:    `Bit0 entropy ${c.name}`,
      detail:   h.toFixed(3),
      severity: 'info',
    });
  }
  results.sort((a, b) => b.entropy - a.entropy);
  const top = results[0];
  const median = results[Math.floor(results.length / 2)].entropy;
  if (top.entropy >= 0.98 && median <= 0.90) {
    entries.push({
      label:    'Bit0 entropy asymmetry',
      detail:   `${top.name} entropy ${top.entropy.toFixed(3)} vs median ${median.toFixed(3)}`,
      severity: 'warn',
    });
  }
}

// Heuristic 2b: Cross-channel LSB correlation
function crossChannelLsbCorrelation(img, entries) {
  const src = img.data;
  const n = img.width * img.height;
  const lsbs = { R: new Uint8Array(n), G: new Uint8Array(n), B: new Uint8Array(n), A: new Uint8Array(n) };
  let meanR = 0, meanG = 0, meanB = 0, meanA = 0;
  for (let p = 0, i = 0; p < n; p++, i += 4) {
    const lr = src[i]     & 1;
    const lg = src[i + 1] & 1;
    const lb = src[i + 2] & 1;
    const la = src[i + 3] & 1;
    lsbs.R[p] = lr; lsbs.G[p] = lg; lsbs.B[p] = lb; lsbs.A[p] = la;
    meanR += lr;   meanG += lg;   meanB += lb;   meanA += la;
  }
  meanR /= n; meanG /= n; meanB /= n; meanA /= n;

  const pairs = [
    ['R', 'A'], ['G', 'A'], ['B', 'A'],
    ['R', 'G'], ['R', 'B'], ['G', 'B'],
  ];
  const means = { R: meanR, G: meanG, B: meanB, A: meanA };
  const alerts = [];

  for (const [x, y] of pairs) {
    const ax = lsbs[x], ay = lsbs[y];
    const mx = means[x], my = means[y];
    let cov = 0, vx = 0, vy = 0;
    for (let i = 0; i < n; i++) {
      const dx = ax[i] - mx, dy = ay[i] - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    if (vx === 0 || vy === 0) continue;
    const r = cov / Math.sqrt(vx * vy);
    if (Math.abs(r) >= 0.15) {
      const sev = Math.abs(r) >= 0.30 ? 'alert' : 'warn';
      alerts.push({
        label: `LSB corr ${x} vs ${y}`,
        detail: `r=${r.toFixed(3)} — try Bitplane XOR ${x} XOR ${y} bit0`,
        severity: sev,
      });
    }
  }
  for (const a of alerts) entries.push(a);
}

// Heuristic 3: Trailing bytes
function trailingBytes(bytes, entries) {
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) {
    const eoi = findLast(bytes, [0xFF, 0xD9]);
    if (eoi >= 0 && eoi + 2 < bytes.length) {
      const trail = bytes.length - (eoi + 2);
      entries.push({
        label:    'Trailing bytes (JPEG)',
        detail:   `${trail} bytes after EOI: ${hexPreview(bytes, eoi + 2, Math.min(64, trail))}`,
        severity: 'alert',
      });
    }
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    let p = 8;
    let iendEnd = -1;
    while (p + 8 <= bytes.length) {
      const len = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
      const typeStart = p + 4;
      const isIend =
        bytes[typeStart] === 0x49 && bytes[typeStart + 1] === 0x45 &&
        bytes[typeStart + 2] === 0x4E && bytes[typeStart + 3] === 0x44;
      p = typeStart + 4 + len + 4;
      if (isIend) { iendEnd = p; break; }
      if (p > bytes.length) break;
    }
    if (iendEnd > 0 && iendEnd < bytes.length) {
      const trail = bytes.length - iendEnd;
      entries.push({
        label:    'Trailing bytes (PNG)',
        detail:   `${trail} bytes after IEND: ${hexPreview(bytes, iendEnd, Math.min(64, trail))}`,
        severity: 'alert',
      });
    }
  }
}

function findLast(bytes, marker) {
  for (let i = bytes.length - marker.length; i >= 0; i--) {
    let match = true;
    for (let j = 0; j < marker.length; j++) {
      if (bytes[i + j] !== marker[j]) { match = false; break; }
    }
    if (match) return i;
  }
  return -1;
}

function hexPreview(bytes, start, len) {
  const parts = [];
  for (let i = 0; i < len; i++) parts.push(bytes[start + i].toString(16).padStart(2, '0'));
  return parts.join(' ');
}

// Heuristic 4: Embedded magic
const MAGICS = [
  { name: 'ZIP',  sig: [0x50, 0x4B, 0x03, 0x04] },
  { name: 'PNG',  sig: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { name: 'JPEG', sig: [0xFF, 0xD8, 0xFF] },
  { name: 'RAR',  sig: [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07] },
  { name: '7z',   sig: [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C] },
  { name: 'PDF',  sig: [0x25, 0x50, 0x44, 0x46, 0x2D] },
  { name: 'GIF',  sig: [0x47, 0x49, 0x46, 0x38] },
];

function embeddedMagic(bytes, entries) {
  let ownName = null;
  for (const m of MAGICS) {
    if (startsWith(bytes, m.sig, 0)) { ownName = m.name; break; }
  }
  for (const m of MAGICS) {
    let from = 1;
    while (from < bytes.length) {
      const idx = findSig(bytes, m.sig, from);
      if (idx < 0) break;
      if (!(m.name === ownName && idx === 0)) {
        entries.push({
          label:    `Embedded ${m.name}`,
          detail:   `offset 0x${idx.toString(16)}`,
          severity: 'alert',
        });
      }
      from = idx + 1;
    }
  }
}

function startsWith(bytes, sig, at) {
  if (at + sig.length > bytes.length) return false;
  for (let i = 0; i < sig.length; i++) if (bytes[at + i] !== sig[i]) return false;
  return true;
}

function findSig(bytes, sig, from) {
  for (let i = from; i + sig.length <= bytes.length; i++) {
    let ok = true;
    for (let j = 0; j < sig.length; j++) {
      if (bytes[i + j] !== sig[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

// Heuristic 5: Double JPEG hint — using jpegRoundTrip for clean worker-compatible JPEG re-encode
async function doubleJpegHint(imageData, entries) {
  const sw = Math.min(imageData.width, 256);
  const sh = Math.min(imageData.height, 256);
  const scaleW = sw / imageData.width, scaleH = sh / imageData.height;
  const scale = Math.min(scaleW, scaleH, 1);
  const w = Math.max(1, Math.round(imageData.width * scale));
  const h = Math.max(1, Math.round(imageData.height * scale));

  // Downsample via ImageData copy (CPU-side, fast for 256px)
  const srcData = downsampleImageData(imageData, w, h);
  const srcBytes = srcData.data;

  const QS = [50, 70, 85, 90];
  const curve = [];
  for (const q of QS) {
    const reencoded = await jpegRoundTrip(srcData, q);
    const rc = reencoded.data;
    let sum = 0;
    for (let i = 0; i < srcBytes.length; i += 4) {
      const dr = srcBytes[i] - rc[i];
      const dg = srcBytes[i + 1] - rc[i + 1];
      const db = srcBytes[i + 2] - rc[i + 2];
      sum += dr*dr + dg*dg + db*db;
    }
    curve.push({ q, mse: sum / (w * h * 3) });
  }

  if (curve.length === 0) return;
  let minIdx = 0;
  for (let i = 1; i < curve.length; i++) if (curve[i].mse < curve[minIdx].mse) minIdx = i;
  const summary = curve.map(c => `Q${c.q}:${c.mse.toFixed(1)}`).join(' ');
  if (minIdx !== curve.length - 1) {
    entries.push({
      label:    'Double JPEG hint',
      detail:   `MSE min at Q${curve[minIdx].q} (not highest tested). Curve: ${summary}`,
      severity: 'warn',
    });
  }
}

// Heuristic 6: Dimension mismatch
function dimensionMismatch(buf, imageData, entries) {
  const parsed = parseExif(buf);
  if (parsed.error === 'not-jpeg') return;
  const xDim = parsed.tags.PixelXDimension;
  const yDim = parsed.tags.PixelYDimension;
  if (typeof xDim === 'number' && typeof yDim === 'number') {
    if (xDim !== imageData.width || yDim !== imageData.height) {
      entries.push({
        label:    'Dimension mismatch',
        detail:   `EXIF ${xDim}x${yDim}, decoded ${imageData.width}x${imageData.height}`,
        severity: 'warn',
      });
    }
  }
}

// --- helpers ---

function downsampleImageData(src, targetW, targetH) {
  const srcW = src.width, srcH = src.height;
  const out = new ImageData(targetW, targetH);
  const dst = out.data;
  const scaleX = srcW / targetW, scaleY = srcH / targetH;
  for (let y = 0; y < targetH; y++) {
    const sy = Math.min(srcH - 1, (y * scaleY) | 0);
    for (let x = 0; x < targetW; x++) {
      const sx = Math.min(srcW - 1, (x * scaleX) | 0);
      const di = (sy * srcW + sx) * 4;
      const oi = (y * targetW + x) * 4;
      dst[oi] = src.data[di];
      dst[oi + 1] = src.data[di + 1];
      dst[oi + 2] = src.data[di + 2];
      dst[oi + 3] = 255;
    }
  }
  return out;
}
