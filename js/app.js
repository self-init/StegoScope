import { FILTERS, getPresetParams } from './filters/index.js';
import { BUILTIN_TABS } from './presets.js';
import { getWorkerPool, prefetchTab } from './workers/pool.js';
import { initCache, imageDataChecksum, runTile as runTileCache } from './app/cache.js';
import { state } from './app/state.js';
import { setZoom, adjustZoom, initZoom } from './app/zoom.js';
import { renderGrid, renderErrorTile, renderImageTile, renderMetaTile, onAction as gridOnAction, buildMetaLine } from './app/grid.js';
import { handleTabBarKeydown } from './app/keyboard.js';
import { initHistory, undoHistory, redoHistory, updateUndoRedoButtons, renderHistory, restoreHistory, onAction as historyOnAction } from './app/history.js';
import { initPanel, openPanel, closePanelUI, hidePropertiesPanel, showPropertiesPanel, renderPresetBar, renderParamControls, markDirty, updatePromoteBtn, updateExportBtn, applyParamPreview, promoteCurrentTile, promote, metaResultToText, exportTile, onAction as panelOnAction } from './app/panel.js';
import { showPreview, hidePreview, applyPreviewSearch, preview, initPreview, onAction as previewOnAction } from './app/preview.js';
import { initMenu, openMenuDropdown, closeMenuDropdown, menubar, onAction as menuOnAction } from './app/menu.js';

initCache(getWorkerPool());

// =====================================================================
// DOM refs
// =====================================================================
const dropZone              = document.getElementById('drop-zone');
const fileInput             = document.getElementById('file-input');
const tileGrid              = document.getElementById('tile-grid');
const historyList           = document.getElementById('history-list');
const historyPanel          = document.getElementById('history-panel');
const historyPanelClose     = document.getElementById('history-panel-close');
const tabBar                = document.getElementById('tab-bar');
const imageInfo             = document.getElementById('image-info');
const paramPanel            = document.getElementById('param-panel');
const paramTitle            = document.getElementById('param-panel-title');
const paramClose            = document.getElementById('param-panel-close');
const paramPanelBody        = document.getElementById('param-panel-body');
const paramPanelPlaceholder = document.getElementById('param-panel-placeholder');
const presetBar             = document.getElementById('preset-bar');
const paramCtrls            = document.getElementById('param-controls');
const promoteBtn            = document.getElementById('promote-btn');
const applyBtn              = document.getElementById('apply-btn');
const exportTileBtn         = document.getElementById('export-tile-btn');
const undoBtn               = document.getElementById('undo-btn');
const redoBtn               = document.getElementById('redo-btn');
const previewOverlay        = document.getElementById('preview-overlay');
const previewCanvas         = document.getElementById('preview-canvas');
const previewCanvasWrap    = document.getElementById('preview-canvas-wrap');
const previewLabel          = document.getElementById('preview-label');
const previewDims           = document.getElementById('preview-dims');
const previewClose          = document.getElementById('preview-close');
const previewSearchBar      = document.getElementById('preview-search-bar');
const previewSearchInput    = document.getElementById('preview-search-input');
const previewRegexBtn       = document.getElementById('preview-regex-btn');
const previewCaseBtn        = document.getElementById('preview-case-btn');
const previewTextOutput     = document.getElementById('preview-text-output');
const keybindBar            = document.getElementById('keybind-bar');
const zoomInBtn             = document.getElementById('zoom-in-btn');
const zoomOutBtn            = document.getElementById('zoom-out-btn');
const zoomLabel             = document.getElementById('zoom-label');

// =====================================================================
// Export helpers
// =====================================================================
function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportCurrentImage() {
  const entry = state.history[state.activeHistoryIdx];
  if (!entry) return;
  entry.canvas.toBlob(
    blob => downloadBlob(blob, `stegoscope-step${state.activeHistoryIdx + 1}.png`),
    'image/png',
  );
}

// =====================================================================
// Image loading
// =====================================================================
function loadImageFile(file) {
  state.rawFile = file;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);

    const canvas = document.createElement('canvas');
    canvas.width  = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);

    state.baseCanvas    = canvas;
    state.baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.baseImageDataChecksum = imageDataChecksum(state.baseImageData);
    state.tileResultCache = new Map();

    state.history = [{ canvas, filterId: null, presetName: null, label: 'Original' }];
    state.activeHistoryIdx = 0;

    dropZone.hidden   = true;
    tileGrid.hidden   = false;

    renderTabs();
    renderHistory();
    renderGrid(tileGrid);
    updateKeybindBar();
  };
  img.onerror = () => alert('Could not load image.');
  img.src = url;
}

