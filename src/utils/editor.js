import { Orientation } from './dna.js'

export const EDITOR_ZOOM_LEVELS = [50, 75, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
export const EDITOR_ZOOM_LABELS = ['50bp', '75bp', '100bp', '200bp', '500bp', '1kbp', '2kbp', '5kbp', '10kbp', '20kbp', '50kbp', '100kbp']

/** Convert a fenced range to GenBank's 1-based inclusive coordinate notation. */
export function rangeToGenBank(range) {
  const baseRange = `${range.start + 1}..${range.end}`
  return range.orientation === Orientation.MINUS
    ? `complement(${baseRange})`
    : baseRange
}

/** Return the zoom selector options supported by both editor shells. */
export function getAvailableZooms(sequenceLength) {
  if (sequenceLength === 0) {
    return EDITOR_ZOOM_LEVELS.map((value, index) => ({ value, label: EDITOR_ZOOM_LABELS[index] }))
  }

  const options = []
  for (let index = 0; index < EDITOR_ZOOM_LEVELS.length && EDITOR_ZOOM_LEVELS[index] < sequenceLength; index++) {
    options.push({ value: EDITOR_ZOOM_LEVELS[index], label: EDITOR_ZOOM_LABELS[index] })
  }
  options.push({ value: sequenceLength, label: 'full' })
  return options
}

/** Measure the SVG probe and update the shared graphics metrics. */
export function measureEditorFont(element, graphics) {
  if (!element) return
  const bounds = element.getBBox()
  if (bounds.width > 0) graphics.setFontMetrics(bounds.width / 50, bounds.height)
}

/** Update graphics dimensions from the editor container. */
export function resizeEditorGraphics(element, graphics) {
  if (!element) return
  const bounds = element.getBoundingClientRect()
  graphics.setContainerSize(bounds.width, bounds.height)
}

/** Combine toolbar configuration items exposed by component refs. */
export function collectLayerConfigItems(...layers) {
  return layers.flatMap(layer => layer?.configItems ?? [])
}
