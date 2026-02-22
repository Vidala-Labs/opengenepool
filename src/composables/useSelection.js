import { ref, computed, watch } from 'vue'
import { Range, Span, Orientation } from '../utils/dna.js'
import { GraphicsSpan } from './useGraphics.js'

/**
 * SelectionDomain holds multiple selection ranges.
 * Ported from the original plugin_selection.js Domain concept.
 */
export class SelectionDomain {
  /**
   * @param {string|Range[]|Span} spec - Domain specification (0-based fenced coordinates)
   */
  constructor(spec) {
    if (!spec) {
      this.ranges = []
    } else if (Array.isArray(spec)) {
      // Deep copy ranges to avoid mutating originals
      this.ranges = spec.map(r => new Range(r.start, r.end, r.orientation))
    } else if (spec instanceof Span) {
      // Deep copy ranges to avoid mutating originals
      this.ranges = spec.ranges.map(r => new Range(r.start, r.end, r.orientation))
    } else if (typeof spec === 'string') {
      const span = Span.parse(spec)
      this.ranges = span.ranges
    } else {
      this.ranges = []
    }
  }

  /**
   * Check if position is contained in any range.
   * @param {number} position
   * @returns {boolean}
   */
  contains(position) {
    return this.ranges.some(r => r.contains(position))
  }

  /**
   * Add a new range to the domain.
   * @param {Range} range
   */
  addRange(range) {
    this.ranges.push(range)
  }

  /**
   * Remove a range by index.
   * @param {number} index
   */
  removeRange(index) {
    this.ranges.splice(index, 1)
  }

  /**
   * Get the dominant orientation based on total length.
   * @returns {number}
   */
  get orientation() {
    let plusLength = 0
    let minusLength = 0

    for (const range of this.ranges) {
      if (range.orientation === Orientation.PLUS) {
        plusLength += range.length
      } else if (range.orientation === Orientation.MINUS) {
        minusLength += range.length
      }
    }

    return plusLength >= minusLength ? Orientation.PLUS : Orientation.MINUS
  }

  /**
   * Get total length of all ranges.
   * @returns {number}
   */
  get totalLength() {
    return this.ranges.reduce((sum, r) => sum + r.length, 0)
  }
}

/**
 * Selection composable for multi-range selection with draggable handles.
 * Ported from the original plugin_selection.js.
 *
 * @param {Object} editorState - Editor state composable
 * @param {Object} graphics - Graphics composable
 * @param {Object} eventBus - Event bus for plugin communication
 */
