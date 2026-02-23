import { ref, computed, watch } from 'vue'
import { Orientation } from '../utils/dna.js'

/**
 * A fragment represents a portion of a range on a single line.
 * @typedef {Object} Fragment
 * @property {number} line - Line index (0-based)
 * @property {number} start - Start position within the line (0-based)
 * @property {number} end - End position within the line (exclusive)
 * @property {number} orientation - Strand orientation (-1, 0, or 1)
 */

/**
 * GraphicsSpan converts a Range into line/position fragments for rendering.
 * When a range spans multiple lines, it's split into one fragment per line.
 */
export class GraphicsSpan {
  /**
   * @param {Range} range - The range to convert
   * @param {number} zoom - Bases per line (zoom level)
   */
  constructor(range, zoom) {
    this.range = range
    this.zoom = zoom
    this.fragments = this._computeFragments()
  }

  /**
   * Compute fragments by splitting the range across line boundaries.
   * @returns {Fragment[]}
   * @private
   */
  _computeFragments() {
    const { start, end, orientation } = this.range
    const zoom = this.zoom
    const fragments = []

    const startLine = Math.floor(start / zoom)
    const endLine = Math.floor((end - 1) / zoom)  // -1 because end is exclusive

    // Handle zero-length range
    if (start === end) {
      return [{
        line: startLine,
        start: start % zoom,
        end: end % zoom,
        orientation
      }]
    }

    for (let line = startLine; line <= endLine; line++) {
      const lineStart = line * zoom
      const lineEnd = (line + 1) * zoom

      // Fragment start: either the range start or the beginning of the line
      const fragStart = Math.max(start, lineStart) - lineStart

      // Fragment end: either the range end or the end of the line
      const fragEnd = Math.min(end, lineEnd) - lineStart

      fragments.push({
        line,
        start: fragStart,
        end: fragEnd,
        orientation
      })
    }

    return fragments
  }
}

/**
 * Shell wraps an element for collision detection during layout.
 * It caches the bounding box and tracks delta movement as the
 * element is pushed up to avoid collisions.
 */
export class Shell {
  /**
   * @param {Object} element - Element with bounding box properties
   */
  constructor(element) {
    // Cache the original bounding box
    this._left = element.left
    this._top = element.top
    this._right = element.right
    this._bottom = element.bottom

    // Delta movement (how much we've moved from original position)
    this.deltax = 0
    this.deltay = 0

    // Copy padding from element (defaults to 0)
    this.leftpadding = element.leftpadding || 0
    this.rightpadding = element.rightpadding || 0
    this.toppadding = element.toppadding || 0
    this.bottompadding = element.bottompadding || 0

    // Reference to the original element
    this.ref = element
  }

  // Getters apply delta and padding to the cached bounding box
  get left() { return this._left + this.deltax - this.leftpadding }
  get top() { return this._top + this.deltay - this.toppadding }
  get right() { return this._right + this.deltax + this.rightpadding }
  get bottom() { return this._bottom + this.deltay + this.bottompadding }

  /**
   * Check if this shell overlaps with another box.
   * Adjacent (touching) boxes are NOT considered overlapping.
   * @param {Object} box - Object with left, top, right, bottom properties
   * @returns {boolean}
   */
  overlaps(box) {
    return !(
      box.left >= this.right ||  // box is at or to the right
      box.right <= this.left ||  // box is at or to the left
      box.top >= this.bottom ||
      box.bottom <= this.top
    )
  }

  /**
   * Apply the accumulated delta transform to the element.
   */
  brand() {
    if (this.ref.applyTransform) {
      this.ref.applyTransform(this.deltax, this.deltay)
    }
  }
}

/**
 * Sort elements by width in descending order.
 * This enables a greedy layout algorithm that places wider elements first.
 * @param {Object[]} elements - Array of elements with width property
 * @returns {Object[]} New sorted array
 */
export function sortByWidth(elements) {
  return [...elements].sort((a, b) => b.width - a.width)
}