function handleDragOver(e)  { e.preventDefault(); dropZone.classList.add('drag-over'); }
function handleDragLeave(e) {
  if (!e.currentTarget.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
}
function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) loadImageFile(file);
}

dropZone.addEventListener('dragover',  handleDragOver);
dropZone.addEventListener('dragleave', handleDragLeave);
dropZone.addEventListener('drop',      handleDrop);
// Clicking anywhere in drop zone (except the label, which already triggers input) opens picker
dropZone.addEventListener('click', e => {
  if (!e.target.closest('label')) fileInput.click();
});
document.getElementById('grid-area').addEventListener('dragover', e => e.preventDefault());
document.getElementById('grid-area').addEventListener('drop', handleDrop);
fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadImageFile(fileInput.files[0]); });

// =====================================================================
// Tab rendering
// =====================================================================
function renderTabs() {
  tabBar.innerHTML = '';
  BUILTIN_TABS.forEach((tab, i) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn' + (i === state.currentTabIdx ? ' active' : '');
    btn.textContent = tab.name;
    btn.dataset.idx = i;
    btn.addEventListener('click', () => { state.currentTabIdx = i; renderTabs(); renderGrid(tileGrid); });
    tabBar.appendChild(btn);
  });
}

tabBar.addEventListener('keydown', e => { handleTabBarKeydown(e); });

// =====================================================================
// Grid rendering
// =====================================================================
const FILE_MENU = [
  { label: 'Open Image…',          action: () => fileInput.click() },
  { sep: true },
  { label: 'Export Current Image', action: exportCurrentImage },
];

function toggleHistoryPanel() {
  state.historyPanelOpen = !state.historyPanelOpen;
  historyPanel.style.display = state.historyPanelOpen ? '' : 'none';
  updateKeybindBar();
}

function togglePropertiesPanel() {
  state.propertiesPanelOpen = !state.propertiesPanelOpen;
  if (state.propertiesPanelOpen) showPropertiesPanel();
  else hidePropertiesPanel();
  updateKeybindBar();
}

function getViewMenu() {
  return [
    { label: 'Preview',    action: showPreview,              keyhint: 'Space' },
    { sep: true },
    { label: 'History Panel',    checked: state.historyPanelOpen,    action: toggleHistoryPanel },
    { label: 'Properties Panel', checked: state.propertiesPanelOpen, action: togglePropertiesPanel },
    { sep: true },
    { label: 'Zoom In',    action: () => adjustZoom(+1), keyhint: 'Ctrl+=' },
    { label: 'Zoom Out',   action: () => adjustZoom(-1), keyhint: 'Ctrl+−' },
    { label: 'Reset Zoom', action: () => setZoom(3),     keyhint: 'Ctrl+0' },
  ];
}

function handleGridAction(action, ...args) {
  switch (action) {
    case 'tileClick':      focusTile(args[0]); openPanel(args[0]); break;
    case 'tileDblClick':   focusTile(args[0]); promote(args[0]); break;
    case 'tileKeydown':    handleTileKeydown(args[0], args[1]); break;
    case 'showPreview':    showPreview(); break;
    case 'closePanel':     closePanelUI(); break;
    case 'closePanelUI':   closePanelUI(); break;
    case 'prefetch':       prefetchTab(args[0]); break;
    case 'updateMemory':   updateMemoryInfo(); break;
    case 'runTile':        runTile(args[0]); break;
    case 'focusTile':      focusTile(args[0]); break;
    case 'renderHistory': renderHistory(); break;
    case 'renderGrid':     renderGrid(tileGrid); break;
    case 'hidePropertiesPanel': hidePropertiesPanel(); break;
    case 'renderPresetBar':    renderPresetBar(args[0], args[1]); break;
    case 'renderParamControls': renderParamControls(args[0], args[1]); break;
    case 'markDirty':      markDirty(); break;
    case 'updatePromoteBtn': updatePromoteBtn(); break;
    case 'updateExportBtn': updateExportBtn(); break;
    case 'applyParamPreview': applyParamPreview(); break;
    case 'promoteCurrentTile': promoteCurrentTile(); break;
    case 'applyAndPromote': applyParamPreview().then(() => promoteCurrentTile()); break;
    case 'promote':        promote(args[0]); break;
    case 'exportTile':      exportTile(); break;
    case 'updateKeybindBar': updateKeybindBar(); break;
    case 'focusFirstControl': focusFirstControl(); break;
    case 'focusLastControl': focusLastControl(); break;
    case 'downloadBlob':    downloadBlob(args[0], args[1]); break;
    case 'clearTileActivePanel': tileGrid.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel')); break;
    case 'openMenu':
      if (args[0] === 'file') openMenuDropdown('file', FILE_MENU);
      else if (args[0] === 'view') openMenuDropdown('view', getViewMenu());
      break;
  }
}

