import { channelFilter }   from './channel.js';
import { elaFilter }        from './ela.js';
import { noiseFilter }      from './noise.js';
import { gradientFilter }   from './gradient.js';
import { hsvFilter }        from './hsv.js';
import { labFilter }        from './lab.js';
import { frequencyFilter }  from './frequency.js';
import { cloneFilter }      from './clone.js';
import { metadataFilter }   from './metadata.js';
import { bitplaneFilter }   from './bitplane.js';
import { bitplaneXorFilter } from './bitplane-xor.js';
import { pcaFilter }        from './pca.js';
import { waveletFilter }    from './wavelet.js';
import { histogramFilter }  from './histogram.js';
import { jpegGhostFilter }  from './jpeg-ghost.js';
import { thumbnailFilter }  from './thumbnail.js';
import { gpsFilter }        from './gps.js';
import { quantizationFilter } from './quantization.js';
import { stringsFilter }        from './strings.js';
import { autodetectFilter }     from './autodetect.js';
import { curvesFilter }         from './curves.js';
import { colormapFilter }       from './colormap.js';
import { entropyFilter }        from './entropy.js';
import { fftFilter }            from './fft.js';
import { dctFilter }            from './dct.js';
import { lsbExtractFilter }     from './lsb-extract.js';
import { chiSquareFilter }      from './chi-square.js';
import { embeddedFilter }       from './embedded.js';
import { paletteFilter }        from './palette.js';
import { byteHistogramFilter }  from './byte-histogram.js';

export const FILTERS = {
  channel:   channelFilter,
  ela:       elaFilter,
  noise:     noiseFilter,
  gradient:  gradientFilter,
  hsv:       hsvFilter,
  lab:       labFilter,
  frequency: frequencyFilter,
  clone:     cloneFilter,
  metadata:  metadataFilter,
  bitplane:  bitplaneFilter,
  'bitplane-xor': bitplaneXorFilter,
  pca:       pcaFilter,
  wavelet:   waveletFilter,
  histogram: histogramFilter,
  'jpeg-ghost': jpegGhostFilter,
  thumbnail: thumbnailFilter,
  gps:       gpsFilter,
  quantization: quantizationFilter,
  strings:   stringsFilter,
  autodetect: autodetectFilter,
  curves:         curvesFilter,
  colormap:       colormapFilter,
  entropy:        entropyFilter,
  fft:            fftFilter,
  dct:            dctFilter,
  'lsb-extract':  lsbExtractFilter,
  'chi-square':   chiSquareFilter,
  embedded:       embeddedFilter,
  palette:        paletteFilter,
  'byte-histogram': byteHistogramFilter,
};

/**
 * Run a filter, handling both sync and async (Promise-returning) apply functions.
 * Returns a Promise<ImageData|{text}|{entries}>.
 */
export async function runFilter(filterId, imageData, params, sourceCanvas, rawFile) {
  const filter = FILTERS[filterId];
  if (!filter) throw new Error(`Unknown filter: ${filterId}`);
  const result = filter.apply(imageData, params, sourceCanvas, rawFile);
  return result instanceof Promise ? result : Promise.resolve(result);
}

/**
 * Get params for a named preset of a filter.
 */
export function getPresetParams(filterId, presetName) {
  const filter = FILTERS[filterId];
  if (!filter) return {};
  const preset = filter.presets.find(p => p.name === presetName);
  return preset ? { ...preset.params } : { ...(filter.presets[0]?.params ?? {}) };
}
