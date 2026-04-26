/**
 * Chi-square LSB stego attack (Westfeld & Pfitzmann 1999).
 *
 * For natural images, adjacent pixel-value pairs (2k, 2k+1) have
 * very different frequencies. Sequential LSB embedding equalises
 * them. The chi-square statistic measures that deviation:
 *
 *   χ² = Σ_k [ (n(2k) - E)² + (n(2k+1) - E)² ] / E
 *        where E = (n(2k) + n(2k+1)) / 2
 *
 * Low χ²/df → pairs look uniform → stego likely.
 * High χ²/df → pairs are skewed  → natural image.
 *
 * Threshold: χ²/df < 1.0  → alert, < 1.5 → warn.
 */

function chiSquareChannel(data, ch, width, height) {
  // Count each value 0-255 for the given channel offset
  const counts = new Float64Array(256);
  const total  = width * height;
  for (let i = ch; i < data.length; i += 4) counts[data[i]]++;

  let chi2 = 0;
  let df   = 0;
  for (let k = 0; k < 128; k++) {
    const n0  = counts[2 * k];
    const n1  = counts[2 * k + 1];
    const exp = (n0 + n1) / 2;
    if (exp < 5) continue; // skip pairs with too few samples
    chi2 += ((n0 - exp) ** 2 + (n1 - exp) ** 2) / exp;
    df++;
  }
  return { chi2, df, total };
}

// Very rough chi-square survival function for large df (Wilson-Hilferty approx)
// Returns approximate p-value P(χ² > observed | df)
function chi2pvalue(chi2, df) {
  if (df <= 0) return 1;
  const x = chi2 / df;
  // For LSB detection: x < 1 means more uniform than expected → suspicious
  // We just return the ratio; true p-values need special functions
  return x;
}

export const chiSquareFilter = {
  id: 'chi-square',
  name: 'Chi-Square',
  presets: [
    { name: 'Full image',       params: { region: 'full'  } },
    { name: 'Top half',         params: { region: 'top'   } },
    { name: 'Bottom half',      params: { region: 'bot'   } },
  ],
  defaultPreset: 'Full image',
  paramSchema: [
    {
      id: 'region', label: 'Region', type: 'select',
      options: [
        { value: 'full', label: 'Full image'  },
        { value: 'top',  label: 'Top half'    },
        { value: 'bot',  label: 'Bottom half' },
        { value: 'left', label: 'Left half'   },
        { value: 'right',label: 'Right half'  },
      ],
    },
  ],

  apply(imageData, params) {
    const { region } = params;
    const { data, width, height } = imageData;

    // Crop to region
    let startRow = 0, endRow = height;
    let startCol = 0, endCol = width;
    if (region === 'top')   endRow   = height >> 1;
    if (region === 'bot')   startRow = height >> 1;
    if (region === 'left')  endCol   = width  >> 1;
    if (region === 'right') startCol = width  >> 1;

    const rh = endRow - startRow;
    const rw = endCol - startCol;
    // Copy region into flat RGBA buffer
    const sub = new Uint8Array(rw * rh * 4);
    for (let y = startRow; y < endRow; y++) {
      for (let x = startCol; x < endCol; x++) {
        const si = (y * width + x) * 4;
        const di = ((y - startRow) * rw + (x - startCol)) * 4;
        sub[di]     = data[si];
        sub[di + 1] = data[si + 1];
        sub[di + 2] = data[si + 2];
        sub[di + 3] = data[si + 3];
      }
    }

    const channels = [
      { name: 'Red',   ch: 0 },
      { name: 'Green', ch: 1 },
      { name: 'Blue',  ch: 2 },
      { name: 'Alpha', ch: 3 },
    ];

    const entries = [];
    entries.push({
      label: 'Region',
      detail: `${rw}×${rh} pixels (${(rw * rh).toLocaleString()} samples)`,
      severity: 'info',
    });
    entries.push({
      label: 'Interpretation',
      detail: 'χ²/df < 1.0 → pairs uniform → stego likely   ≥ 2.0 → natural',
      severity: 'info',
    });

    for (const { name, ch } of channels) {
      const { chi2, df } = chiSquareChannel(sub, ch, rw, rh);
      if (df === 0) {
        entries.push({ label: name, detail: 'insufficient data', severity: 'info' });
        continue;
      }
      const ratio = chi2 / df;
      let note, sev;
      if (ratio < 1.0) {
        note = '← LIKELY STEGO';
        sev  = 'alert';
      } else if (ratio < 1.5) {
        note = '← suspicious';
        sev  = 'warn';
      } else {
        note = '— natural';
        sev  = null;
      }
      entries.push({
        label:    `${name} χ²/df`,
        detail:   `${ratio.toFixed(3)}  (χ²=${chi2.toFixed(1)}, df=${df}) ${note}`,
        severity: sev,
      });
    }

    return { entries };
  },
};
