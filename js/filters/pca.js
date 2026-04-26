/**
 * PCA projection filter.
 * 3x3 covariance on RGB, Jacobi eigendecomposition, project onto chosen PC.
 * Slow → explicit Apply.
 */
export const pcaFilter = {
  id: 'pca',
  name: 'PCA',
  presets: [
    { name: 'PC1', params: { component: 1, normalize: true } },
    { name: 'PC2', params: { component: 2, normalize: true } },
    { name: 'PC3', params: { component: 3, normalize: true } },
  ],
  defaultPreset: 'PC1',
  paramSchema: [
    {
      id: 'component', label: 'Component', type: 'select',
      options: [
        { value: 1, label: 'PC1 (dominant)' },
        { value: 2, label: 'PC2' },
        { value: 3, label: 'PC3 (residual)' },
      ],
    },
  ],

  apply(imageData, params) {
    const componentRaw = params.component;
    const component = (typeof componentRaw === 'string' ? parseInt(componentRaw, 10) : componentRaw) | 0;
    const normalize = params.normalize !== false;
    const src = imageData.data;
    const n = imageData.width * imageData.height;

    let mr = 0, mg = 0, mb = 0;
    for (let i = 0; i < src.length; i += 4) {
      mr += src[i]; mg += src[i + 1]; mb += src[i + 2];
    }
    mr /= n; mg /= n; mb /= n;

    let crr = 0, cgg = 0, cbb = 0, crg = 0, crb = 0, cgb = 0;
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i] - mr, g = src[i + 1] - mg, b = src[i + 2] - mb;
      crr += r * r; cgg += g * g; cbb += b * b;
      crg += r * g; crb += r * b; cgb += g * b;
    }
    crr /= n; cgg /= n; cbb /= n; crg /= n; crb /= n; cgb /= n;

    const M = [
      [crr, crg, crb],
      [crg, cgg, cgb],
      [crb, cgb, cbb],
    ];

    const { vectors, values } = jacobiEigen3(M);
    const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
    const pick = order[component - 1] ?? order[0];
    const v = vectors[pick];

    const proj = new Float32Array(n);
    let min = Infinity, max = -Infinity;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      const val = (src[i] - mr) * v[0] + (src[i + 1] - mg) * v[1] + (src[i + 2] - mb) * v[2];
      proj[p] = val;
      if (val < min) min = val;
      if (val > max) max = val;
    }

    const out = new ImageData(imageData.width, imageData.height);
    const dst = out.data;
    const range = max - min;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
      let g;
      if (normalize && range > 1e-9) {
        g = ((proj[p] - min) / range) * 255;
      } else {
        g = 128 + proj[p];
        if (g < 0) g = 0; else if (g > 255) g = 255;
      }
      dst[i] = dst[i + 1] = dst[i + 2] = g | 0;
      dst[i + 3] = 255;
    }
    return out;
  },
};

function jacobiEigen3(M) {
  const a = [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]],
  ];
  const V = [[1,0,0],[0,1,0],[0,0,1]];
  const MAX_SWEEPS = 32;
  const EPS = 1e-10;

  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    const offDiag = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (offDiag < EPS) break;

    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < EPS) continue;
        const app = a[p][p], aqq = a[q][q];
        const theta = (aqq - app) / (2 * apq);
        const t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;

        a[p][p] = app - t * apq;
        a[q][q] = aqq + t * apq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r][p], arq = a[r][q];
            a[r][p] = c * arp - s * arq;
            a[p][r] = a[r][p];
            a[r][q] = s * arp + c * arq;
            a[q][r] = a[r][q];
          }
          const vrp = V[r][p], vrq = V[r][q];
          V[r][p] = c * vrp - s * vrq;
          V[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const values = [a[0][0], a[1][1], a[2][2]];
  const vectors = [
    [V[0][0], V[1][0], V[2][0]],
    [V[0][1], V[1][1], V[2][1]],
    [V[0][2], V[1][2], V[2][2]],
  ];
  return { vectors, values };
}
