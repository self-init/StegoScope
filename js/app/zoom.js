/**
 * Zoom module.
 * setZoom, adjustZoom + button listeners. References tileGrid from app.js.
 */
import { state } from './state.js';

const ZOOM_TILE_WIDTHS = [140, 180, 220, 300, 380];
const ZOOM_LABELS      = ['50%', '75%', '100%', '150%', '200%'];

export function setZoom(level) {
  state.zoomLevel = Math.max(1, Math.min(ZOOM_TILE_WIDTHS.length, level));
  const tileGrid = document.getElementById('tile-grid');
  const zoomLabel = document.getElementById('zoom-label');
  if (tileGrid) {
    tileGrid.style.gridTemplateColumns =
      `repeat(auto-fill, minmax(${ZOOM_TILE_WIDTHS[state.zoomLevel - 1]}px, 1fr))`;
  }
  if (zoomLabel) zoomLabel.textContent = ZOOM_LABELS[state.zoomLevel - 1];
}

export function adjustZoom(delta) { setZoom(state.zoomLevel + delta); }

export function initZoom() {
  const zoomInBtn  = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  zoomInBtn?.addEventListener('click',  () => adjustZoom(+1));
  zoomOutBtn?.addEventListener('click', () => adjustZoom(-1));
}
