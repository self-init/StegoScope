import { FILTERS, getPresetParams } from './filters/index.js';
import { BUILTIN_TABS } from './presets.js';
import { FilterWorkerPool } from './workers/pool.js';

const workerPool = new FilterWorkerPool();

// =====================================================================
// State
// =====================================================================
const state = {
  rawFile: null,
  baseCanvas: null,      // current base (HTMLCanvasElement)
  baseImageData: null,   // ImageData of current base
  history: [],           // [{ canvas, filterId, presetName, label }]
  activeHistoryIdx: 0,
  currentTabIdx: 0,
  focusedTileIdx: -1,
  tiles: [],
  panelOpen: false,           // tile content loaded in properties panel
  propertiesPanelOpen: true,  // properties panel drawer visible
  historyPanelOpen: true,     // history panel drawer visible
  panelTileIdx: -1,
  panelParams: null,
  panelDirty: false,
  zoomLevel: 3,
};

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
const menuDropdown          = document.getElementById('menu-dropdown');
const menubar               = document.getElementById('menubar');
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
// Zoom
// =====================================================================
const ZOOM_TILE_WIDTHS = [140, 180, 220, 300, 380];
const ZOOM_LABELS      = ['50%', '75%', '100%', '150%', '200%'];

function setZoom(level) {
  state.zoomLevel = Math.max(1, Math.min(ZOOM_TILE_WIDTHS.length, level));
  tileGrid.style.gridTemplateColumns =
    `repeat(auto-fill, minmax(${ZOOM_TILE_WIDTHS[state.zoomLevel - 1]}px, 1fr))`;
  zoomLabel.textContent = ZOOM_LABELS[state.zoomLevel - 1];
}

function adjustZoom(delta) { setZoom(state.zoomLevel + delta); }

zoomInBtn.addEventListener('click',  () => adjustZoom(+1));
zoomOutBtn.addEventListener('click', () => adjustZoom(-1));

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

    state.history = [{ canvas, filterId: null, presetName: null, label: 'Original' }];
    state.activeHistoryIdx = 0;

    dropZone.hidden   = true;
    tileGrid.hidden   = false;

    workerPool.start();

    renderTabs();
    renderHistory();
    renderGrid();
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
// Menu bar
// =====================================================================
let openMenu = null;

const FILE_MENU = [
  { label: 'Open Image…',          action: () => fileInput.click() },
  { sep: true },
  { label: 'Export Current Image', action: exportCurrentImage },
];

function getViewMenu() {
  return [
    { label: 'Preview',    action: showPreview,          keyhint: 'Space' },
    { sep: true },
    { label: 'History Panel',    checked: state.historyPanelOpen,    action: toggleHistoryPanel },
    { label: 'Properties Panel', checked: state.propertiesPanelOpen, action: togglePropertiesPanel },
    { sep: true },
    { label: 'Zoom In',    action: () => adjustZoom(+1), keyhint: 'Ctrl+=' },
    { label: 'Zoom Out',   action: () => adjustZoom(-1), keyhint: 'Ctrl+−' },
    { label: 'Reset Zoom', action: () => setZoom(3),     keyhint: 'Ctrl+0' },
  ];
}

