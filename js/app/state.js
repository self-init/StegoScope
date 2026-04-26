/**
 * State module.
 * Single state object + helper accessors.
 * All mutable application state lives here.
 */
import { BUILTIN_TABS } from '../presets.js';

export const state = {
  rawFile: null,
  baseCanvas: null,
  baseImageData: null,
  baseImageDataChecksum: null,
  history: [],
  activeHistoryIdx: 0,
  currentTabIdx: 0,
  focusedTileIdx: -1,
  tiles: [],
  tileResultCache: new Map(),
  panelOpen: false,
  propertiesPanelOpen: true,
  historyPanelOpen: true,
  panelTileIdx: -1,
  panelParams: null,
  panelDirty: false,
  zoomLevel: 3,
};

export function resetForNewImage(file, canvas, imageData, checksum) {
  state.rawFile = file;
  state.baseCanvas = canvas;
  state.baseImageData = imageData;
  state.baseImageDataChecksum = checksum;
  state.history = [{ canvas, filterId: null, presetName: null, label: 'Original' }];
  state.activeHistoryIdx = 0;
  state.tileResultCache = new Map();
  state.currentTabIdx = 0;
  state.focusedTileIdx = -1;
  state.tiles = [];
  state.panelOpen = false;
  state.panelTileIdx = -1;
  state.panelParams = null;
  state.panelDirty = false;
}

export function setBaseImageData(imageData, checksum) {
  state.baseImageData = imageData;
  state.baseImageDataChecksum = checksum;
}

export function clearTileResultCache() {
  state.tileResultCache = new Map();
}

export function advanceHistoryEntry(canvas, filterId, presetName, label) {
  state.history = state.history.slice(0, state.activeHistoryIdx + 1);
  state.history.push({ canvas, filterId, presetName, label });
  state.activeHistoryIdx = state.history.length - 1;
}
