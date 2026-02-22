import { Span, Range, Orientation } from './dna.js'

/**
 * Annotation represents a feature on a DNA sequence.
 *
 * Annotations have:
 * - id: unique identifier
 * - caption: short name/label
 * - type: feature type (gene, promoter, terminator, etc.)
 * - span: location on the sequence (can span multiple ranges)
 * - attributes: additional key-value metadata (Quill.js convention)
 */
export class Annotation {
  constructor({ id, caption, type, span, attributes = {} }) {
    this.id = id
    this.caption = caption || ''
    this.type = type || 'misc_feature'
    this.attributes = attributes

    // Parse span if it's a string, otherwise use directly
    if (typeof span === 'string') {
      this.span = Span.parse(span)
    } else if (span instanceof Span) {
      this.span = span
    } else if (Array.isArray(span)) {
      // Array of ranges
      this.span = new Span(span.map(r =>
        r instanceof Range ? r : Range.parse(r)
      ))
    } else {
      this.span = new Span()
    }
  }

  /**
   * Get the orientation of this annotation
   * @returns {number} -1 (minus), 0 (none), or 1 (plus)
   */
  get orientation() {
    return this.span.orientation
  }

  /**
   * Get the total length of this annotation
   */
  get length() {
    return this.span.totalLength
  }

  /**
   * Get CSS class for styling
   */
  get cssClass() {
    return `annotation annotation-${this.type} annotation-${this.id}`
  }

  /**
   * Get the bounding range (min start to max end)
   */
  get bounds() {
    return this.span.bounds
  }

  /**
   * Check if this annotation overlaps a range
   */
  overlaps(start, end) {
    const bounds = this.bounds
    if (!bounds) return false
    return bounds.start < end && bounds.end > start
  }

  /**
   * Split annotation into fragments for line-based rendering.
   * Each fragment represents the part of the annotation visible on one line.
   *
   * @param {number} zoomLevel - bases per line
   * @returns {Array<AnnotationFragment>}
   */
  toFragments(zoomLevel) {
    const fragments = []

    for (let rangeIndex = 0; rangeIndex < this.span.ranges.length; rangeIndex++) {
      const range = this.span.ranges[rangeIndex]
      const startLine = Math.floor(range.start / zoomLevel)
      const endLine = Math.floor((range.end - 1) / zoomLevel)

      if (startLine === endLine) {
        // Single line fragment
        fragments.push(new AnnotationFragment({
          annotation: this,
          rangeIndex,
          line: startLine,
          start: range.start % zoomLevel,
          end: ((range.end - 1) % zoomLevel) + 1,
          orientation: range.orientation,
          isStart: true,
          isEnd: true,
          startIndefinite: range.startIndefinite,
          endIndefinite: range.endIndefinite
        }))
      } else {
        // Multi-line: create fragment for each line

        // First line
        fragments.push(new AnnotationFragment({
          annotation: this,
          rangeIndex,
          line: startLine,
          start: range.start % zoomLevel,
          end: zoomLevel,
          orientation: range.orientation,
          isStart: true,
          isEnd: false,
          startIndefinite: range.startIndefinite,
          endIndefinite: false
        }))

        // Middle lines (full width)
        for (let line = startLine + 1; line < endLine; line++) {
          fragments.push(new AnnotationFragment({
            annotation: this,
            rangeIndex,
            line,
            start: 0,
            end: zoomLevel,
            orientation: range.orientation,
            isStart: false,
            isEnd: false,
            startIndefinite: false,
            endIndefinite: false
          }))
        }

        // Last line
        fragments.push(new AnnotationFragment({
          annotation: this,
          rangeIndex,
          line: endLine,
          start: 0,
          end: ((range.end - 1) % zoomLevel) + 1,
          orientation: range.orientation,
          isStart: false,
          isEnd: true,
          startIndefinite: false,
          endIndefinite: range.endIndefinite
        }))
      }
    }

    return fragments
  }

  toString() {
    return `${this.caption} (${this.type}): ${this.span.toString()}`
  }
}

/**
 * AnnotationFragment represents a portion of an annotation on a single line.
 */
export class AnnotationFragment {
  constructor({ annotation, rangeIndex = 0, line, start, end, orientation, isStart, isEnd, startIndefinite = false, endIndefinite = false }) {
    this.annotation = annotation
    this.rangeIndex = rangeIndex  // Index of the range within the annotation's span
    this.line = line
    this.start = start  // position within line
    this.end = end      // position within line
    this.orientation = orientation
    this.isStart = isStart  // is this the start of the annotation?
    this.isEnd = isEnd      // is this the end of the annotation?
    this.startIndefinite = startIndefinite  // is the start boundary uncertain?
    this.endIndefinite = endIndefinite      // is the end boundary uncertain?
  }

  /**
   * Width of this fragment in bases
   */
  get width() {
    return this.end - this.start
  }

  /**
   * Should this fragment show an arrow?
   * Only show arrow at the actual end of the annotation.
   */
  get showArrow() {
    if (this.orientation === Orientation.NONE) return false
    if (this.orientation === Orientation.PLUS) return this.isEnd
    if (this.orientation === Orientation.MINUS) return this.isStart
    return false
  }

  /**
   * Reference to parent annotation's properties
   */
  get id() { return this.annotation.id }
  get caption() { return this.annotation.caption }
  get type() { return this.annotation.type }
  get cssClass() { return this.annotation.cssClass }
}

/**
 * Predefined annotation colors by type
 */
export const ANNOTATION_COLORS = {
  gene: '#4CAF50',        // green
  CDS: '#2196F3',         // blue
  promoter: '#FF9800',    // orange
  terminator: '#F44336',  // red
  misc_feature: '#9E9E9E', // gray
  rep_origin: '#9C27B0',  // purple
  primer_bind: '#00BCD4', // cyan
  protein_bind: '#795548', // brown
  regulatory: '#FFEB3B',  // yellow
  default: '#607D8B'      // blue-gray
}

/**
 * Get color for annotation type
 */
export function getAnnotationColor(type) {
  return ANNOTATION_COLORS[type] || ANNOTATION_COLORS.default
}