function openMenuDropdown(name, items) {
  if (openMenu === name) { closeMenuDropdown(); return; }
  openMenu = name;

  menuDropdown.innerHTML = '';
  items.forEach(item => {
    if (item.sep) {
      const s = document.createElement('div');
      s.className = 'menu-item-sep';
      menuDropdown.appendChild(s);
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'menu-item';
    const checkSpan = `<span class="menu-check">${'checked' in item && item.checked ? '✓' : ''}</span>`;
    const left = `<span class="menu-left">${checkSpan}<span>${escHtml(item.label)}</span></span>`;
    if (item.keyhint) {
      btn.innerHTML = left + `<span class="menu-item-hint">${escHtml(item.keyhint)}</span>`;
    } else {
      btn.innerHTML = left;
    }
    btn.addEventListener('click', () => { closeMenuDropdown(); item.action(); });
    menuDropdown.appendChild(btn);
  });

  const triggerBtn = menubar.querySelector(`.menu-btn[data-menu="${name}"]`);
  if (triggerBtn) {
    menuDropdown.style.left = triggerBtn.getBoundingClientRect().left + 'px';
  }
  menuDropdown.classList.remove('hidden');
  menuDropdown.querySelector('.menu-item')?.focus();
}

function closeMenuDropdown() {
  openMenu = null;
  menuDropdown.classList.add('hidden');
}

document.querySelectorAll('.menu-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const name = btn.dataset.menu;
    if (name === 'file') openMenuDropdown('file', FILE_MENU);
    else if (name === 'view') openMenuDropdown('view', getViewMenu());
  });
  btn.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      closeMenuDropdown();
      if (state.baseImageData) focusTile(0);
    }
  });
});

document.addEventListener('click', e => {
  if (openMenu && !menubar.contains(e.target)) closeMenuDropdown();
});

menuDropdown.addEventListener('keydown', e => {
  const items = [...menuDropdown.querySelectorAll('.menu-item')];
  const cur   = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    items[(cur + 1) % items.length]?.focus();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    items[(cur - 1 + items.length) % items.length]?.focus();
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeMenuDropdown();
  }
});

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
    btn.addEventListener('click', () => { state.currentTabIdx = i; renderTabs(); renderGrid(); });
    tabBar.appendChild(btn);
  });
}

tabBar.addEventListener('keydown', e => {
  const tabs = [...tabBar.querySelectorAll('.tab-btn')];
  const cur  = tabs.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.baseImageData) focusTile(0);
  } else if (e.key === 'ArrowLeft' && cur > 0) {
    e.preventDefault(); tabs[cur - 1].focus();
  } else if (e.key === 'ArrowRight' && cur < tabs.length - 1) {
    e.preventDefault(); tabs[cur + 1].focus();
  }
});

// =====================================================================
// Grid rendering
// =====================================================================
function renderGrid() {
  if (!state.baseImageData) return;
  tileGrid.innerHTML = '';
  state.focusedTileIdx = -1;
  closePanelUI();

  const tab = BUILTIN_TABS[state.currentTabIdx];
  state.tiles = tab.tiles.map(({ filterId, presetName }) => ({
    filterId,
    presetName,
    params: getPresetParams(filterId, presetName),
    resultImageData: null,
    loading: false,
  }));

  updateMemoryInfo();

  state.tiles.forEach((tile, idx) => {
    const el = buildTileEl(tile, idx);
    tileGrid.appendChild(el);
    runTile(idx);
  });
}