/**
 * Layout elements on a line using collision detection.
 * Anchored elements stay in place; unanchored elements are pushed up
 * when they collide with other elements.
 *
 * @param {Object[]} elements - Array of elements to layout
 * @param {number} contentPadding - Vertical padding between elements
 */
export function layoutLine(elements, contentPadding) {
  // Sort elements by width (widest first for greedy algorithm)
  const sorted = sortByWidth(elements)

  // Track placed boxes for collision detection
  const boxes = []

  // First pass: collect anchored element boxes
  for (const el of sorted) {
    if (el.anchored) {
      boxes.push({
        left: el.left,
        top: el.top,
        right: el.right,
        bottom: el.bottom
      })
    }
  }

  // Second pass: layout unanchored elements
  for (const el of sorted) {
    if (el.anchored) continue

    // Create a shell to track this element's movement
    const shell = new Shell(el)

    // Keep pushing up until no collisions
    let cleared = false
    while (!cleared) {
      cleared = true

      for (const box of boxes) {
        if (shell.overlaps(box)) {
          cleared = false
          // Move up: deltay += box.top - shell.bottom - padding
          // (negative because up is negative y)
          shell.deltay += box.top - shell.bottom - contentPadding
          break  // restart collision check with new position
        }
      }
    }

    // Add this element's final box to the list
    boxes.push({
      left: shell.left,
      top: shell.top,
      right: shell.right,
      bottom: shell.bottom
    })

    // Apply the transform to the element
    shell.brand()
  }
}

/**
 * Graphics metrics and layout calculations.
 * Replaces the jQuery graphics plugin's metric and layout systems.
 *
 * Metrics are computed based on:
 * - Container dimensions (fullWidth, fullHeight)
 * - Zoom level (bases per line)
 * - Font metrics (derived from a reference character width)
 */
