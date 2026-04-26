/**
 * Filter worker — runs in a Web Worker thread.
 * All 30 filter modules loaded via dynamic import() using self.location
 * to derive the correct base path at runtime. No bundler, no blob URL needed.
 */
const BASE = self.location.href.replace(/\/worker\.js$/, '');
const BASE_URL = BASE.endsWith('/') ? BASE : BASE + '/';

let _done = null;

async function ensureLoaded() {
  if (_done) return _done;
  _done = import(`${BASE_URL}index.js`);
  return _done;
}

self.onmessage = async function (e) {
  const { id, filterId, imageData, params, rawFile } = e.data;

  const mod = await ensureLoaded();
  const filter = mod.FILTERS ? mod.FILTERS[filterId] : null;
  if (!filter) {
    self.postMessage({ id, error: `Unknown filter: ${filterId}` });
    return;
  }

  const imgData = new ImageData(
    new Uint8ClampedArray(imageData.data),
    imageData.width,
    imageData.height,
  );

  try {
    const result = await filter.apply(imgData, params, null, rawFile);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