function buildTileEl(tile, idx) {
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

    // Magnifying glass — opens text preview
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'tile-zoom-btn';
    zoomBtn.title = 'Preview (Space)';
    zoomBtn.innerHTML = `<svg width="19" height="19" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="6.5" cy="6.5" r="4.5"/>
      <line x1="10.5" y1="10.5" x2="14.5" y2="14.5"/>
    </svg>`;
    zoomBtn.addEventListener('click', e => {
      e.stopPropagation();
      focusTile(idx);
      showPreview();
    });
    wrap.appendChild(zoomBtn);
  } else {
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);

    // Magnifying glass — opens preview
    const zoomBtn = document.createElement('button');
    zoomBtn.className = 'tile-zoom-btn';
    zoomBtn.title = 'Preview (Space)';
    zoomBtn.innerHTML = `<svg width="19" height="19" viewBox="0 0 16 16" fill="none"
      stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
      <circle cx="6.5" cy="6.5" r="4.5"/>
      <line x1="10.5" y1="10.5" x2="14.5" y2="14.5"/>
    </svg>`;
    zoomBtn.addEventListener('click', e => {
      e.stopPropagation();
      focusTile(idx);
      showPreview();
    });
    wrap.appendChild(zoomBtn);
  }

  // Loading overlay
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'tile-loading';
  loadingDiv.appendChild(Object.assign(document.createElement('div'), { className: 'spinner' }));
  wrap.appendChild(loadingDiv);

  const footer = document.createElement('div');
  footer.className = 'tile-footer';
  footer.appendChild(Object.assign(document.createElement('span'), {
    className: 'tile-name', textContent: filter?.name ?? tile.filterId,
  }));
  footer.appendChild(Object.assign(document.createElement('span'), {
    className: 'tile-preset', textContent: tile.presetName,
  }));

  el.appendChild(wrap);
  el.appendChild(footer);

  // Click → open properties panel; double-click → promote directly
  wrap.style.cursor = 'pointer';
  wrap.addEventListener('click', e => { e.stopPropagation(); focusTile(idx); openPanel(idx); });
  wrap.addEventListener('dblclick', e => { e.stopPropagation(); focusTile(idx); promote(idx); });
  footer.addEventListener('click', e => { e.stopPropagation(); focusTile(idx); openPanel(idx); });
  footer.addEventListener('dblclick', e => { e.stopPropagation(); focusTile(idx); promote(idx); });

  el.addEventListener('focus',   () => { state.focusedTileIdx = idx; el.classList.add('focused'); });
  el.addEventListener('blur',    () => el.classList.remove('focused'));
  el.addEventListener('keydown', handleTileKeydown);

  return el;
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
    // Get rawFile as ArrayBuffer (File can't cross worker boundary)
    const rawFileBuffer = state.rawFile ? await state.rawFile.arrayBuffer() : null;

    const result = await workerPool.dispatch({
      filterId: tile.filterId,
      imageData: state.baseImageData,
      params: tile.params,
      rawFile: rawFileBuffer,
    });

    tile.resultImageData = result;
    tile.loading = false;
    updateMemoryInfo();
    updateExportBtn();

    if (filter?.meta) renderMetaTile(tileEl, result);
    else              renderImageTile(tileEl, result);
  } catch (err) {
    console.error(`Filter ${tile.filterId} failed:`, err);
    tile.loading = false;
    if (loadingDiv) loadingDiv.style.display = 'none';
  }
}

