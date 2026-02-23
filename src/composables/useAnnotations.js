import { ref, computed, watch } from 'vue'
import { Orientation } from '../utils/dna.js'
import { Annotation } from '../utils/annotation.js'

/**
 * Generate SVG path for an annotation arrow.
 * Ported from plugin_annotations.js lines 187-218.
 *
 * Plus strand: Arrow points right (at right edge)
 * Minus strand: Arrow points left (at left edge)
 * Undirected: Simple rectangle
 *
 * @param {Object} params
 * @param {number} params.left - Left x coordinate
 * @param {number} params.right - Right x coordinate
 * @param {number} params.height - Height of annotation
 * @param {number} params.blockWidth - Width of arrow point
 * @param {number} params.arrowEdge - Rounded edge offset
 * @param {number} params.orientation - Strand orientation
 * @returns {string} SVG path string
 */
export function generateArrowPath({ left, right, height, blockWidth, arrowEdge, orientation }) {
  const width = right - left
  const halfHeight = height / 2

  // For narrow annotations, use a rectangle
  if (width <= blockWidth * 1.5) {
    return `M ${left} ${-arrowEdge} ` +
           `H ${right} ` +
           `V ${-(height - arrowEdge)} ` +
           `H ${left} ` +
           `Z`
  }

  if (orientation === Orientation.PLUS) {
    // Plus strand: arrow pointing right
    // Path starts at arrow tip (right edge, middle)
    // Then draws to arrow base, down to edge, left to start, up to edge, to arrow base, close
    return `M ${right} ${-halfHeight} ` +
           `L ${right - blockWidth} 0 ` +
           `V ${-arrowEdge} ` +
           `H ${left} ` +
           `V ${-(height - arrowEdge)} ` +
           `H ${right - blockWidth} ` +
           `V ${-height} ` +
           `Z`
  } else if (orientation === Orientation.MINUS) {
    // Minus strand: arrow pointing left
    // Path starts at arrow tip (left edge, middle)
    return `M ${left} ${-halfHeight} ` +
           `L ${left + blockWidth} 0 ` +
           `V ${-arrowEdge} ` +
           `H ${right} ` +
           `V ${-(height - arrowEdge)} ` +
           `H ${left + blockWidth} ` +
           `V ${-height} ` +
           `Z`
  } else {
    // Undirected: simple rectangle
    return `M ${left} ${-arrowEdge} ` +
           `H ${right} ` +
           `V ${-(height - arrowEdge)} ` +
           `H ${left} ` +
           `Z`
  }
}

// Height reserved for translation display below CDS annotations
const TRANSLATION_HEIGHT = 18

/**
 * Annotation element for layout calculations.
 * Wraps a fragment with bounding box info for collision detection.
 */
export class AnnotationElement {
  constructor({ left, top, right, bottom, fragment, path, reserveTranslationSpace = false }) {
    this._left = left
    this._top = top
    this._right = right
    this._bottom = bottom
    this.fragment = fragment
    this.path = path
    this.deltaY = 0
    this.anchored = false  // annotations can be pushed up
    this.reserveTranslationSpace = reserveTranslationSpace  // whether this element reserves space for translation
  }

  get left() { return this._left }
  get top() { return this._top }
  get right() { return this._right }
  get bottom() { return this._bottom }
  get width() { return this._right - this._left }

  get transformedTop() { return this._top + this.deltaY }
  get transformedBottom() { return this._bottom + this.deltaY }

  applyTransform(deltaX, deltaY) {
    this.deltaY = deltaY
  }
}

/**
 * Annotations composable for rendering annotation arrows with collision detection.
 * Ported from the original plugin_annotations.js.
 *
 * @param {Object} editorState - Editor state composable
 * @param {Object} graphics - Graphics composable
 * @param {Object} eventBus - Event bus for plugin communication
 * @param {Object} options - Optional settings
 * @param {Ref<boolean>} options.showTranslation - When true, CDS annotations reserve extra height for translation
 */
