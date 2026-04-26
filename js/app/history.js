/**
 * History module.
 * undo/redo, renderHistory, restoreHistory. Delegates grid rendering back to app.js.
 */
import { state } from './state.js';
import { imageDataChecksum } from './cache.js';

let _onAction = null;
export function onAction(fn) { _onAction = fn; }

export function initHistory() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  undoBtn?.addEventListener('click', undoHistory);
  redoBtn?.addEventListener('click', redoHistory);
}

export function undoHistory() {
  if (state.activeHistoryIdx > 0) restoreHistory(state.activeHistoryIdx - 1);
}

export function redoHistory() {
  if (state.activeHistoryIdx < state.history.length - 1) restoreHistory(state.activeHistoryIdx + 1);
}

export function updateUndoRedoButtons() {
  const undoBtn = document.getElementById('undo-btn');
  const redoBtn = document.getElementById('redo-btn');
  if (undoBtn) undoBtn.disabled = state.activeHistoryIdx <= 0;
  if (redoBtn) redoBtn.disabled = state.activeHistoryIdx >= state.history.length - 1;
}

export function renderHistory() {
  const historyList = document.getElementById('history-list');
  if (!historyList) return;
  historyList.innerHTML = '';
  if (!state.history.length) {
    historyList.innerHTML = '<div class="history-empty">No image loaded</div>';
    updateUndoRedoButtons();
    return;
  }

  state.history.forEach((entry, i) => {
    const el = document.createElement('div');
    el.className = 'history-entry' + (i === state.activeHistoryIdx ? ' active' : '');

    const thumb = document.createElement('canvas');
    thumb.className = 'history-thumb';
    thumb.width = 36; thumb.height = 36;
    const tctx  = thumb.getContext('2d');
    const sw = entry.canvas.width, sh = entry.canvas.height;
    const scale = Math.min(36 / sw, 36 / sh);
    const dw = sw * scale, dh = sh * scale;
    tctx.drawImage(entry.canvas, (36 - dw) / 2, (36 - dh) / 2, dw, dh);

    const info  = document.createElement('div');
    info.className = 'history-entry-info';
    info.appendChild(Object.assign(document.createElement('div'), {
      className: 'history-entry-label', textContent: entry.label,
    }));
    info.appendChild(Object.assign(document.createElement('div'), {
      className: 'history-entry-sub', textContent: `Step ${i + 1}`,
    }));

    el.appendChild(thumb);
    el.appendChild(info);
    el.tabIndex = 0;

    el.addEventListener('click', () => restoreHistory(i));
    el.addEventListener('keydown', e => {
      const entries = [...historyList.querySelectorAll('.history-entry')];
      const cur     = entries.indexOf(e.currentTarget);
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        entries[Math.max(0, cur - 1)]?.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        entries[Math.min(entries.length - 1, cur + 1)]?.focus();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        _onAction?.('focusTile', state.focusedTileIdx >= 0 ? state.focusedTileIdx : 0);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        restoreHistory(i);
      }
    });
    historyList.appendChild(el);
  });

  historyList.querySelector('.history-entry.active')?.scrollIntoView({ block: 'nearest' });
  updateUndoRedoButtons();
}

export function restoreHistory(idx) {
  const entry = state.history[idx];
  if (!entry) return;
  state.activeHistoryIdx = idx;
  state.baseCanvas    = entry.canvas;
  state.baseImageData = entry.canvas.getContext('2d').getImageData(
    0, 0, entry.canvas.width, entry.canvas.height,
  );
  state.baseImageDataChecksum = imageDataChecksum(state.baseImageData);
  state.tileResultCache = new Map();
  _onAction?.('renderHistory');
  _onAction?.('renderGrid');
}