export function useSelection(editorState, graphics, eventBus) {
  // Selection state
  const isSelected = ref(false)
  const domain = ref(null)

  // Drag state
  const anchor = ref(0)
  const dragLowLimit = ref(0)
  const dragHighLimit = ref(0)
  const isDragging = ref(false)

  /**
   * Create a new selection at position.
   * @param {number} pos - Position to start selection
   * @param {boolean} extend - Whether to extend existing selection
   */
  function startSelection(pos, extend = false) {
    if (!isSelected.value || !extend) {
      // New selection
      unselect()
      domain.value = new SelectionDomain(`${pos}..${pos}`)
      isSelected.value = true
    } else if (domain.value.contains(pos)) {
      // Clicked inside existing selection, do nothing
      return
    } else {
      // Add new range
      domain.value.addRange(new Range(pos, pos, Orientation.NONE))
    }

    anchor.value = pos
    isDragging.value = true

    // Calculate drag limits based on other ranges
    dragLowLimit.value = 0
    dragHighLimit.value = editorState.sequenceLength.value

    const ranges = domain.value.ranges
    for (let i = 0; i < ranges.length - 1; i++) {
      const range = ranges[i]
      if (range.end <= pos && range.end > dragLowLimit.value) {
        dragLowLimit.value = range.end
      }
      if (range.start >= pos && range.start < dragHighLimit.value) {
        dragHighLimit.value = range.start
      }
    }
  }

  /**
   * Update selection during drag.
   * @param {number} pos - Current drag position
   */
  function updateSelection(pos) {
    if (!isDragging.value || !domain.value) return

    // Clamp to limits
    pos = Math.max(pos, dragLowLimit.value)
    pos = Math.min(pos, dragHighLimit.value)

    const range = domain.value.ranges[domain.value.ranges.length - 1]

    if (pos < anchor.value) {
      // Dragging backwards - minus strand
      range.start = pos
      range.end = anchor.value
      range.orientation = Orientation.MINUS
    } else {
      // Dragging forwards - plus strand
      range.start = anchor.value
      range.end = pos
      range.orientation = Orientation.PLUS
    }
  }

  /**
   * Finish selection drag.
   */
  function endSelection() {
    isDragging.value = false
  }

  /**
   * Select from a domain specification.
   * @param {string|SelectionDomain} spec
   */
  function select(spec) {
    unselect()

    if (spec instanceof SelectionDomain) {
      domain.value = spec
    } else {
      domain.value = new SelectionDomain(spec)
    }

    isSelected.value = domain.value.ranges.length > 0
  }

  /**
   * Clear the selection.
   */
  function unselect() {
    isSelected.value = false
    domain.value = null
    isDragging.value = false
  }

  /**
   * Select the entire sequence.
   */
  function selectAll() {
    select(`0..${editorState.sequenceLength.value}`)
  }

  /**
   * Flip the orientation of a range.
   * @param {number} index - Range index
   */
  function flip(index) {
    if (!domain.value || index >= domain.value.ranges.length) return

    const range = domain.value.ranges[index]
    range.orientation *= -1
  }

  /**
   * Set the orientation of a range.
   * @param {number} index - Range index
   * @param {number} orientation - New orientation
   */
  function setOrientation(index, orientation) {
    if (!domain.value || index >= domain.value.ranges.length) return

    domain.value.ranges[index].orientation = orientation
  }

  /**
   * Split a range at a position.
   * @param {number} pos - Position to split at
   */
  function splitRange(pos) {
    if (!domain.value) return

    for (let i = 0; i < domain.value.ranges.length; i++) {
      const range = domain.value.ranges[i]
      if (pos > range.start && pos < range.end) {
        const orientation = range.orientation

        if (orientation >= 0) {
          // Plus strand: first range is before split
          const newRange = new Range(range.start, pos, orientation)
          range.start = pos
          domain.value.ranges.splice(i, 0, newRange)
        } else {
          // Minus strand: second range is before split (reverse order)
          const newRange = new Range(pos, range.end, orientation)
          range.end = pos
          domain.value.ranges.splice(i + 1, 0, newRange)
        }
        return
      }
    }
  }

  /**
   * Delete a range from the domain.
   * @param {number} index - Range index
   */
  function deleteRange(index) {
    if (!domain.value || index >= domain.value.ranges.length) return

    domain.value.removeRange(index)

    if (domain.value.ranges.length === 0) {
      unselect()
    }
  }

  /**
   * Move a range to a new position in the order.
   * @param {number} fromIndex - Current index
   * @param {number} toIndex - Target index
   */
  function moveRange(fromIndex, toIndex) {
    if (!domain.value) return

    const ranges = domain.value.ranges
    if (fromIndex < 0 || fromIndex >= ranges.length) return
    if (toIndex < 0 || toIndex >= ranges.length) return

    const [range] = ranges.splice(fromIndex, 1)
    ranges.splice(toIndex, 0, range)
  }

  /**
   * Get the SVG path for a selection range on a specific line.
   * @param {number} rangeIndex - Range index
   * @returns {string} SVG path string
   */
  function getSelectionPath(rangeIndex) {
    if (!domain.value || rangeIndex >= domain.value.ranges.length) return ''

    const range = domain.value.ranges[rangeIndex]
    const zoom = editorState.zoomLevel.value
    const m = graphics.metrics.value

    // Convert range to line fragments
    const gSpan = new GraphicsSpan(range, zoom)

    if (gSpan.fragments.length === 0) return ''

    const fragments = gSpan.fragments

    // Calculate pixel positions
    const firstFrag = fragments[0]
    const lastFrag = fragments[fragments.length - 1]

    const x1 = m.lmargin + firstFrag.start * m.charWidth
    const x2 = m.lmargin + lastFrag.end * m.charWidth

    const lineHeight = graphics.lineHeight.value
    const linePadding = editorState.settings.value.linepadding

    // Simple case: single line
    if (fragments.length === 1) {
      const y1 = graphics.getLineY(firstFrag.line)
      const y2 = y1 + lineHeight

      return `M ${x1},${y1} H ${x2} V ${y2} H ${x1} Z`
    }

    // Multi-line: create a path that wraps around
    const rightEdge = m.lmargin + m.lineWidth
    const leftEdge = m.lmargin

    const startY = graphics.getLineY(firstFrag.line)
    const endY = graphics.getLineY(lastFrag.line) + lineHeight

    return `M ${x1},${startY} ` +
           `H ${rightEdge} ` +
           `V ${graphics.getLineY(lastFrag.line)} ` +
           `H ${x2} ` +
           `V ${endY} ` +
           `H ${leftEdge} ` +
           `V ${startY + lineHeight} ` +
           `H ${x1} Z`
  }

  /**
   * Get CSS class for a range based on orientation.
   * @param {number} rangeIndex
   * @returns {string}
   */
  function getRangeClass(rangeIndex) {
    if (!domain.value || rangeIndex >= domain.value.ranges.length) {
      return 'selection undirected'
    }

    const orientation = domain.value.ranges[rangeIndex].orientation
    const classes = ['selection minus', 'selection undirected', 'selection plus']
    return classes[orientation + 1]
  }

  /**
   * Check if two ranges overlap (touching edges don't count as overlap).
   * @param {Range} a
   * @param {Range} b
   * @returns {boolean}
   */
  function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end
  }

  /**
   * Merge a new range into the existing selection, combining any overlapping ranges.
   * The new range's orientation is applied to the merged result.
   * @param {Range} newRange
   */
  function mergeRangeIntoSelection(newRange) {
    const existingRanges = domain.value.ranges
    const overlappingIndices = []

    // Find all ranges that overlap with the new range
    for (let i = 0; i < existingRanges.length; i++) {
      if (rangesOverlap(existingRanges[i], newRange)) {
        overlappingIndices.push(i)
      }
    }

    if (overlappingIndices.length === 0) {
      // No overlap, just add the new range
      domain.value.addRange(newRange)
    } else {
      // Merge all overlapping ranges with the new range
      let mergedStart = newRange.start
      let mergedEnd = newRange.end
      const newOrientation = newRange.orientation

      // Expand bounds to include all overlapping ranges
      for (const idx of overlappingIndices) {
        const existing = existingRanges[idx]
        mergedStart = Math.min(mergedStart, existing.start)
        mergedEnd = Math.max(mergedEnd, existing.end)
      }

      // Remove overlapping ranges (in reverse order to preserve indices)
      for (let i = overlappingIndices.length - 1; i >= 0; i--) {
        existingRanges.splice(overlappingIndices[i], 1)
      }

      // Add the merged range with the new orientation
      domain.value.addRange(new Range(mergedStart, mergedEnd, newOrientation))
    }
  }

  /**
   * Extend the selection by adding ranges from a domain specification.
   * Overlapping ranges are merged, with the new range's orientation applied.
   * If no selection exists, creates a new one.
   * @param {string|SelectionDomain} spec
   */
  function extendSelection(spec) {
    const newDomain = spec instanceof SelectionDomain ? spec : new SelectionDomain(spec)

    if (!isSelected.value || !domain.value) {
      // No existing selection, just create new one
      select(spec)
    } else {
      // Merge each new range into existing selection
      for (const range of newDomain.ranges) {
        mergeRangeIntoSelection(range)
      }
    }
  }

  /**
   * Subtract one range from another, returning 0-2 ranges.
   * @param {Range} target - The range to subtract from
   * @param {Range} subtract - The range to subtract
   * @returns {Range[]} - Array of 0-2 remaining ranges
   */
  function subtractRangeFromRange(target, subtract) {
    // No overlap - return original
    if (subtract.end <= target.start || subtract.start >= target.end) {
      return [target]
    }

    const result = []

    // Left portion (before subtraction)
    if (subtract.start > target.start) {
      result.push(new Range(target.start, subtract.start, target.orientation))
    }

    // Right portion (after subtraction)
    if (subtract.end < target.end) {
      result.push(new Range(subtract.end, target.end, target.orientation))
    }

    return result
  }

  /**
   * Subtract a span from the current selection.
   * @param {Span} span - The span to subtract from the selection
   */
  function subtractSpan(span) {
    const currentDomain = domain.value
    if (!currentDomain || currentDomain.ranges.length === 0) return

    const newRanges = []

    for (const selRange of currentDomain.ranges) {
      let remainingRanges = [selRange]

      // Subtract each annotation range from this selection range
      for (const subRange of span.ranges) {
        const nextRemaining = []
        for (const r of remainingRanges) {
          nextRemaining.push(...subtractRangeFromRange(r, subRange))
        }
        remainingRanges = nextRemaining
      }

      newRanges.push(...remainingRanges)
    }

    if (newRanges.length === 0) {
      unselect()
    } else {
      domain.value = new SelectionDomain(newRanges)
    }
  }

  /**
   * Extend an existing range to include a new position.
   * Preserves the original orientation (doesn't flip based on direction).
   *
   * For single range: extends start or end to include position.
   * For multiple ranges:
   *   - If pos is before all ranges: extend leftmost range's start (linear only)
   *   - If pos is after all ranges: extend rightmost range's end (linear only)
   *   - If pos is between two ranges: merge those two ranges
   *
   * @param {number} pos - Position to extend to
   * @param {boolean} circular - If true, only merge gaps (no directional extend)
   * @returns {boolean} - True if operation was valid, false if preconditions not met
   */
  function extendToPosition(pos, circular = false) {
    if (!isSelected.value || !domain.value || domain.value.ranges.length === 0) {
      return false
    }

    const ranges = domain.value.ranges

    // Sort ranges by start position to find leftmost/rightmost
    const sortedIndices = ranges
      .map((r, i) => ({ start: r.start, end: r.end, index: i }))
      .sort((a, b) => a.start - b.start)

    const leftmost = sortedIndices[0]
    const rightmost = sortedIndices[sortedIndices.length - 1]

    // Check if pos is within any existing range
    for (const range of ranges) {
      if (pos >= range.start && pos <= range.end) {
        return true  // Already within a range, do nothing
      }
    }

    // Extend in a direction (linear mode, or circular with single range)
    if (!circular || ranges.length === 1) {
      // Case 1: pos is before all ranges - extend leftmost
      if (pos < leftmost.start) {
        ranges[leftmost.index].start = pos
        return true
      }

      // Case 2: pos is after all ranges - extend rightmost
      if (pos > rightmost.end) {
        ranges[rightmost.index].end = pos
        return true
      }
    }

    // Case 3: pos is between two ranges - find which pair and merge them
    for (let i = 0; i < sortedIndices.length - 1; i++) {
      const current = sortedIndices[i]
      const next = sortedIndices[i + 1]

      if (pos > current.end && pos < next.start) {
        // pos is between current and next - merge them
        const currentRange = ranges[current.index]
        const nextRange = ranges[next.index]

        // Expand current range to include next range
        currentRange.end = nextRange.end

        // Remove the next range
        ranges.splice(next.index, 1)

        return true
      }
    }

    // Case 4 (circular only): pos is in the "around the horn" gap
    // This is the gap between the rightmost range's end and leftmost range's start,
    // wrapping through the origin (0)
    if (circular && sortedIndices.length >= 2) {
      const leftmost = sortedIndices[0]
      const rightmost = sortedIndices[sortedIndices.length - 1]

      // Check if pos is in the wraparound gap: after rightmost.end OR before leftmost.start
      if (pos > rightmost.end || pos < leftmost.start) {
        // Merge rightmost and leftmost ranges
        const rightmostRange = ranges[rightmost.index]
        const leftmostRange = ranges[leftmost.index]

        // Extend rightmost to include leftmost
        rightmostRange.end = leftmostRange.end

        // Remove leftmost range
        ranges.splice(leftmost.index, 1)

        return true
      }
    }

    return true
  }

  // Event bus integration
  if (eventBus) {
    eventBus.on('startselect', (data) => {
      startSelection(data.pos, data.mode)
    })

    eventBus.on('select', (data) => {
      select(data.domain)
    })

    eventBus.on('extendselect', (data) => {
      extendSelection(data.domain)
    })

    eventBus.on('extendtoposition', (data) => {
      extendToPosition(data.pos)
    })

    eventBus.on('unselect', () => {
      unselect()
    })

    eventBus.on('selectall', () => {
      selectAll()
    })
  }

  return {
    // State
    isSelected,
    domain,
    isDragging,
    anchor,

    // Methods
    startSelection,
    updateSelection,
    endSelection,
    select,
    extendSelection,
    extendToPosition,
    unselect,
    selectAll,

    // Range operations
    flip,
    setOrientation,
    splitRange,
    deleteRange,
    moveRange,
    subtractSpan,

    // Graphics
    getSelectionPath,
    getRangeClass
  }
}