export function useAnnotations(editorState, graphics, eventBus, options = {}) {
  // Annotation state
  const annotations = ref([])

  // Tooltip state
  const hoveredAnnotation = ref(null)
  const tooltipPosition = ref({ x: 0, y: 0 })

  // Settings
  const annotationHeight = 18  // Increased from 16 to give more room for text labels
  const blockWidth = 8
  const arrowEdge = 2
  const contentPadding = 2

  /**
   * Set the annotation list.
   * @param {Annotation[]} list
   */
  function setAnnotations(list) {
    annotations.value = list
  }

  /**
   * Check if two sequence ranges overlap (exclusive of touching edges).
   * @param {number} start1
   * @param {number} end1
   * @param {number} start2
   * @param {number} end2
   * @returns {boolean}
   */
  function rangesOverlap(start1, end1, start2, end2) {
    return start1 < end2 && end1 > start2
  }

  /**
   * Computed: Generate layout elements for all annotation fragments.
   * Groups by line and applies sequence-based collision detection.
   */
  const getElementsByLine = computed(() => {
    if (!editorState.zoomLevel.value) return new Map()

    const zoom = editorState.zoomLevel.value
    const m = graphics.metrics.value

    const byLine = new Map()

    // Generate elements for all annotations
    for (const annotation of annotations.value) {
      const fragments = annotation.toFragments(zoom)

      for (const frag of fragments) {
        // Calculate pixel positions
        const left = m.lmargin + frag.start * m.charWidth
        const right = m.lmargin + frag.end * m.charWidth

        // Determine orientation for this fragment
        // Only show arrow at the directional end
        let fragOrientation = Orientation.NONE
        if (frag.orientation === Orientation.PLUS && frag.isEnd) {
          fragOrientation = Orientation.PLUS
        } else if (frag.orientation === Orientation.MINUS && frag.isStart) {
          fragOrientation = Orientation.MINUS
        }

        // Generate path
        const path = generateArrowPath({
          left,
          right,
          height: annotationHeight,
          blockWidth,
          arrowEdge,
          orientation: fragOrientation
        })

        // Check if this is a CDS with translation enabled
        const isCDS = annotation.type?.toUpperCase() === 'CDS'
        const showTrans = options.showTranslation?.value ?? false
        const reserveTranslationSpace = isCDS && showTrans

        // Create element with bounding box
        // Annotations are positioned ABOVE the sequence line (negative y)
        // CDS annotations with translation reserve extra space below for the translation display
        const totalHeight = reserveTranslationSpace
          ? annotationHeight + TRANSLATION_HEIGHT
          : annotationHeight
        const elem = new AnnotationElement({
          left,
          top: -totalHeight,
          right,
          bottom: 0,
          fragment: frag,
          path,
          reserveTranslationSpace
        })

        // Add to line map
        if (!byLine.has(frag.line)) {
          byLine.set(frag.line, [])
        }
        byLine.get(frag.line).push(elem)
      }
    }

    // Compute global stacking priority for each annotation
    // Priority: CDS before non-CDS (CDS gets lower rows), then by total span width (widest first)
    const annotationPriority = new Map()
    for (const annotation of annotations.value) {
      const span = annotation.span
      if (!span || !span.ranges) continue
      // Total width across all ranges
      const totalWidth = span.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
      const isCDS = annotation.type?.toUpperCase() === 'CDS'
      annotationPriority.set(annotation.id, { isCDS, totalWidth })
    }

    // Apply sequence-based collision detection to each line
    for (const [line, elements] of byLine) {
      // Sort by global annotation priority:
      // 1. CDS before non-CDS (CDS placed first, gets lower rows)
      // 2. Within same type, widest first
      elements.sort((a, b) => {
        const priorityA = annotationPriority.get(a.fragment.annotation?.id) ?? { isCDS: false, totalWidth: 0 }
        const priorityB = annotationPriority.get(b.fragment.annotation?.id) ?? { isCDS: false, totalWidth: 0 }
        // CDS comes before non-CDS
        if (priorityA.isCDS !== priorityB.isCDS) {
          return priorityA.isCDS ? -1 : 1
        }
        // Within same type, wider comes first
        return priorityB.totalWidth - priorityA.totalWidth
      })

      // Track placed elements by their row (deltaY level)
      // Each row tracks: elements placed, and the max height needed for that row
      const rows = []  // Array of { elements: [{start, end}], height: number }

      for (const elem of elements) {
        const fragStart = elem.fragment.start
        const fragEnd = elem.fragment.end
        const annotationId = elem.fragment.annotation?.id

        // Height this element needs (including translation space if applicable)
        const elemHeight = elem.reserveTranslationSpace
          ? annotationHeight + TRANSLATION_HEIGHT
          : annotationHeight

        // Find the first row where this element doesn't overlap
        let placedRow = -1
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          const row = rows[rowIdx]
          let hasOverlap = false

          for (const placed of row.elements) {
            if (rangesOverlap(fragStart, fragEnd, placed.start, placed.end)) {
              hasOverlap = true
              break
            }
          }

          if (!hasOverlap) {
            placedRow = rowIdx
            break
          }
        }

        // If no existing row works, create a new one
        if (placedRow === -1) {
          placedRow = rows.length
          rows.push({ elements: [], height: annotationHeight })
        }

        // Place element in this row (include annotation ID for unique identification)
        rows[placedRow].elements.push({ start: fragStart, end: fragEnd, annotationId })
        // Update row height if this element needs more space
        rows[placedRow].height = Math.max(rows[placedRow].height, elemHeight)

        // Calculate deltaY based on cumulative height of rows below
        // Row 0 = deltaY 0, subsequent rows stack above based on actual row heights
        let deltaY = 0
        for (let i = 0; i < placedRow; i++) {
          deltaY -= rows[i].height + contentPadding
        }
        elem.deltaY = deltaY
      }

      // Second pass: recalculate deltaY now that all row heights are known
      // (in case earlier elements were placed before a tall element expanded the row)
      for (const elem of elements) {
        const annotationId = elem.fragment.annotation?.id

        // Find which row this element is in (match by annotation ID)
        let elemRow = -1
        for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
          for (const placed of rows[rowIdx].elements) {
            if (placed.annotationId === annotationId) {
              elemRow = rowIdx
              break
            }
          }
          if (elemRow !== -1) break
        }

        // Recalculate deltaY with final row heights
        let deltaY = 0
        for (let i = 0; i < elemRow; i++) {
          deltaY -= rows[i].height + contentPadding
        }
        elem.deltaY = deltaY
      }
    }

    // Report extra height needed per line to graphics system
    if (graphics.setLineExtraHeight) {
      // First, reset all lines that previously had extra height but no longer have annotations
      const currentExtraHeights = graphics.lineExtraHeight?.value
      if (currentExtraHeights) {
        for (const [line] of currentExtraHeights) {
          if (!byLine.has(line)) {
            graphics.setLineExtraHeight(line, 0, 'annotations')
          }
        }
      }

      // Then set extra heights for lines with annotations
      for (const [line, elements] of byLine) {
        // Find how far up annotations extend (most negative top + deltaY)
        let minTop = 0
        for (const elem of elements) {
          const effectiveTop = elem.top + elem.deltaY
          if (effectiveTop < minTop) {
            minTop = effectiveTop
          }
        }
        // Extra height is the absolute value of how far above y=0 they extend
        graphics.setLineExtraHeight(line, Math.abs(minTop), 'annotations')
      }
    }

    return byLine
  })

  /**
   * Show tooltip for an annotation.
   * @param {Annotation} annotation
   * @param {{x: number, y: number}} position
   */
  function showTooltip(annotation, position) {
    hoveredAnnotation.value = annotation
    tooltipPosition.value = position
  }

  /**
   * Hide the tooltip.
   */
  function hideTooltip() {
    hoveredAnnotation.value = null
  }

  /**
   * Handle annotation click.
   * @param {Annotation} annotation
   * @param {MouseEvent} event
   */
  function handleClick(annotation, event) {
    if (eventBus) {
      eventBus.emit('annotation-click', {
        annotation,
        event
      })

      // Shift-click extends the existing selection, regular click replaces it
      const eventType = event.shiftKey ? 'extendselect' : 'select'
      eventBus.emit(eventType, {
        domain: annotation.span.toString()
      })
    }
  }

  /**
   * Handle annotation right-click.
   * @param {Annotation} annotation
   * @param {MouseEvent} event
   */
  function handleContextMenu(annotation, event) {
    if (eventBus) {
      eventBus.emit('annotation-contextmenu', {
        annotation,
        event
      })
    }
  }

  /**
   * Find annotation at a sequence position.
   * @param {number} pos
   * @returns {Annotation|null}
   */
  function getAnnotationAtPosition(pos) {
    for (const annotation of annotations.value) {
      if (annotation.overlaps(pos, pos + 1)) {
        return annotation
      }
    }
    return null
  }

  /**
   * Get all annotations overlapping a range.
   * @param {number} start
   * @param {number} end
   * @returns {Annotation[]}
   */
  function getAnnotationsInRange(start, end) {
    return annotations.value.filter(ann => ann.overlaps(start, end))
  }

  // Event bus integration
  if (eventBus) {
    eventBus.on('zoomed', () => {
      // Elements will recompute automatically via computed
    })
  }

  return {
    // State
    annotations,
    hoveredAnnotation,
    tooltipPosition,

    // Computed
    getElementsByLine,

    // Methods
    setAnnotations,
    showTooltip,
    hideTooltip,
    handleClick,
    handleContextMenu,
    getAnnotationAtPosition,
    getAnnotationsInRange
  }
}
