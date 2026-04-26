/**
 * Worker pool.
 * Manages a fixed pool of filter-worker instances. Dispatches filter tasks
 * round-robin and respawns crashed workers automatically.
 *
 * Worker instances are loaded from js/filters/worker.js via dynamic import()
 * on each Worker construction. The worker's own URL is used to derive the
 * correct base path so all filter modules load correctly — no blob URL needed.
 */

const WORKER_PATH = './js/filters/worker.js';

let _instance = null;
export function getWorkerPool() {
  if (!_instance) {
    _instance = new FilterWorkerPool();
    _instance.start();
  }
  return _instance;
}

export function prefetchTab(tabFilterIds) {
  getWorkerPool().prefetch(tabFilterIds);
}

export class FilterWorkerPool {
  constructor() {
    this._workers = [];
    this._nextIdx = 0;
    this._pending = new Map();
    this._nextId = 0;
    this._running = false;
  }

  /** Spawn workers up to hardwareConcurrency, register message handler */
  start() {
    if (this._running) return;
    this._running = true;
    const count = navigator.hardwareConcurrency || 4;
    for (let i = 0; i < count; i++) {
      this._spawnWorker();
    }
  }

  _spawnWorker() {
    const worker = new Worker(WORKER_PATH);
    worker.onmessage = (e) => {
      const { id, result, error } = e.data;
      const pending = this._pending.get(id);
      if (!pending) return;
      this._pending.delete(id);
      if (error) pending.reject(new Error(error));
      else pending.resolve(result);
    };
    worker.onerror = () => {
      const idx = this._workers.indexOf(worker);
      if (idx >= 0) this._workers.splice(idx, 1);
      worker.terminate();
      if (this._running) {
        try { this._spawnWorker(); } catch { /* ignore spawn failure */ }
      }
    };
    this._workers.push(worker);
  }

  /**
   * Dispatch a filter task to the pool.
   * @param {object} task — { filterId, imageData, params, rawFile: ArrayBuffer | null }
   * @returns {Promise} — resolves to the filter result
   *
   * rawFile is transferred as ArrayBuffer (zero-copy) when provided.
   * imageData.data is transferred as Uint8ClampedArray (zero-copy).
   */
  dispatch(task) {
    return new Promise((resolve, reject) => {
      const id = this._nextId++;
      this._pending.set(id, { resolve, reject });

      const msg = {
        id,
        filterId: task.filterId,
        imageData: {
          data: task.imageData.data,
          width: task.imageData.width,
          height: task.imageData.height,
        },
        params: task.params,
        rawFile: task.rawFile,
      };

      const worker = this._workers[this._nextIdx % this._workers.length];
      this._nextIdx++;

      const transfer = [];
      if (msg.rawFile instanceof ArrayBuffer) transfer.push(msg.rawFile);
      // Don't transfer imageData.data — structured clone copies it fine.
      // imageData is small enough that zero-copy isn't worth the detachment risk.

      worker.postMessage(msg, transfer);
    });
  }

  /** Terminate all workers and clear pending queue */
  terminate() {
    this._running = false;
    for (const w of this._workers) w.terminate();
    this._workers = [];
    for (const [, { reject }] of this._pending) reject(new Error('pool terminated'));
    this._pending.clear();
  }

  /**
   * Pre-fetch filter modules into the worker cache.
   * Fires off dispatch calls for all filterIds so workers load the modules,
   * then immediately resolves the promises without returning results.
   * Safe to call multiple times — workers cache modules automatically.
   */
  prefetch(filterIds) {
    for (const filterId of filterIds) {
      // Fire and forget — each worker will lazy-load the module on first use
      const fakeTask = {
        filterId,
        imageData: { data: new Uint8ClampedArray(4), width: 1, height: 1 },
        params: {},
        rawFile: null,
      };
      // Use a minimal resolution so the filter returns fast
      this.dispatch(fakeTask).catch(() => {}); // ignore errors (filters may not handle 1x1)
    }
  }
}
