import { ref, computed } from 'vue'
import {
  positionToAngle as posToAngle,
  angleToPosition as angleToPos,
  mouseToPosition as mouseToPos,
  getRowRadius as calcRowRadius,
  polarToCartesian
} from '../utils/circular.js'

/**
 * Circular graphics composable for plasmid map rendering.
 *
 * Provides:
 * - Circle geometry (center, radius, viewBox)
 * - Coordinate conversion (position ↔ angle ↔ pixel)
 * - Annotation row stacking
 * - Tick mark generation
 *
 * @param {Object} editorState - Editor state composable
 * @param {Object} options - Configuration options
 * @param {Ref<number>} options.annotationRowCount - Number of annotation rows to accommodate
 * @returns {Object} Circular graphics API
 */
export function useCircularGraphics(editorState, options = {}) {
  const annotationRowCount = options.annotationRowCount || ref(0)

  // Origin offset - allows rotating the entire view so position 0 appears elsewhere
  // This is an angular offset in radians
  const originOffset = ref(0)

  // Zoom state - controls backbone radius scaling
  const zoomScale = ref(1.0)

  // Zoom limits
  const minBackboneRadius = 50

  // Extension radial space - tracks extra space needed by extensions (e.g., restriction labels)
  // Map<sourceId, pixels>
  const extensionRadialSpace = ref(new Map())

  // Annotation settings (fixed)
  const annotationHeight = ref(14)
  const annotationPadding = ref(4)       // Padding between annotation rows
  const annotationGap = ref(6)           // Gap between backbone and first annotation row
  const tickLength = ref(8)

  // Calculate space needed for annotations
  const annotationSpace = computed(() => {
    const rows = annotationRowCount.value || 0
    if (rows === 0) return 0
    return annotationGap.value + rows * annotationHeight.value + (rows - 1) * annotationPadding.value
  })

  // Calculate max radial space needed by any extension
  // Extensions are at the same radial layer, so we take the max (not sum)
  const totalExtensionRadialSpace = computed(() => {
    let max = 0
    for (const pixels of extensionRadialSpace.value.values()) {
      if (pixels > max) {
        max = pixels
      }
    }
    return max
  })

  // Fixed size for the circular view
  const viewBoxWidth = ref(500)
  const viewBoxHeight = ref(500)

  // Circle center (middle of viewBox)
  const centerX = computed(() => viewBoxWidth.value / 2)
  const centerY = computed(() => viewBoxHeight.value / 2)

  // Backbone radius - shrinks to accommodate annotation rows, scales with zoom
  // Base radius minus space needed for annotations on the outside
  const baseBackboneRadius = 180
  const backboneRadius = computed(() => {
    const base = Math.max(80, baseBackboneRadius - annotationSpace.value / 2)
    return base * zoomScale.value
  })

  // ViewBox string for SVG
  const viewBox = computed(() =>
    `0 0 ${viewBoxWidth.value} ${viewBoxHeight.value}`
  )

  // Max backbone radius - leave room for annotations, extensions, and margin
  const maxBackboneRadius = computed(() => {
    return (viewBoxWidth.value / 2) - annotationSpace.value - totalExtensionRadialSpace.value - 20
  })

  /**
   * Set zoom scale with clamping to stay within radius limits.
   * @param {number} scale - Desired zoom scale
   */
  function setZoom(scale) {
    const base = Math.max(80, baseBackboneRadius - annotationSpace.value / 2)
    const proposedRadius = base * scale

    if (proposedRadius < minBackboneRadius) {
      scale = minBackboneRadius / base
    } else if (proposedRadius > maxBackboneRadius.value) {
      scale = maxBackboneRadius.value / base
    }

    zoomScale.value = scale
  }

  /**
   * Convert sequence position to angle.
   * Includes origin offset so position 0 can appear at any angle.
   * @param {number} position
   * @returns {number} Angle in radians
   */
  function positionToAngle(position) {
    return posToAngle(position, editorState.sequenceLength.value) + originOffset.value
  }

  /**
   * Convert angle to sequence position.
   * Accounts for origin offset.
   * @param {number} angle - Angle in radians
   * @returns {number} Sequence position
   */
  function angleToPosition(angle) {
    return angleToPos(angle - originOffset.value, editorState.sequenceLength.value)
  }

  /**
   * Convert mouse coordinates to sequence position.
   * Accounts for origin offset.
   * @param {number} mouseX
   * @param {number} mouseY
   * @returns {number} Sequence position (integer)
   */
  function mouseToPosition(mouseX, mouseY) {
    // Get raw position without offset
    const rawPos = mouseToPos(
      mouseX,
      mouseY,
      centerX.value,
      centerY.value,
      editorState.sequenceLength.value
    )
    // Adjust for origin offset by converting the offset to a position delta
    const offsetPositions = (originOffset.value / (2 * Math.PI)) * editorState.sequenceLength.value
    let adjustedPos = rawPos - offsetPositions
    // Normalize to [0, seqLen)
    const seqLen = editorState.sequenceLength.value
    adjustedPos = ((adjustedPos % seqLen) + seqLen) % seqLen
    return Math.round(adjustedPos)
  }

  /**
   * Convert mouse coordinates to angle (for origin dragging).
   * @param {number} mouseX
   * @param {number} mouseY
   * @returns {number} Angle in radians
   */
  function mouseToAngle(mouseX, mouseY) {
    const dx = mouseX - centerX.value
    const dy = mouseY - centerY.value
    return Math.atan2(dy, dx)
  }

  /**
   * Set the origin offset angle.
   * @param {number} angle - New offset in radians
   */
  function setOriginOffset(angle) {
    originOffset.value = angle
  }

  /**
   * Get the radius for an annotation row.
   * Row 0 is closest to the backbone, higher rows are further out.
   * @param {number} rowIndex
   * @returns {number} Radius for this row
   */
  function getRowRadius(rowIndex) {
    // First row starts at backbone + gap + half annotation height
    // Subsequent rows add (annotationHeight + padding) for each row
    const baseOffset = backboneRadius.value + annotationGap.value + annotationHeight.value / 2
    return baseOffset + rowIndex * (annotationHeight.value + annotationPadding.value)
  }

  /**
   * Set the number of annotation rows (called after layout)
   */
  function setAnnotationRowCount(count) {
    if (annotationRowCount.value !== count) {
      annotationRowCount.value = count
    }
  }

  /**
   * Set extra radial space needed by an extension.
   * This affects the max zoom-out radius to keep content on screen.
   * @param {string} sourceId - Unique identifier for the extension
   * @param {number} pixels - Radial space in pixels (0 to clear)
   */
  function setExtensionRadialSpace(sourceId, pixels) {
    const newMap = new Map(extensionRadialSpace.value)
    if (pixels > 0) {
      newMap.set(sourceId, pixels)
    } else {
      newMap.delete(sourceId)
    }
    extensionRadialSpace.value = newMap

    // Re-apply zoom constraints if current zoom exceeds new max
    const base = Math.max(80, baseBackboneRadius - annotationSpace.value / 2)
    const currentRadius = base * zoomScale.value
    if (currentRadius > maxBackboneRadius.value) {
      setZoom(zoomScale.value)
    }
  }

  /**
   * Convert position and radius to Cartesian coordinates.
   * @param {number} position - Sequence position
   * @param {number} radius - Radius from center
   * @returns {{x: number, y: number}}
   */
  function positionToCartesian(position, radius) {
    const angle = positionToAngle(position)
    return polarToCartesian(centerX.value, centerY.value, radius, angle)
  }

  /**
   * Computed tick marks at regular intervals.
   */
  const tickMarks = computed(() => {
    const seqLen = editorState.sequenceLength.value
    if (!seqLen) return []

    // Determine tick interval based on sequence length
    let interval
    if (seqLen <= 1000) {
      interval = 100
    } else if (seqLen <= 5000) {
      interval = 500
    } else if (seqLen <= 20000) {
      interval = 1000
    } else if (seqLen <= 50000) {
      interval = 5000
    } else {
      interval = 10000
    }

    const ticks = []
    for (let pos = 0; pos < seqLen; pos += interval) {
      const angle = positionToAngle(pos)
      const innerPoint = polarToCartesian(
        centerX.value,
        centerY.value,
        backboneRadius.value - tickLength.value / 2,
        angle
      )
      const outerPoint = polarToCartesian(
        centerX.value,
        centerY.value,
        backboneRadius.value + tickLength.value / 2,
        angle
      )
      const labelPoint = polarToCartesian(
        centerX.value,
        centerY.value,
        backboneRadius.value - tickLength.value - 12,
        angle
      )

      // Format label
      let label
      if (pos === 0) {
        label = '0'
      } else if (pos >= 1000) {
        label = `${pos / 1000}k`
      } else {
        label = String(pos)
      }

      ticks.push({
        position: pos,
        angle,
        innerPoint,
        outerPoint,
        labelPoint,
        label,
        // Determine text anchor based on position on circle
        textAnchor: getTextAnchor(angle),
        dominantBaseline: getDominantBaseline(angle)
      })
    }

    return ticks
  })

  /**
   * Get text anchor based on angle (for tick labels).
   */
  function getTextAnchor(angle) {
    // Normalize angle to [0, 2π)
    let normalized = angle
    if (normalized < 0) normalized += 2 * Math.PI

    // Right side of circle: start
    // Left side: end
    // Top/bottom: middle
    if (normalized < Math.PI / 4 || normalized > 7 * Math.PI / 4) {
      return 'start' // right side
    } else if (normalized > 3 * Math.PI / 4 && normalized < 5 * Math.PI / 4) {
      return 'end' // left side
    }
    return 'middle'
  }

  /**
   * Get dominant baseline based on angle (for tick labels).
   */
  function getDominantBaseline(angle) {
    // Normalize angle to [0, 2π)
    let normalized = angle
    if (normalized < 0) normalized += 2 * Math.PI

    // Top: auto (text below)
    // Bottom: hanging (text above)
    if (normalized > Math.PI / 4 && normalized < 3 * Math.PI / 4) {
      return 'hanging' // bottom half
    } else if (normalized > 5 * Math.PI / 4 && normalized < 7 * Math.PI / 4) {
      return 'auto' // top half
    }
    return 'middle'
  }

  return {
    // Dimensions
    viewBoxWidth,
    viewBoxHeight,
    viewBox,

    // Circle geometry
    centerX,
    centerY,
    backboneRadius,

    // Zoom
    zoomScale,
    minBackboneRadius,
    maxBackboneRadius,
    setZoom,

    // Annotation settings
    annotationHeight,
    annotationPadding,
    annotationGap,
    tickLength,

    // Tick marks
    tickMarks,

    // Coordinate conversion
    positionToAngle,
    angleToPosition,
    mouseToPosition,
    mouseToAngle,
    positionToCartesian,

    // Origin offset
    originOffset,
    setOriginOffset,

    // Annotation stacking
    getRowRadius,
    setAnnotationRowCount,
    annotationRowCount,

    // Extension radial space (for zoom constraints)
    setExtensionRadialSpace,
    totalExtensionRadialSpace
  }
}