async function runTile(idx) {
  const tile = state.tiles[idx];
  if (!tile) return;
  const tileEl = tileGrid.children[idx];
  if (!tileEl) return;
  const filter     = FILTERS[tile.filterId];
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'flex';
  tile.loading = true;

  try {
    const result = await runTileCache(idx);
    tile.resultImageData = result;
    tile.loading = false;
    updateMemoryInfo();
    updateExportBtn();

    if (filter?.meta) { renderMetaTile(tileEl, result); }
    else               { renderImageTile(tileEl, result); }
  } catch (err) {
    console.error(`Filter ${tile.filterId} failed:`, err);
    tile.loading = false;
    renderErrorTile(tileEl, err);
  }
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateMemoryInfo() {
  if (!state.baseImageData) return;
  let bytes = state.baseImageData.width * state.baseImageData.height * 4;
  const counted = new Set();
  const countTileResult = r => {
    if (r instanceof ImageData && !counted.has(r)) {
      counted.add(r);
      bytes += r.width * r.height * 4;
    }
  };
  for (const tile of state.tiles) {
    countTileResult(tile.resultImageData);
  }
  for (const result of state.tileResultCache.values()) {
    countTileResult(result);
  }
  const memStr = bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`;
  const { width: w, height: h } = state.baseImageData;
  imageInfo.textContent = `${w} × ${h} · ${memStr} — ${state.rawFile?.name ?? ''}`;
}

// =====================================================================
// Cross-panel focus helpers
// =====================================================================
function focusHistory() {
  const first = historyList.querySelector('.history-entry');
  (first ?? dropZone).focus();
}

function focusPanel() {
  if (state.panelOpen) promoteBtn.focus();
  else if (state.propertiesPanelOpen) paramClose.focus();
}

function focusMenubar() {
  const first = tabBar.querySelector('.tab-btn') ?? menubar.querySelector('.menu-btn');
  first?.focus();
}

// =====================================================================
// Focus / keyboard
// =====================================================================
function focusTile(idx) {
  const tileEl = tileGrid.children[idx];
  if (!tileEl) return;
  tileGrid.querySelectorAll('.tile.focused').forEach(el => el.classList.remove('focused'));
  tileEl.classList.add('focused');
  tileEl.focus({ preventScroll: false });
  state.focusedTileIdx = idx;
  updateKeybindBar();
}

function handleTileKeydown(e) {
  const idx  = parseInt(e.currentTarget.dataset.idx, 10);
  const cols = getGridCols();

  switch (e.key) {
    case 'ArrowRight':
      e.preventDefault();
      if (idx % cols === cols - 1 || idx === state.tiles.length - 1) {
        if (state.panelOpen) focusPanel();
      } else {
        focusTile(idx + 1);
      }
      break;
    case 'ArrowLeft':
      e.preventDefault();
      if (idx % cols === 0) focusHistory();
      else focusTile(idx - 1);
      break;
    case 'ArrowDown':
      e.preventDefault();
      focusTile(Math.min(idx + cols, state.tiles.length - 1));
      break;
    case 'ArrowUp':
      e.preventDefault();
      if (idx < cols) focusMenubar();
      else focusTile(idx - cols);
      break;
    case 'Enter':
      e.preventDefault();
      if (!state.panelOpen || state.panelTileIdx !== idx) openPanel(idx);
      else promoteCurrentTile();
      break;
    case 'Escape':
      e.preventDefault();
      if (state.panelOpen) { closePanelUI(); focusTile(idx); }
      else { e.currentTarget.blur(); state.focusedTileIdx = -1; updateKeybindBar(); }
      break;
  }
}

function getGridCols() {
  return getComputedStyle(tileGrid).gridTemplateColumns.split(' ').length;
}

// Global keyboard shortcuts
document.addEventListener('keydown', e => {
  // Default arrow key with no tile actually focused → select first tile
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)
    && state.baseImageData
    && !state.panelOpen
    && !preview.visible
    && !historyPanel.contains(document.activeElement)
    && !paramPanel.contains(document.activeElement)
    && !menubar.contains(document.activeElement)) {
    const tileHasFocus = state.focusedTileIdx >= 0
      && tileGrid.children[state.focusedTileIdx] === document.activeElement;
    if (!tileHasFocus) {
      e.preventDefault();
      focusTile(0);
      return;
    }
  }

  // Ctrl+1–9 — switch tabs
  if (e.ctrlKey && e.key >= '1' && e.key <= '9') {
    const i = parseInt(e.key, 10) - 1;
    if (i < BUILTIN_TABS.length) {
      e.preventDefault();
      state.currentTabIdx = i;
      renderTabs();
      renderGrid(tileGrid);
    }
  }

  // Zoom
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); adjustZoom(+1); }
  if (e.ctrlKey && e.key === '-')                    { e.preventDefault(); adjustZoom(-1); }
  if (e.ctrlKey && e.key === '0')                    { e.preventDefault(); setZoom(3); }

  // Undo / Redo
  if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undoHistory(); }
  if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redoHistory(); }
});

// =====================================================================
// Promote
// =====================================================================
promoteBtn.addEventListener('click', () => promoteCurrentTile());

function isInteractiveTarget(el) {
  return ['INPUT','SELECT','TEXTAREA','BUTTON'].includes(el.tagName);
}

document.addEventListener('keydown', e => {
  if (e.key === ' ' && !e.repeat && !isInteractiveTarget(document.activeElement)) {
    e.preventDefault();
    preview.holdTimer = setTimeout(() => {
      preview.holdMode = true;
      if (!preview.visible) showPreview();
    }, preview.HOLD_MS);
  }
});

document.addEventListener('keyup', e => {
  if (e.key === ' ') {
    clearTimeout(preview.holdTimer);
    if (preview.holdMode) { hidePreview(); preview.holdMode = false; }
    else { if (preview.visible) hidePreview(); else showPreview(); }
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && preview.visible) { e.preventDefault(); hidePreview(); }
});

// =====================================================================
// Keybind bar
// =====================================================================
function kb(action, keys) {
  // keys: array of strings — '+' items render as separator, others as <kbd>
  const keysHtml = keys.map(k =>
    k === '+' ? '<span class="kb-sep">+</span>' : `<kbd class="kb-key">${escHtml(k)}</kbd>`,
  ).join('');
  return `<span class="kb-item">${keysHtml}<span class="kb-action">${escHtml(action)}</span></span>`;
}

function updateKeybindBar() {
  if (preview.visible) {
    keybindBar.innerHTML =
      kb('Close preview', ['Space']) +
      kb('Close preview', ['Esc']);
    return;
  }

  if (!state.baseImageData) {
    keybindBar.innerHTML = kb('Load image', ['Drop / Browse']);
    return;
  }

  if (state.panelOpen) {
    keybindBar.innerHTML =
      kb('Promote',     ['Enter']) +
      kb('Parameters',  ['Tab']) +
      kb('Preview',     ['Space']) +
      kb('Close panel', ['Esc']);
    return;
  }

  if (state.focusedTileIdx >= 0) {
    keybindBar.innerHTML =
      kb('Navigate',    ['↑','↓','←','→']) +
      kb('Open filter', ['Enter']) +
      kb('Preview',     ['Space']) +
      kb('Deselect',    ['Esc']) +
      kb('Switch tab',  ['Ctrl','+','1–7']);
    return;
  }

  keybindBar.innerHTML =
    kb('Navigate tiles', ['↑','↓','←','→']) +
    kb('Preview',        ['Space']) +
    kb('Switch tab',     ['Ctrl','+','1–7']);
}

// =====================================================================
// Init
// =====================================================================
gridOnAction(handleGridAction);
historyOnAction(handleGridAction);
panelOnAction(handleGridAction);
previewOnAction(handleGridAction);
menuOnAction(handleGridAction);
renderTabs();
initZoom();
initHistory();
initPanel();
initPreview();
initMenu();
setZoom(3);
updateKeybindBar();
