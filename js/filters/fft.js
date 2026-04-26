function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

// In-place Cooley-Tukey radix-2 FFT (DIF)
function fft1d(re, im) {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  // Butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j],         ui = im[i + j];
        const vr = re[i + j + half] * cr - im[i + j + half] * ci;
        const vi = re[i + j + half] * ci + im[i + j + half] * cr;
        re[i + j]        = ur + vr;
        im[i + j]        = ui + vi;
        re[i + j + half] = ur - vr;
        im[i + j + half] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

function fft2d(re, im, rows, cols) {
  const rowBuf = new Float64Array(cols);
  const rowImB = new Float64Array(cols);
  for (let r = 0; r < rows; r++) {
    rowBuf.set(re.subarray(r * cols, (r + 1) * cols));
    rowImB.set(im.subarray(r * cols, (r + 1) * cols));
    fft1d(rowBuf, rowImB);
    re.set(rowBuf, r * cols);
    im.set(rowImB, r * cols);
  }
  const colBuf = new Float64Array(rows);
  const colImB = new Float64Array(rows);
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) { colBuf[r] = re[r * cols + c]; colImB[r] = im[r * cols + c]; }
    fft1d(colBuf, colImB);
    for (let r = 0; r < rows; r++) { re[r * cols + c] = colBuf[r]; im[r * cols + c] = colImB[r]; }
  }
}

// fftshift: swap quadrants so DC is at center
function fftshift(mag, rows, cols) {
  const out = new Float64Array(rows * cols);
  const hr = rows >> 1, hc = cols >> 1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const nr = (r + hr) % rows;
      const nc = (c + hc) % cols;
      out[nr * cols + nc] = mag[r * cols + c];
    }
  }
  return out;
}

export const fftFilter = {
  id: 'fft',
  name: 'FFT Spectrum',
  slow: true,
  meta: false,
  presets: [
    { name: 'Luma (log mag)',  params: { channel: 'luma', display: 'logmag'  } },
    { name: 'Luma (phase)',    params: { channel: 'luma', display: 'phase'   } },
    { name: 'Red (log mag)',   params: { channel: 'r',    display: 'logmag'  } },
    { name: 'Green (log mag)', params: { channel: 'g',    display: 'logmag'  } },
    { name: 'Blue (log mag)',  params: { channel: 'b',    display: 'logmag'  } },
  ],
  defaultPreset: 'Luma (log mag)',
  paramSchema: [
    {
      id: 'channel', label: 'Channel', type: 'select',
      options: [
        { value: 'luma', label: 'Luma'  },
        { value: 'r',    label: 'Red'   },
        { value: 'g',    label: 'Green' },
        { value: 'b',    label: 'Blue'  },
      ],
    },
    {
      id: 'display', label: 'Display', type: 'select',
      options: [
        { value: 'logmag', label: 'Log Magnitude' },
        { value: 'phase',  label: 'Phase'         },
      ],
    },
  ],

  apply(imageData, params) {
    const { channel, display } = params;
    const { data, width: iw, height: ih } = imageData;

    // Downsample to max 512 on the longer side
    const maxDim  = 512;
    const scale   = Math.min(1, maxDim / Math.max(iw, ih));
    const sw      = Math.max(1, Math.round(iw * scale));
    const sh      = Math.max(1, Math.round(ih * scale));
    const pw      = nextPow2(sw);
    const ph      = nextPow2(sh);

    const re = new Float64Array(ph * pw);
    const im = new Float64Array(ph * pw);

    // Sample pixels into FFT input (nearest-neighbour)
    for (let y = 0; y < sh; y++) {
      const sy = Math.min(ih - 1, Math.round(y / scale));
      for (let x = 0; x < sw; x++) {
        const sx = Math.min(iw - 1, Math.round(x / scale));
        const di = (sy * iw + sx) * 4;
        let v;
        switch (channel) {
          case 'r': v = data[di];     break;
          case 'g': v = data[di + 1]; break;
          case 'b': v = data[di + 2]; break;
          default:  v = 0.299 * data[di] + 0.587 * data[di + 1] + 0.114 * data[di + 2];
        }
        re[y * pw + x] = v - 128; // center around 0
      }
    }

    fft2d(re, im, ph, pw);

    // Compute magnitude or phase
    const raw = new Float64Array(ph * pw);
    if (display === 'phase') {
      for (let i = 0; i < ph * pw; i++) {
        raw[i] = Math.atan2(im[i], re[i]); // -π..π
      }
    } else {
      for (let i = 0; i < ph * pw; i++) {
        raw[i] = Math.log1p(Math.sqrt(re[i] * re[i] + im[i] * im[i]));
      }
    }

    const shifted = fftshift(raw, ph, pw);

    // Normalize to 0-255
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < shifted.length; i++) {
      if (shifted[i] < mn) mn = shifted[i];
      if (shifted[i] > mx) mx = shifted[i];
    }
    const range = mx - mn || 1;

    const out = new ImageData(pw, ph);
    const dst = out.data;
    for (let i = 0; i < ph * pw; i++) {
      const v = ((shifted[i] - mn) / range * 255 + 0.5) | 0;
      dst[i * 4]     = v;
      dst[i * 4 + 1] = v;
      dst[i * 4 + 2] = v;
      dst[i * 4 + 3] = 255;
    }
    return out;
  },
};