function renderImageTile(tileEl, imageData) {
  const canvas = tileEl.querySelector('canvas');
  if (!canvas) return;
  canvas.width  = imageData.width;
  canvas.height = imageData.height;
  canvas.getContext('2d').putImageData(imageData, 0, 0);
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

function renderMetaTile(tileEl, result) {
  const pre = tileEl.querySelector('.tile-meta-content');
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
  const loadingDiv = tileEl.querySelector('.tile-loading');
  if (loadingDiv) loadingDiv.style.display = 'none';
}

function buildMetaLine(label, detail, severity) {
  const line    = document.createElement('div');
  line.className = 'meta-line' + (severity ? ' sev-' + severity : '');
  const keySpan = Object.assign(document.createElement('span'), { className: 'meta-key', textContent: label });
  const valSpan = Object.assign(document.createElement('span'), { className: 'meta-val', textContent: detail });
  line.appendChild(keySpan);
  line.appendChild(document.createTextNode(': '));
  line.appendChild(valSpan);
  return line;
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateMemoryInfo() {
  if (!state.baseImageData) return;
  let bytes = state.baseImageData.width * state.baseImageData.height * 4;
  for (const tile of state.tiles) {
    if (tile.resultImageData instanceof ImageData) {
      bytes += tile.resultImageData.width * tile.resultImageData.height * 4;
    }
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
// Panel visibility helpers
// =====================================================================
function hidePropertiesPanel() {
  state.propertiesPanelOpen = false;
  state.panelOpen           = false;
  state.panelTileIdx        = -1;
  paramPanel.classList.add('panel-hidden');
  paramPanelBody.hidden        = false;
  paramPanelPlaceholder.hidden = true;
  presetBar.innerHTML  = '';
  paramCtrls.innerHTML = '';
  tileGrid.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel'));
  updateKeybindBar();
}

function showPropertiesPanel() {
  state.propertiesPanelOpen = true;
  paramPanel.classList.remove('panel-hidden');
  paramPanelPlaceholder.hidden = false;
  paramPanelBody.hidden        = true;
  updateKeybindBar();
}

function toggleHistoryPanel() {
  state.historyPanelOpen = !state.historyPanelOpen;
  historyPanel.classList.toggle('panel-collapsed', !state.historyPanelOpen);
}

function togglePropertiesPanel() {
  if (state.propertiesPanelOpen) hidePropertiesPanel();
  else showPropertiesPanel();
}

historyPanelClose.addEventListener('click', () => {
  state.historyPanelOpen = false;
  historyPanel.classList.add('panel-collapsed');
});

// Panel resize
function initPanelResize(handle, panel, direction) {
  let startX, startW;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = panel.getBoundingClientRect().width;
    handle.classList.add('dragging');
    document.body.style.cursor    = 'ew-resize';
    document.body.style.userSelect = 'none';

    const onMove = e => {
      const delta = e.clientX - startX;
      const newW  = Math.max(120, Math.min(480,
        direction === 'right' ? startW + delta : startW - delta,
      ));
      panel.style.width = newW + 'px';
    };
    const onUp = () => {
      handle.classList.remove('dragging');
      document.body.style.cursor    = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });
}

initPanelResize(
  historyPanel.querySelector('.panel-resize-handle'),
  historyPanel, 'right',
);
initPanelResize(
  paramPanel.querySelector('.panel-resize-handle'),
  paramPanel, 'left',
);

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
      renderGrid();
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
// Parameter Panel
// =====================================================================
function openPanel(idx) {
  if (!state.propertiesPanelOpen) return; // panel hidden — don't auto-open

  const tile = state.tiles[idx];
  if (!tile) return;
  const filter = FILTERS[tile.filterId];
  if (!filter) return;

  // Mark tile
  tileGrid.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel'));
  tileGrid.children[idx]?.classList.add('tile-active-panel');

  state.panelOpen    = true;
  state.panelTileIdx = idx;
  state.panelParams  = { ...tile.params };
  state.panelDirty   = false;

  paramPanelPlaceholder.hidden = true;
  paramPanelBody.hidden        = false;

  updateKeybindBar();
  paramTitle.textContent = filter.name;

  renderPresetBar(filter, tile.presetName);
  renderParamControls(filter, state.panelParams);
  updatePromoteBtn();
  updateExportBtn();
  promoteBtn.focus();
}

function closePanelUI() {
  tileGrid.querySelectorAll('.tile-active-panel').forEach(el => el.classList.remove('tile-active-panel'));
  state.panelOpen    = false;
  state.panelTileIdx = -1;
  presetBar.innerHTML  = '';
  paramCtrls.innerHTML = '';
  if (state.propertiesPanelOpen) {
    paramPanelPlaceholder.hidden = false;
    paramPanelBody.hidden        = true;
  }
  updateKeybindBar();
}

function focusFirstControl() {
  paramCtrls.querySelector('input[type="range"], select')?.focus();
}

function focusLastControl() {
  const all = [...paramCtrls.querySelectorAll('input[type="range"], select')];
  all.at(-1)?.focus();
}

paramClose.addEventListener('click', () => {
  const prev = state.panelTileIdx;
  hidePropertiesPanel();
  if (prev >= 0) focusTile(prev);
});

function renderPresetBar(filter, activePresetName) {
  presetBar.innerHTML = '';
  if (!filter.presets.length) return;

  const title = document.createElement('div');
  title.className = 'preset-bar-title';
  title.textContent = 'Presets';
  presetBar.appendChild(title);

  filter.presets.forEach(preset => {
    const pill = document.createElement('button');
    pill.className = 'preset-pill' + (preset.name === activePresetName ? ' active' : '');
    pill.textContent = preset.name;
    pill.addEventListener('click', () => {
      state.panelParams = { ...preset.params };
      renderPresetBar(filter, preset.name);
      renderParamControls(filter, state.panelParams);
      markDirty();
      if (state.panelDirty) applyParamPreview();
    });
    pill.addEventListener('keydown', e => {
      const pills = [...presetBar.querySelectorAll('.preset-pill')];
      const cur   = pills.indexOf(e.currentTarget);
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (cur > 0) pills[cur - 1].focus(); else promoteBtn.focus();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (cur < pills.length - 1) pills[cur + 1].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        promoteBtn.focus();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusFirstControl();
      }
    });
    presetBar.appendChild(pill);
  });
}

function renderParamControls(filter, params) {
  paramCtrls.innerHTML = '';
  if (!filter.paramSchema) return;

  filter.paramSchema.forEach(schema => {
    const group = document.createElement('div');
    group.className = 'param-group';

    if (schema.type === 'range') {
      const labelRow = document.createElement('div');
      labelRow.className = 'param-label';
      const labelText = document.createElement('span');
      labelText.textContent = schema.label;
      const valSpan = Object.assign(document.createElement('span'), {
        className: 'param-value',
        textContent: params[schema.id] ?? schema.min,
      });
      labelRow.appendChild(labelText);
      labelRow.appendChild(valSpan);

      const slider = document.createElement('input');
      slider.type      = 'range';
      slider.className = 'param-slider';
      slider.min       = schema.min;
      slider.max       = schema.max;
      slider.step      = schema.step ?? 1;
      slider.value     = params[schema.id] ?? schema.min;
      slider.dataset.id = schema.id;

      slider.addEventListener('input', () => {
        const v = parseFloat(slider.value);
        params[schema.id] = v;
        valSpan.textContent = v;
        markDirty();
        if (FILTERS[state.tiles[state.panelTileIdx]?.filterId]) applyParamPreview();
      });

      group.appendChild(labelRow);
      group.appendChild(slider);
    } else if (schema.type === 'select') {
      const labelEl = Object.assign(document.createElement('div'), {
        className: 'param-label', textContent: schema.label,
      });
      const sel = document.createElement('select');
      sel.className = 'param-select';
      schema.options?.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt.value;
        o.textContent = opt.label;
        if (opt.value === params[schema.id]) o.selected = true;
        sel.appendChild(o);
      });
      sel.addEventListener('change', () => {
        params[schema.id] = sel.value;
        markDirty();
        if (FILTERS[state.tiles[state.panelTileIdx]?.filterId]) applyParamPreview();
      });
      sel.addEventListener('keydown', e => {
        // Block left/right from cycling options
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
        // Enter opens the native dropdown
        if (e.key === 'Enter') { e.preventDefault(); sel.click(); }
      });
      group.appendChild(labelEl);
      group.appendChild(sel);
    }

    paramCtrls.appendChild(group);
  });
}

