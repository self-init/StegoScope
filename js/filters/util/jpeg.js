/**
 * JPEG round-trip utility — no DOM required.
 * Encodes ImageData → JPEG blob → decodes back to ImageData.
 * Works in both main thread (OffscreenCanvas) and Web Workers.
 */

/**
 * @param {ImageData} imageData
 * @param {number} quality  — JPEG quality 0–100
 * @returns {Promise<ImageData>} — compressed-then-decompressed ImageData
 */
export async function jpegRoundTrip(imageData, quality) {
  const { width: w, height: h } = imageData;

  // Encode: ImageData → OffscreenCanvas → JPEG blob
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: quality / 100 });

  // Decode: JPEG blob → ImageBitmap → OffscreenCanvas → ImageData
  const bitmap = await createImageBitmap(blob);
  const outCanvas = new OffscreenCanvas(w, h);
  const outCtx = outCanvas.getContext('2d');
  outCtx.drawImage(bitmap, 0, 0);
  const result = outCtx.getImageData(0, 0, w, h);
  bitmap.close();
  return result;
}
