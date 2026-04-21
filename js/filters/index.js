import { channelFilter }   from './channel.js';
import { elaFilter }        from './ela.js';
import { noiseFilter }      from './noise.js';
import { gradientFilter }   from './gradient.js';
import { hsvFilter }        from './hsv.js';
import { labFilter }        from './lab.js';
import { frequencyFilter }  from './frequency.js';
import { cloneFilter }      from './clone.js';
import { metadataFilter }   from './metadata.js';

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