function markDirty() {
  state.panelDirty = true;
  updatePromoteBtn();
}

function updatePromoteBtn() {
  const filter = FILTERS[state.tiles[state.panelTileIdx]?.filterId];
  promoteBtn.disabled = !!filter?.meta;
  if (state.panelDirty) {
    applyBtn.hidden = false;
    promoteBtn.textContent = 'Apply & Promote';
  } else if (state.panelDirty) {
    applyBtn.hidden = true;
    promoteBtn.textContent = 'Apply & Promote';
  } else {
    applyBtn.hidden = true;
    promoteBtn.textContent = 'Promote';
  }
}

function updateExportBtn() {
  const tile = state.panelTileIdx >= 0 ? state.tiles[state.panelTileIdx] : null;
  exportTileBtn.disabled = !tile?.resultImageData;
}

// Live preview for fast filters
async function applyParamPreview() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile = state.tiles[idx];
  tile.params = { ...state.panelParams };
  await runTile(idx);
  state.panelDirty = true;
  updatePromoteBtn();
}

// Explicit apply for slow filters
applyBtn.addEventListener('click', async () => {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  state.tiles[idx].params = { ...state.panelParams };
  await runTile(idx);
  state.panelDirty = true;
  updatePromoteBtn();
});

// Export tile
exportTileBtn.addEventListener('click', () => {
  const tile   = state.tiles[state.panelTileIdx];
  const filter = FILTERS[tile?.filterId];
  if (!tile?.resultImageData) return;

  const safeName = `${filter?.name ?? tile.filterId}-${tile.presetName ?? ''}`
    .replace(/[^a-z0-9_-]/gi, '-').toLowerCase();

  if (filter?.meta) {
    const text = metaResultToText(tile.resultImageData);
    downloadBlob(new Blob([text], { type: 'text/plain' }), `${safeName}.txt`);
    return;
  }

  const tmp = document.createElement('canvas');
  tmp.width  = tile.resultImageData.width;
  tmp.height = tile.resultImageData.height;
  tmp.getContext('2d').putImageData(tile.resultImageData, 0, 0);
  tmp.toBlob(blob => downloadBlob(blob, `${safeName}.png`), 'image/png');
});

