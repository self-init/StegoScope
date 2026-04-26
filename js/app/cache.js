/**
 * Cache + tile run module.
 * imageDataChecksum, makeCacheKey, runTile moved from app.js.
 */
import { state } from './state.js';

let _pool = null;
export function initCache(pool) { _pool = pool; }

/** Adler-32 checksum of a sampled pixel region — fast cache key for ImageData */
export function imageDataChecksum(imgData) {
  const { data, width, height } = imgData;
  const step = Math.max(1, Math.floor((width * height) / 8192));
  let a = 1, b = 0;
  let i = 0;
  const len = width * height;
  while (i < len) {
    const byte = data[i * 4];
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
    i += step;
  }
  return ((b << 16) | a) >>> 0;
}

export function makeCacheKey(checksum, filterId, params) {
  return `${checksum}|${filterId}|${JSON.stringify(params)}`;
}

export async function runTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return null;

  const cacheKey = makeCacheKey(state.baseImageDataChecksum, tile.filterId, tile.params);
  let result;
  if (state.tileResultCache.has(cacheKey)) {
    result = state.tileResultCache.get(cacheKey);
  } else {
    const rawFileBuffer = state.rawFile ? await state.rawFile.arrayBuffer() : null;
    result = await _pool.dispatch({
      filterId: tile.filterId,
      imageData: state.baseImageData,
      params: tile.params,
      rawFile: rawFileBuffer,
    });
    state.tileResultCache.set(cacheKey, result);
  }

  tile.resultImageData = result;
  return result;
}
