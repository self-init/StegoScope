/**
 * Grid module.
 * Builds tile DOM elements and renders the grid.
 * User actions delegate back to app.js via _onAction callback.
 */
import { state } from './state.js';
import { FILTERS, getPresetParams } from '../filters/index.js';
import { BUILTIN_TABS } from '../presets.js';

let _onAction = null;
export function onAction(fn) { _onAction = fn; }

export function renderGrid(tileGrid) {
  if (!state.baseImageData) return;
  tileGrid.innerHTML = '';
  state.focusedTileIdx = -1;
  _onAction?.('closePanel');

  const tab = BUILTIN_TABS[state.currentTabIdx];
  state.tiles = tab.tiles.map(({ filterId, presetName }) => ({
    filterId,
    presetName,
    params: getPresetParams(filterId, presetName),
    resultImageData: null,
    loading: false,
  }));

  _onAction?.('prefetch', tab.tiles.map(t => t.filterId));
  _onAction?.('updateMemory');

  state.tiles.forEach((tile, idx) => {
    const el = buildTileEl(tile, idx);
    tileGrid.appendChild(el);
    _onAction?.('runTile', idx);
  });
}

export function buildTileEl(tile, idx) {
  const filter = FILTERS[tile.filterId];
  const el = document.createElement('div');
  el.className = 'tile' + (filter?.meta ? ' tile-meta' : '');
  el.dataset.idx = idx;
  el.tabIndex = 0;

  const wrap = document.createElement('div');
  wrap.className = 'tile-canvas-wrap';

  if (filter?.meta) {
    const { width: iw, height: ih } = state.baseImageData;
    wrap.style.aspectRatio = `${iw} / ${ih}`;
    const pre = document.createElement('div');
    pre.className = 'tile-meta-content';
    pre.textContent = 'Loading…';
    wrap.appendChild(pre);
    wrap.appendChild(makeZoomBtn(idx));
  } else {
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    const errDiv = document.createElement('div');
    errDiv.className = 'tile-error-content';
    errDiv.hidden = true;
    wrap.appendChild(errDiv);
    wrap.appendChild(makeZoomBtn(idx));
  }

  const footer = document.createElement('div');
  footer.className = 'tile-footer';
  footer.innerHTML = `<span class="tile-name">${filter?.name ?? tile.filterId}</span> <span class="tile-preset">${tile.presetName}</span>`;

  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'tile-loading';
  loadingDiv.innerHTML = '<div class="spinner"></div>';
  loadingDiv.style.display = 'none';
  wrap.appendChild(loadingDiv);

  el.appendChild(wrap);
  el.appendChild(footer);

  wrap.style.cursor = 'pointer';
  wrap.addEventListener('click', e => { e.stopPropagation(); _onAction?.('tileClick', idx); });
  wrap.addEventListener('dblclick', e => { e.stopPropagation(); _onAction?.('tileDblClick', idx); });
  footer.addEventListener('click', e => { e.stopPropagation(); _onAction?.('tileClick', idx); });
  footer.addEventListener('dblclick', e => { e.stopPropagation(); _onAction?.('tileDblClick', idx); });
  el.addEventListener('focus', () => { state.focusedTileIdx = idx; el.classList.add('focused'); });
  el.addEventListener('blur', () => el.classList.remove('focused'));
  el.addEventListener('keydown', e => _onAction?.('tileKeydown', e, idx));

  return el;
}

function makeZoomBtn(idx) {
  const btn = document.createElement('button');
  btn.className = 'tile-zoom-btn';
  btn.title = 'Preview (Space)';
  btn.innerHTML = `<svg width="19" height="19" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="6.5" cy="6.5" r="4.5"/><line x1="10.5" y1="10.5" x2="14.5" y2="14.5"/></svg>`;
  btn.addEventListener('click', e => {
    e.stopPropagation();
    _onAction?.('tileClick', idx);
    _onAction?.('showPreview');
  });
  return btn;
}

export function renderErrorTile(tileEl, err) {
  const canvas = tileEl.querySelector('canvas');
  const errDiv = tileEl.querySelector('.tile-error-content');
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
  if (canvas) canvas.hidden = true;
  if (errDiv) { errDiv.textContent = err.message || String(err); errDiv.hidden = false; }
}

export function renderImageTile(tileEl, imageData) {
  const canvas = tileEl.querySelector('canvas');
  const errDiv = tileEl.querySelector('.tile-error-content');
  if (errDiv) errDiv.hidden = true;
  if (canvas) {
    canvas.hidden = false;
    canvas.width = imageData.width;
    canvas.height = imageData.height;
    canvas.getContext('2d').putImageData(imageData, 0, 0);
  }
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

export function renderMetaTile(tileEl, result) {
  const pre = tileEl.querySelector('.tile-meta-content');
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
  if (!pre) return;
  if (result?.text) {
    pre.textContent = result.text;
  } else if (Array.isArray(result?.entries)) {
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    for (const entry of result.entries) {
      pre.appendChild(buildMetaLine(String(entry.label ?? ''), String(entry.detail ?? ''), entry.severity));
    }
  } else if (result?.entries) {
    while (pre.firstChild) pre.removeChild(pre.firstChild);
    for (const [key, val] of Object.entries(result.entries)) {
      pre.appendChild(buildMetaLine(key, String(val), null));
    }
  }
}

export function buildMetaLine(label, detail, severity) {
  const line = document.createElement('div');
  line.className = 'meta-line' + (severity ? ' sev-' + severity : '');
  const keySpan = Object.assign(document.createElement('span'), { className: 'meta-key', textContent: label });
  const valSpan = Object.assign(document.createElement('span'), { className: 'meta-val', textContent: detail });
  line.appendChild(keySpan);
  line.appendChild(document.createTextNode(': '));
  line.appendChild(valSpan);
  return line;
}