function metaResultToText(result) {
  if (result?.text) return result.text;
  if (Array.isArray(result?.entries)) {
    return result.entries.map(e => `${e.label ?? ''}: ${e.detail ?? ''}`).join('\n');
  }
  if (result?.entries) {
    return Object.entries(result.entries).map(([k, v]) => `${k}: ${v}`).join('\n');
  }
  return '';
}

// Arrow nav from Promote/Apply buttons into panel controls
[promoteBtn, applyBtn].forEach(btn => {
  btn.addEventListener('keydown', e => {
    if (!state.panelOpen) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const pills = [...presetBar.querySelectorAll('.preset-pill')];
      if (pills.length) pills[0].focus(); else focusFirstControl();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      focusLastControl();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (state.panelTileIdx >= 0) focusTile(state.panelTileIdx);
    }
  });
});

// Arrow nav within param controls
paramCtrls.addEventListener('keydown', e => {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const controls = [...paramCtrls.querySelectorAll('input[type="range"], select')];
  const cur = controls.indexOf(document.activeElement);
  if (cur === -1) return;
  if (e.key === 'ArrowUp' && cur === 0) {
    e.preventDefault();
    const pills = [...presetBar.querySelectorAll('.preset-pill')];
    (pills.at(-1) ?? promoteBtn)?.focus();
  } else if (e.key === 'ArrowDown' && cur === controls.length - 1) {
    e.preventDefault();
    promoteBtn.focus();
  }
});

// =====================================================================
// Promote
// =====================================================================
promoteBtn.addEventListener('click', () => promoteCurrentTile());

function promoteCurrentTile() {
  const idx = state.panelTileIdx;
  if (idx < 0) return;
  const tile   = state.tiles[idx];
  const filter = FILTERS[tile.filterId];
  if (state.panelDirty) {
    (async () => { tile.params = { ...state.panelParams }; await runTile(idx); promote(idx); })();
    return;
  }
  promote(idx);
}

function promote(idx) {
  const tile   = state.tiles[idx];
  const filter = FILTERS[tile.filterId];
  if (!tile?.resultImageData || filter?.meta) return;

  const newCanvas = document.createElement('canvas');
  newCanvas.width  = tile.resultImageData.width;
  newCanvas.height = tile.resultImageData.height;
  newCanvas.getContext('2d').putImageData(tile.resultImageData, 0, 0);

  state.baseCanvas    = newCanvas;
  state.baseImageData = tile.resultImageData;
  state.history       = state.history.slice(0, state.activeHistoryIdx + 1);
  state.history.push({
    canvas:     newCanvas,
    filterId:   tile.filterId,
    presetName: tile.presetName,
    label:      `${filter?.name ?? tile.filterId} — ${tile.presetName}`,
  });
  state.activeHistoryIdx = state.history.length - 1;

  closePanelUI();
  renderHistory();
  renderGrid();
}

