import { ref, computed, watch } from 'vue'
import { Orientation } from '../utils/dna.js'
import { getArrowArcPath, getTextArcPath } from '../utils/circular.js'
import { assignToRows } from '../utils/layout.js'

// Default annotation colors by type
const DEFAULT_COLORS = {
  gene: '#4CAF50',
  CDS: '#2196F3',
  promoter: '#FF9800',
  terminator: '#F44336',
  misc_feature: '#9E9E9E',
  rep_origin: '#9C27B0',
  origin: '#9C27B0',
  primer_bind: '#00BCD4',
  protein_bind: '#795548',
  regulatory: '#FFEB3B',
  source: '#B0BEC5',
  _default: '#607D8B'
}

/**
 * Get the total span length of an annotation.
 * @param {Annotation} annotation
 * @returns {number}
 */
function getSpanLength(annotation) {
  if (!annotation.span || !annotation.span.ranges) return 0
  return annotation.span.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}

/**
 * Circular annotations composable for rendering annotation arcs with collision detection.
 * Parallel structure to useAnnotations.js for linear view.
 *
 * @param {Object} editorState - Editor state composable
 * @param {Object} circularGraphics - Circular graphics composable
 * @param {Object} eventBus - Event bus for plugin communication
 * @param {Object} options - Optional settings
 * @param {Ref<Object>} options.annotationColors - Custom color map by annotation type
 */
export function useCircularAnnotations(editorState, circularGraphics, eventBus, options = {}) {
  // Annotation state
  const annotations = ref([])

  // Tooltip state
  const hoveredAnnotation = ref(null)
  const tooltipPosition = ref({ x: 0, y: 0 })

  /**
   * Set the annotation list.
   * @param {Annotation[]} list
   */
  function setAnnotations(list) {
    annotations.value = list
  }

  /**
   * Get color for an annotation type.
   * @param {string} type
   * @returns {string}
   */
  function getTypeColor(type) {
    const colors = options.annotationColors?.value || DEFAULT_COLORS
    return colors[type] || colors._default
  }

  /**
   * Computed: Row assignments for annotations (sequence-based collision detection).
   * This is separate from element rendering so we can report row count first.
   */
  const rowAssignments = computed(() => {
    const seqLen = editorState.sequenceLength.value
    if (!seqLen || annotations.value.length === 0) {
      return { assignments: new Map(), rowCount: 0 }
    }

    return assignToRows(annotations.value, {
      getRanges: annotation => annotation.span?.ranges,
      getId: annotation => annotation.id,
      // Sort by span length (widest first for greedy placement)
      sort: (a, b) => getSpanLength(b) - getSpanLength(a)
    })
  })

  // Report row count to graphics for sizing
  watch(() => rowAssignments.value.rowCount, (rowCount) => {
    circularGraphics.setAnnotationRowCount(rowCount)
  }, { immediate: true })

  /**
   * Computed: Generate layout elements for all annotations.
   * Parallel to getElementsByLine in useAnnotations.js.
   */
  const getElements = computed(() => {
    const seqLen = editorState.sequenceLength.value
    if (!seqLen || annotations.value.length === 0) return []

    const cx = circularGraphics.centerX.value
    const cy = circularGraphics.centerY.value
    const thickness = circularGraphics.annotationHeight.value
    const { assignments } = rowAssignments.value

    const elements = []

    for (const annotation of annotations.value) {
      const span = annotation.span
      if (!span || !span.ranges || span.ranges.length === 0) continue

      const placedRow = assignments.get(annotation)
      if (placedRow === undefined) continue

      // Calculate radius for this row
      const radius = circularGraphics.getRowRadius(placedRow)

      // Generate path for each range in the span
      for (const range of span.ranges) {
        // Determine arrow orientation
        let orientation = Orientation.NONE
        if (range.orientation === Orientation.PLUS) {
          orientation = Orientation.PLUS
        } else if (range.orientation === Orientation.MINUS) {
          orientation = Orientation.MINUS
        }

        // Get the origin offset for angle calculations
        const angleOffset = circularGraphics.originOffset.value

        // Generate path
        const path = getArrowArcPath(
          range.start,
          range.end,
          seqLen,
          cx,
          cy,
          radius,
          thickness,
          orientation,
          8,  // arrowLength
          angleOffset
        )

        if (!path) continue

        // Calculate label position (midpoint of arc)
        const midPos = (range.start + range.end) / 2
        const labelPoint = circularGraphics.positionToCartesian(midPos, radius)

        // Calculate label angle for rotation
        const labelAngle = circularGraphics.positionToAngle(midPos)
        // Convert to degrees, adjust so text is readable
        let rotationDeg = (labelAngle * 180 / Math.PI) + 90
        // Flip text on bottom half so it's not upside down
        const isBottomHalf = rotationDeg > 90 && rotationDeg < 270
        if (isBottomHalf) {
          rotationDeg += 180
        }

        // Generate text arc path for curved text
        const textPathId = `text-path-${annotation.id || elements.length}-${range.start}`
        const textArcPath = getTextArcPath(
          range.start,
          range.end,
          seqLen,
          cx,
          cy,
          radius,
          isBottomHalf,  // Reverse for bottom half so text reads correctly
          angleOffset
        )

        elements.push({
          annotation,
          range,
          path,
          row: placedRow,
          radius,
          color: getTypeColor(annotation.type),
          labelPoint,
          rotationDeg,
          caption: annotation.caption || '',
          textPathId,
          textArcPath,
          isBottomHalf
        })
      }
    }

    return elements
  })

  /**
   * Check if caption fits in the arc.
   * @param {Object} element
   * @returns {boolean}
   */
  function captionFits(element) {
    if (!element.caption) return false
    const seqLen = editorState.sequenceLength.value
    const arcLength = (element.range.end - element.range.start) / seqLen * 2 * Math.PI * element.radius
    const estimatedTextWidth = element.caption.length * 6 // ~6px per char at small font
    return estimatedTextWidth < arcLength - 10
  }

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
    getElements,
    rowAssignments,

    // Methods
    setAnnotations,
    getTypeColor,
    captionFits,
    showTooltip,
    hideTooltip,
    handleClick,
    handleContextMenu,
    getAnnotationAtPosition,
    getAnnotationsInRange
  }
}
