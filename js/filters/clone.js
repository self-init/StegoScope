/**
 * Clone detection — finds duplicated regions via block matching.
 * Computes DCT-like hash blocks and highlights matches.
 * Approximate — no WASM. Good enough for obvious copy-move forgeries.
 */
export const cloneFilter = {
  id: 'clone',
  name: 'Clone Detection',
  presets: [
    { name: 'Fast (16px)',   params: { blockSize: 16, threshold: 2 } },
    { name: 'Detail (8px)', params: { blockSize: 8,  threshold: 2 } },
  ],
  defaultPreset: 'Fast (16px)',
  paramSchema: [
    { id: 'blockSize',  label: 'Block Size',  type: 'range', min: 8, max: 32, step: 4 },
    { id: 'threshold',  label: 'Threshold',   type: 'range', min: 1, max: 10, step: 1 },
  ],

  apply(imageData, params) {
    const { blockSize, threshold } = params;
    const w = imageData.width;
    const h = imageData.height;
    const src = imageData.data;

    // Convert to grayscale first
    const gray = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      const idx = i * 4;
      gray[i] = Math.round(src[idx] * 0.2126 + src[idx + 1] * 0.7152 + src[idx + 2] * 0.0722);
    }

    const cols = Math.floor(w / blockSize);
    const rows = Math.floor(h / blockSize);
    const numBlocks = cols * rows;

    // Compute mean hash per block (fast approximation)
    const hashes = new Float32Array(numBlocks * 4); // mean R,G,B,std per block
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        let sum = 0, sumSq = 0;
        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            const v = gray[(by * blockSize + dy) * w + (bx * blockSize + dx)];
            sum += v;
            sumSq += v * v;
          }
        }
        const n = blockSize * blockSize;
        const mean = sum / n;
        const std = Math.sqrt(sumSq / n - mean * mean);
        const bi = (by * cols + bx) * 4;
        hashes[bi] = mean;
        hashes[bi + 1] = std;
        // Store DCT-like 2-frequency component
        let f1 = 0, f2 = 0;
        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            const v = gray[(by * blockSize + dy) * w + (bx * blockSize + dx)];
            f1 += v * Math.cos(Math.PI * dx / blockSize);
            f2 += v * Math.cos(Math.PI * dy / blockSize);
          }
        }
        hashes[bi + 2] = f1 / (blockSize * blockSize);
        hashes[bi + 3] = f2 / (blockSize * blockSize);
      }
    }

    // Find matching blocks
    const matchMap = new Uint8Array(numBlocks); // 1 = has a match
    for (let i = 0; i < numBlocks; i++) {
      const bi = i * 4;
      for (let j = i + 1; j < numBlocks; j++) {
        const bj = j * 4;
        const dMean = Math.abs(hashes[bi] - hashes[bj]);
        const dStd  = Math.abs(hashes[bi + 1] - hashes[bj + 1]);
        const dF1   = Math.abs(hashes[bi + 2] - hashes[bj + 2]);
        const dF2   = Math.abs(hashes[bi + 3] - hashes[bj + 3]);
        const dist = dMean + dStd * 0.5 + dF1 * 0.1 + dF2 * 0.1;
        if (dist < threshold) {
          matchMap[i] = 1;
          matchMap[j] = 1;
        }
      }
      // Bail early on very large images to avoid hang
      if (i > 2000) break;
    }

    // Render: base image darkened, matches highlighted in red
    const out = new ImageData(w, h);
    const dst = out.data;

    // Start with darkened original
    for (let i = 0; i < src.length; i += 4) {
      dst[i]     = src[i] >> 2;
      dst[i + 1] = src[i + 1] >> 2;
      dst[i + 2] = src[i + 2] >> 2;
      dst[i + 3] = 255;
    }

    // Overlay matching blocks
    for (let by = 0; by < rows; by++) {
      for (let bx = 0; bx < cols; bx++) {
        const bi = by * cols + bx;
        if (!matchMap[bi]) continue;
        for (let dy = 0; dy < blockSize; dy++) {
          for (let dx = 0; dx < blockSize; dx++) {
            const px = (by * blockSize + dy) * w + (bx * blockSize + dx);
            const oi = px * 4;
            // Red tint on edges only
            const onEdge = dy === 0 || dy === blockSize - 1 || dx === 0 || dx === blockSize - 1;
            if (onEdge) {
              dst[oi] = 255; dst[oi + 1] = 60; dst[oi + 2] = 60;
            } else {
              dst[oi]     = Math.min(255, src[oi] >> 1 + 80);
              dst[oi + 1] = src[oi + 1] >> 2;
              dst[oi + 2] = src[oi + 2] >> 2;
            }
          }
        }
      }
    }

    return out;
  },
};