// =====================================================================
// History + Undo / Redo
// =====================================================================
function undoHistory() {
  if (state.activeHistoryIdx > 0) restoreHistory(state.activeHistoryIdx - 1);
}

function redoHistory() {
  if (state.activeHistoryIdx < state.history.length - 1) restoreHistory(state.activeHistoryIdx + 1);
}

function updateUndoRedoButtons() {
  undoBtn.disabled = state.activeHistoryIdx <= 0;
  redoBtn.disabled = state.activeHistoryIdx >= state.history.length - 1;
}

undoBtn.addEventListener('click', undoHistory);
redoBtn.addEventListener('click', redoHistory);

function renderHistory() {
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
        focusTile(state.focusedTileIdx >= 0 ? state.focusedTileIdx : 0);
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

function restoreHistory(idx) {
  const entry = state.history[idx];
  if (!entry) return;
  state.activeHistoryIdx = idx;
  state.baseCanvas    = entry.canvas;
  state.baseImageData = entry.canvas.getContext('2d').getImageData(
    0, 0, entry.canvas.width, entry.canvas.height,
  );
  renderHistory();
  renderGrid();
}

// =====================================================================
// Large image preview (Space — hold or tap-toggle)
// =====================================================================
const preview = {
  visible:      false,
  holdMode:     false,
  holdTimer:    null,
  HOLD_MS:      180,
  savedTileIdx: -1,
};

function showPreview() {
  if (!state.baseImageData) return;

  const idx  = state.focusedTileIdx;
  const tile = idx >= 0 ? state.tiles[idx] : null;
  const filter = tile ? FILTERS[tile.filterId] : null;
  const useFiltered = tile && tile.resultImageData && !filter?.meta;

  // Restore focused tile after preview
  preview.savedTileIdx = idx;

  // Hide all preview panes by default
  previewSearchBar.hidden = true;
  previewCanvasWrap.hidden = true;
  previewTextOutput.hidden = true;
  previewSearchInput.value = '';
  previewRegexBtn.checked = false;
  previewCaseBtn.checked = false;

  if (filter?.meta && tile.resultImageData) {
    // Text output
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
    // Image output
    const imgData = useFiltered ? tile.resultImageData : state.baseImageData;
    const label   = useFiltered
      ? `${filter?.name} — ${tile.presetName}`
      : 'Original';
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
  updateKeybindBar();
}

function hidePreview() {
  previewOverlay.classList.add('hidden');
  preview.visible  = false;
  preview.holdMode = false;
  // Restore previously focused tile
  if (preview.savedTileIdx >= 0) focusTile(preview.savedTileIdx);
  preview.savedTileIdx = -1;
  updateKeybindBar();
}

previewClose.addEventListener('click', hidePreview);
previewOverlay.addEventListener('click', e => {
  if (e.target === previewOverlay || e.target.classList.contains('preview-canvas-wrap')) hidePreview();
});

// Search input handlers
previewSearchInput.addEventListener('input', () => applyPreviewSearch());
previewRegexBtn.addEventListener('change', () => applyPreviewSearch());
previewCaseBtn.addEventListener('change', () => applyPreviewSearch());

function applyPreviewSearch() {
  const text = previewTextOutput.textContent || '';
  const query = previewSearchInput.value;
  if (!query) {
    // Show all text, no highlights
    previewTextOutput.innerHTML = escHtml(text);
    return;
  }
  const regexMode = previewRegexBtn.checked;
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
    const needle = caseSensitive ? query : query.toLowerCase();
    const haystack = caseSensitive ? text : text.toLowerCase();
    const idx = haystack.indexOf(needle);
    if (idx === -1) {
      previewTextOutput.innerHTML = escHtml(text);
    } else {
      // Highlight all occurrences
      const regexAll = new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');
      previewTextOutput.innerHTML = text.replace(regexAll, m => `<mark>${escHtml(m)}</mark>`);
    }
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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
renderTabs();
setZoom(3);
updateKeybindBar();