export function useGraphics(editorState) {
  // Container dimensions (set by component on mount/resize)
  const containerWidth = ref(800)
  const containerHeight = ref(600)

  // Font metrics (measured from actual rendered text)
  const charWidth = ref(8)    // width of a single character in pixels
  const lineHeight = ref(16)  // height of a line of text in pixels

  // Settings from editor state
  const settings = computed(() => editorState.settings.value)
  const zoomLevel = computed(() => editorState.zoomLevel.value)

  // Computed metrics
  const metrics = computed(() => {
    const zoom = zoomLevel.value
    const lmargin = settings.value.lmargin
    const rmargin = settings.value.rmargin

    // Calculate the width available for sequence display
    const availableWidth = containerWidth.value - lmargin - rmargin

    // Calculate character width based on zoom level
    // If text would fit, use actual character width
    // Otherwise, compress to fit
    const textWidth = zoom * charWidth.value
    const useTextMode = textWidth <= availableWidth

    const effectiveCharWidth = useTextMode
      ? charWidth.value
      : availableWidth / zoom

    const lineWidth = zoom * effectiveCharWidth

    return {
      fullWidth: containerWidth.value,
      fullHeight: containerHeight.value,
      lineWidth,
      lineHeight: lineHeight.value,
      charWidth: effectiveCharWidth,
      blockWidth: charWidth.value,  // original char width for zoom-independent elements
      textMode: useTextMode,  // whether to show text or bars
      lmargin,
      rmargin
    }
  })

  // Convert x pixel position to sequence position within a line
  function pixelToLinePosition(x) {
    const m = metrics.value
    const pos = (x - m.lmargin) / m.charWidth
    const clamped = Math.max(0, Math.min(pos, zoomLevel.value))
    return Math.round(clamped)
  }

  // Convert sequence position to x pixel position
  function linePositionToPixel(pos) {
    const m = metrics.value
    return m.lmargin + pos * m.charWidth
  }

  // Track extra height contributions from multiple sources (annotations, restriction sites, etc.)
  // Map<lineIndex, Map<sourceId, height>>
  const lineExtraHeightContributions = ref(new Map())

  // Computed total extra height per line (sum of all contributions)
  const lineExtraHeight = computed(() => {
    const totals = new Map()
    for (const [lineIndex, contributions] of lineExtraHeightContributions.value) {
      const total = Array.from(contributions.values()).reduce((a, b) => a + b, 0)
      if (total > 0) {
        totals.set(lineIndex, total)
      }
    }
    return totals
  })

  // Set extra height for a line from a specific source
  function setLineExtraHeight(lineIndex, extraHeight, sourceId = 'annotations') {
    const newContributions = new Map(lineExtraHeightContributions.value)

    if (!newContributions.has(lineIndex)) {
      newContributions.set(lineIndex, new Map())
    }

    const lineContribs = new Map(newContributions.get(lineIndex))
    if (extraHeight > 0) {
      lineContribs.set(sourceId, extraHeight)
    } else {
      lineContribs.delete(sourceId)
    }

    if (lineContribs.size > 0) {
      newContributions.set(lineIndex, lineContribs)
    } else {
      newContributions.delete(lineIndex)
    }

    lineExtraHeightContributions.value = newContributions
  }

  // Get height contribution from a specific source for a line
  function getLineExtraHeightForSource(lineIndex, sourceId) {
    const contributions = lineExtraHeightContributions.value.get(lineIndex)
    if (!contributions) return 0
    return contributions.get(sourceId) || 0
  }

  // Extra space at top for tooltips (merge button, segment indices) on first line
  const tooltipMargin = 20

  // Get the y position of a line (top of the line content area)
  // This accounts for extra height needed by previous lines' annotations
  function getLineY(lineIndex) {
    const s = settings.value
    const topMargin = s.linetopmargin || 0
    let y = s.vmargin + tooltipMargin

    for (let i = 0; i < lineIndex; i++) {
      const extra = lineExtraHeight.value.get(i) || 0
      y += topMargin + extra + lineHeight.value + s.linepadding
    }

    // Add this line's top margin and extra height (space above for its annotations)
    const thisExtra = lineExtraHeight.value.get(lineIndex) || 0
    y += topMargin + thisExtra

    return y
  }

  // Get total height needed for all lines
  function getTotalHeight(lineCount) {
    if (lineCount === 0) return 0
    const s = settings.value
    const topMargin = s.linetopmargin || 0

    let total = s.vmargin + tooltipMargin
    for (let i = 0; i < lineCount; i++) {
      const extra = lineExtraHeight.value.get(i) || 0
      total += topMargin + extra + lineHeight.value
      if (i < lineCount - 1) total += s.linepadding
    }
    total += s.vmargin

    return total
  }

  // Find which line a y position corresponds to
  function pixelToLineIndex(y, lineCount) {
    const s = settings.value
    const topMargin = s.linetopmargin || 0

    // Walk through lines to find which one contains this y
    let currentY = s.vmargin + tooltipMargin
    for (let i = 0; i < lineCount; i++) {
      const extra = lineExtraHeight.value.get(i) || 0
      const lineTop = currentY + topMargin + extra
      const lineBottom = lineTop + lineHeight.value

      if (y < lineBottom) {
        return i
      }

      currentY = lineBottom + s.linepadding
    }

    return lineCount - 1
  }

  // Convert pixel coordinates to sequence position
  function pixelToSequencePosition(x, y, lineCount) {
    const lineIndex = pixelToLineIndex(y, lineCount)
    const linePos = pixelToLinePosition(x)
    return editorState.lineToPosition(lineIndex, linePos)
  }

  // Update container dimensions (called on mount/resize)
  function setContainerSize(width, height) {
    containerWidth.value = width
    containerHeight.value = height
  }

  // Update font metrics (called after measuring actual text)
  function setFontMetrics(width, height) {
    charWidth.value = width
    lineHeight.value = height
  }

  return {
    // Refs for external updates
    containerWidth,
    containerHeight,
    charWidth,
    lineHeight,
    lineExtraHeight,

    // Computed
    metrics,

    // Methods
    pixelToLinePosition,
    linePositionToPixel,
    getLineY,
    getTotalHeight,
    pixelToLineIndex,
    pixelToSequencePosition,
    setContainerSize,
    setFontMetrics,
    setLineExtraHeight,
    getLineExtraHeightForSource
  }
}
