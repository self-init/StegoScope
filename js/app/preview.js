/**
 * Preview module.
 * Large image/text preview overlay + search. Delegates to app.js via _onAction.
 */
import { state } from './state.js';
import { FILTERS } from '../filters/index.js';

let _onAction = null;
export function onAction(fn) { _onAction = fn; }

// =====================================================================
// Preview state
// =====================================================================
const preview = {
  visible:      false,
  holdMode:     false,
  holdTimer:    null,
  HOLD_MS:      180,
  savedTileIdx: -1,
};
export { preview };

// =====================================================================
// DOM refs (resolved on first show)
// =====================================================================

export function showPreview() {
  if (!state.baseImageData) return;

  const previewOverlay      = document.getElementById('preview-overlay');
  const previewCanvas       = document.getElementById('preview-canvas');
  const previewCanvasWrap   = document.getElementById('preview-canvas-wrap');
  const previewLabel        = document.getElementById('preview-label');
  const previewDims         = document.getElementById('preview-dims');
  const previewClose        = document.getElementById('preview-close');
  const previewSearchBar    = document.getElementById('preview-search-bar');
  const previewSearchInput  = document.getElementById('preview-search-input');
  const previewRegexBtn     = document.getElementById('preview-regex-btn');
  const previewCaseBtn      = document.getElementById('preview-case-btn');
  const previewTextOutput   = document.getElementById('preview-text-output');

  const idx    = state.focusedTileIdx;
  const tile   = idx >= 0 ? state.tiles[idx] : null;
  const filter = tile ? FILTERS[tile.filterId] : null;
  const useFiltered = tile && tile.resultImageData && !filter?.meta;

  preview.savedTileIdx = idx;

  previewSearchBar.hidden = true;
  previewCanvasWrap.hidden = true;
  previewTextOutput.hidden = true;
  previewSearchInput.value = '';
  previewRegexBtn.checked = false;
  previewCaseBtn.checked = false;

  if (filter?.meta && tile.resultImageData) {
    const result = tile.resultImageData;
    const text = result?.text
      ?? (Array.isArray(result?.entries) ? result.entries.map(e => `${e.label}: ${e.detail}`).join('\n') : '')
      ?? '';
    previewTextOutput.textContent = text;
    previewTextOutput.hidden = false;
    previewSearchBar.hidden = false;
    previewLabel.textContent = `${filter.name} — ${tile.presetName}`;
    previewDims.innerHTML = `${text.split('\n').length} lines &nbsp;·&nbsp; <kbd>Space</kbd> or <kbd>Esc</kbd> to close`;
  } else {
    const imgData = useFiltered ? tile.resultImageData : state.baseImageData;
    const label   = useFiltered ? `${filter?.name} — ${tile.presetName}` : 'Original';
    previewCanvas.width  = imgData.width;
    previewCanvas.height = imgData.height;
    previewCanvas.getContext('2d').putImageData(imgData, 0, 0);
    previewCanvasWrap.hidden = false;
    previewLabel.textContent = label;
    previewDims.innerHTML =
      `${imgData.width} × ${imgData.height} &nbsp;·&nbsp; <kbd>Space</kbd> or <kbd>Esc</kbd> to close`;
  }

  previewOverlay.classList.remove('hidden');
  previewClose.focus();
  preview.visible = true;
  _onAction?.('updateKeybindBar');
}

export function initPreview() {
  const previewClose        = document.getElementById('preview-close');
  const previewOverlay      = document.getElementById('preview-overlay');
  const previewSearchInput  = document.getElementById('preview-search-input');
  const previewRegexBtn     = document.getElementById('preview-regex-btn');
  const previewCaseBtn      = document.getElementById('preview-case-btn');

  previewClose?.addEventListener('click', hidePreview);
  previewOverlay?.addEventListener('click', e => {
    if (e.target === previewOverlay || e.target.classList.contains('preview-canvas-wrap')) hidePreview();
  });
  previewSearchInput?.addEventListener('input', applyPreviewSearch);
  previewRegexBtn?.addEventListener('change', applyPreviewSearch);
  previewCaseBtn?.addEventListener('change', applyPreviewSearch);
}

export function hidePreview() {
  const previewOverlay = document.getElementById('preview-overlay');
  previewOverlay?.classList.add('hidden');
  preview.visible  = false;
  preview.holdMode = false;
  if (preview.savedTileIdx >= 0) _onAction?.('focusTile', preview.savedTileIdx);
  preview.savedTileIdx = -1;
  _onAction?.('updateKeybindBar');
}

export function applyPreviewSearch() {
  const previewTextOutput  = document.getElementById('preview-text-output');
  const previewSearchInput = document.getElementById('preview-search-input');
  const previewRegexBtn   = document.getElementById('preview-regex-btn');
  const previewCaseBtn    = document.getElementById('preview-case-btn');

  const text  = previewTextOutput.textContent || '';
  const query = previewSearchInput.value;
  if (!query) {
    previewTextOutput.innerHTML = escHtml(text);
    return;
  }
  const regexMode     = previewRegexBtn.checked;
  const caseSensitive = previewCaseBtn.checked;
  let regex;
  try {
    regex = regexMode
      ? new RegExp(query, caseSensitive ? 'g' : 'gi')
      : null;
  } catch {
    previewTextOutput.innerHTML = escHtml(text);
    return;
  }
  if (regex) {
    const highlighted = text.replace(regex, m => `<mark>${escHtml(m)}</mark>`);
    previewTextOutput.innerHTML = highlighted;
  } else {
    const needle   = caseSensitive ? query : query.toLowerCase();
    const haystack = caseSensitive ? text : text.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) {
      previewTextOutput.innerHTML = escHtml(text);
    } else {
      const regexAll = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');
      previewTextOutput.innerHTML = text.replace(regexAll, m => `<mark>${escHtml(m)}</mark>`);
    }
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
