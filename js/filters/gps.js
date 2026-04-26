import { readBuffer, parseExif, gpsToDecimal } from './util/exif.js';

/**
 * GPS filter — decodes GPS EXIF sub-IFD, emits decimal lat/lon + OSM link.
 */
export const gpsFilter = {
  id: 'gps',
  name: 'GPS',
  meta: true,
  presets: [{ name: 'All', params: {} }],
  defaultPreset: 'All',
  paramSchema: [],

  async apply(imageData, _params, _srcCanvas, rawFile) {
    if (!rawFile) return { text: 'No file available.' };
    const buf = await readBuffer(rawFile);
    const parsed = parseExif(buf);
    if (parsed.error === 'not-jpeg') return { text: 'Not a JPEG.' };

    const t = parsed.tags;
    const lat = gpsToDecimal(t.GPSLatitude, t.GPSLatitudeRef);
    const lon = gpsToDecimal(t.GPSLongitude, t.GPSLongitudeRef);
    if (lat == null || lon == null) {
      return { entries: [{ label: 'GPS', detail: 'absent or unparseable', severity: 'info' }] };
    }

    const entries = [
      { label: 'Latitude',  detail: `${lat.toFixed(6)} deg ${t.GPSLatitudeRef || ''}`.trim() },
      { label: 'Longitude', detail: `${lon.toFixed(6)} deg ${t.GPSLongitudeRef || ''}`.trim() },
    ];
    if (typeof t.GPSAltitude === 'number') {
      entries.push({ label: 'Altitude', detail: `${t.GPSAltitude.toFixed(1)} m` });
    }
    if (t.GPSDateStamp) {
      entries.push({ label: 'Date', detail: String(t.GPSDateStamp) });
    }
    entries.push({
      label:  'OSM',
      detail: `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=16/${lat.toFixed(6)}/${lon.toFixed(6)}`,
    });
    return { entries };
  },
};
