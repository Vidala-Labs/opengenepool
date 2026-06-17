<script setup>
import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
import { GraphicsSpan } from '../composables/useGraphics.js'
import { Orientation } from '../utils/dna.js'
import { selectionMenuItems } from './menus/selectionMenuContributor.js'

const props = defineProps({
  /** Handle radius in pixels */
  handleRadius: {
    type: Number,
    default: 5
  },
  /** Alignment mode: null (normal), 'target', or 'query' */
  alignmentMode: {
    type: String,
    default: null,
    validator: (v) => v === null || v === 'target' || v === 'query'
  },
  /** Height of each alignment block (3 rows) */
  alignmentBlockHeight: {
    type: Number,
    default: 0
  },
  /** Top padding for alignment mode */
  alignmentTopPadding: {
    type: Number,
    default: 0
  },
  /** Line height for calculating query row offset */
  lineHeight: {
    type: Number,
    default: 0
  },
  /** Optional custom ranges to display instead of injected selection */
  ranges: {
    type: Array,
    default: null
  },
  /** Reverse coordinate map: original position -> aligned position (for alignment mode rendering) */
  reverseCoordinateMap: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['select', 'contextmenu', 'merge', 'mousedown', 'handle-contextmenu'])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')

// Selection is injected from parent (single source of truth)
const selection = inject('selection')

// Context-menu service + selection action handlers (provided by the editor).
// The contributor always fires and reads system state + target chain.
const contextMenu = inject('contextMenu', null)
const selectionMenuActions = inject('selectionMenuActions', null)
const selectionContributor = {
  id: `selection${props.alignmentMode ? ':' + props.alignmentMode : ''}`,
  getItems: (context) => selectionMenuItems(context, selectionMenuActions || {})
}
onMounted(() => contextMenu?.register(selectionContributor))
onUnmounted(() => contextMenu?.unregister(selectionContributor))

// Alignment mode: inject the positioning function and lines
const injectedGetAlignmentLineY = inject('getAlignmentLineY', null)
const injectedAlignmentLines = inject('alignmentLines', null)
const injectedLineAnnotationHeights = inject('lineAnnotationHeights', null)
const injectedAlignmentTopPadding = inject('alignmentTopPadding', 30)
// Position map for alignment mode: aligned position -> original position
const injectedPositionMap = inject('positionMap', null)

// Handle drag state
const draggedHandle = ref(null) // { rangeIndex, type: 'start'|'end' }
const dragLimits = ref({ low: 0, high: 0 })

// Pending drag for overlapping handles (direction-based selection)
const pendingDrag = ref(null) // { startX, touchPoint, handles: [{rangeIndex, type}, ...] }

// Helper to get Y position for a line (handles alignment mode)
function getLineYForSelection(lineIndex) {
  if (props.alignmentMode && injectedGetAlignmentLineY) {
    // Use the injected function which accounts for cumulative annotation heights
    const baseY = injectedGetAlignmentLineY(lineIndex)
    // Target row is at offset 0, query row is 2 lines down
    const rowOffset = props.alignmentMode === 'query' ? props.lineHeight * 2 : 0
    return baseY + rowOffset
  }
  return graphics.getLineY(lineIndex)
}

// Helper to get line index from Y position (inverse of getLineYForSelection)
function getLineIndexFromYForSelection(y) {
  if (props.alignmentMode && injectedGetAlignmentLineY && injectedAlignmentLines && injectedLineAnnotationHeights) {
    const numLines = injectedAlignmentLines.value?.length || 0
    if (numLines === 0) return 0

    const heights = injectedLineAnnotationHeights.value
    const padding = injectedAlignmentTopPadding
    const lh = props.lineHeight

    // Each row's capture zone:
    // top: baselineY - targetHeight - padding/2
    // bottom: baselineY + 3*lineHeight + queryHeight + padding/2
    for (let i = 0; i < numLines; i++) {
      const baselineY = injectedGetAlignmentLineY(i)
      const targetH = heights.target.get(i) || 0
      const queryH = heights.query.get(i) || 0

      const rowTop = baselineY - targetH - padding / 2
      const rowBottom = baselineY + 3 * lh + queryH + padding / 2

      if (y >= rowTop && y < rowBottom) {
        return i
      }
    }

    // If before first row, return 0; if after last row, return last
    const firstBaselineY = injectedGetAlignmentLineY(0)
    const firstTargetH = heights.target.get(0) || 0
    if (y < firstBaselineY - firstTargetH - padding / 2) return 0

    return numLines - 1
  }
  return graphics.pixelToLineIndex(y, editorState.lineCount.value)
}

// Check if we're in query mode (handles at bottom, tags below)
const isQueryMode = computed(() => props.alignmentMode === 'query')

// Convert a range from original coordinates to aligned coordinates
function convertRangeToAligned(range) {
  if (!props.alignmentMode || !props.reverseCoordinateMap) {
    return range
  }

  const map = props.reverseCoordinateMap
  const alignedStart = map[range.start]
  const alignedEnd = map[range.end - 1]

  // If positions can't be mapped (e.g. the range touches a gap boundary), fall
  // back to the original range. This is an expected edge case, not an error, so
  // it intentionally does not log.
  if (alignedStart === undefined || alignedEnd === undefined) {
    return range
  }

  // Create a new range-like object with aligned coordinates
  return {
    start: alignedStart,
    end: alignedEnd + 1, // Convert back to exclusive end
    orientation: range.orientation
  }
}

// Compute selection paths for rendering
const selectionPaths = computed(() => {
  // Use prop ranges if provided, otherwise use injected selection
  const domainValue = selection.domain.value
  const ranges = props.ranges ?? (domainValue?.ranges ?? [])
  if (ranges.length === 0) return []

  const paths = []
  const zoom = editorState.zoomLevel.value
  const m = graphics.metrics.value
  const lineHeight = graphics.lineHeight.value

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]

    // In alignment mode, convert original positions to aligned positions for rendering
    const rangeForRendering = props.alignmentMode ? convertRangeToAligned(range) : range

    const gSpan = new GraphicsSpan(rangeForRendering, zoom)

    if (gSpan.fragments.length === 0) continue

    const fragments = gSpan.fragments
    const firstFrag = fragments[0]
    const lastFrag = fragments[fragments.length - 1]

    // Alignment mode: generate separate rectangular paths per fragment
    if (props.alignmentMode && fragments.length > 1) {
      for (let f = 0; f < fragments.length; f++) {
        const frag = fragments[f]
        const isFirstFrag = f === 0
        const isLastFrag = f === fragments.length - 1

        // Calculate pixel positions for this fragment
        const fragX1 = m.lmargin + frag.start * m.charWidth
        const fragX2 = m.lmargin + frag.end * m.charWidth
        const fragY1 = getLineYForSelection(frag.line)
        const fragY2 = fragY1 + lineHeight

        // Simple rectangle for each fragment
        const fragPathD = `M ${fragX1},${fragY1} H ${fragX2} V ${fragY2} H ${fragX1} Z`

        // Handle positions for this fragment
        let handleStartX = null, handleStartY = null
        let handleEndX = null, handleEndY = null

        if (isFirstFrag) {
          // Start handle on first fragment
          handleStartX = fragX1
          handleStartY = isQueryMode.value ? fragY2 : fragY1
        }
        if (isLastFrag) {
          // End handle on last fragment
          handleEndX = fragX2
          handleEndY = isQueryMode.value ? fragY2 : fragY1
        }

        paths.push({
          index: i,
          path: fragPathD,
          cssClass: getCssClass(range),
          handleStart: handleStartX !== null ? { x: handleStartX, y: handleStartY } : null,
          handleEnd: handleEndX !== null ? { x: handleEndX, y: handleEndY } : null,
          range,
          isQuery: isQueryMode.value,
          isFirstFragment: isFirstFrag,
          fragmentIndex: f
        })
      }
      continue
    }

    // Normal mode (single fragment or non-alignment multi-line)
    // Calculate pixel positions
    const x1 = m.lmargin + firstFrag.start * m.charWidth
    const x2 = m.lmargin + lastFrag.end * m.charWidth

    // Get the extra height for annotations above each line (not used in alignment mode)
    const firstLineExtra = props.alignmentMode ? 0 : (graphics.lineExtraHeight.value.get(firstFrag.line) || 0)
    const lastLineExtra = props.alignmentMode ? 0 : (graphics.lineExtraHeight.value.get(lastFrag.line) || 0)
    const topMargin = props.alignmentMode ? 0 : (editorState.settings.value.linetopmargin || 0)

    // y1 is the top of the row
    const y1 = getLineYForSelection(firstFrag.line) - firstLineExtra - topMargin
    const y2 = getLineYForSelection(lastFrag.line) + lineHeight

    let pathD
    if (fragments.length === 1) {
      // Single line - simple rectangle
      pathD = `M ${x1},${y1} H ${x2} V ${y2} H ${x1} Z`
    } else {
      // Multi-line - wrap around path
      const rightEdge = m.lmargin + m.lineWidth
      const leftEdge = m.lmargin
      const startLineBottom = getLineYForSelection(firstFrag.line) + lineHeight
      const lastLineTop = getLineYForSelection(lastFrag.line) - lastLineExtra - topMargin

      pathD = `M ${x1},${y1} ` +
              `H ${rightEdge} ` +
              `V ${lastLineTop} ` +
              `H ${x2} ` +
              `V ${y2} ` +
              `H ${leftEdge} ` +
              `V ${startLineBottom} ` +
              `H ${x1} Z`
    }

    // Handle positions
    const handleStartX = x1
    const handleEndX = x2

    let handleStartY, handleEndY
    if (isQueryMode.value) {
      // Query mode: handles at the bottom of each line
      // Start handle at bottom of first line, end handle at bottom of last line
      handleStartY = getLineYForSelection(firstFrag.line) + lineHeight  // Bottom of first line
      handleEndY = y2    // Bottom of last line (same as selection bottom)
    } else {
      // Normal/target mode: handles at the top of each line
      handleStartY = y1  // Top of the selection (includes margin)
      handleEndY = getLineYForSelection(lastFrag.line) - lastLineExtra - topMargin  // Top of the last line's row
    }

    paths.push({
      index: i,
      path: pathD,
      cssClass: getCssClass(range),
      handleStart: { x: handleStartX, y: handleStartY },
      handleEnd: { x: handleEndX, y: handleEndY },
      range,
      isQuery: isQueryMode.value,
      isFirstFragment: true,
      fragmentIndex: 0
    })
  }

  return paths
})

// ============================================
// Click/Context Menu Items via elementsFromPoint
// ============================================

/**
 * Handle click for an element with data attributes.
 * Called by parent editor when routing clicks via elementsFromPoint.
 *
 * @param {DOMStringMap} dataset - The element's dataset (data-* attributes)
 * @param {MouseEvent} event - The click event
 * @returns {boolean} True if the click was handled
 */
function handleClickForElement(dataset, event) {
  if (dataset.layer !== 'selection') return false

  const rangeIndex = dataset.rangeIndex !== undefined ? parseInt(dataset.rangeIndex, 10) : undefined
  const handleType = dataset.handleType
  const domain = selection.domain.value

  if (rangeIndex === undefined || !domain?.ranges[rangeIndex]) return false

  // Handle clicks: do nothing special - drag is via mousedown
  if (handleType) {
    // Shift+click on handle shows context menu
    if (event.shiftKey) {
      handleHandleContextMenu(event, rangeIndex, handleType)
    }
    return true  // Handled - prevent other layers from processing
  }

  // Path clicks: do nothing special - selection already exists
  // Shift+click shows context menu
  if (event.shiftKey) {
    handlePathContextMenu(event, rangeIndex)
  }

  return true  // Handled - prevent other layers from processing
}

// Compute merge bubbles for touching range pairs
// Only show merge bubbles for injected selection, not custom ranges
const mergeBubbles = computed(() => {
  if (props.ranges) return []  // Disable merge for custom ranges
  if (!selection.isSelected.value || !selection.domain.value) return []

  const ranges = selection.domain.value.ranges
  if (ranges.length < 2) return []

  const bubbles = []
  const m = graphics.metrics.value
  const zoom = editorState.zoomLevel.value
  const topMargin = editorState.settings.value.linetopmargin || 0

  // Scan pairwise for touching ends
  for (let i = 0; i < ranges.length - 1; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      let touchPoint = null
      let startRange = null
      let endRange = null

      if (ranges[i].start === ranges[j].end) {
        // ranges[j] ends where ranges[i] starts
        touchPoint = ranges[i].start
        startRange = j
        endRange = i
      } else if (ranges[i].end === ranges[j].start) {
        // ranges[i] ends where ranges[j] starts
        touchPoint = ranges[i].end
        startRange = i
        endRange = j
      }

      if (touchPoint !== null) {
        // Calculate position for bubble
        const lineIndex = Math.floor(touchPoint / zoom)
        const linePos = touchPoint % zoom
        const x = m.lmargin + linePos * m.charWidth
        const lineExtra = graphics.lineExtraHeight.value.get(lineIndex) || 0
        const y = graphics.getLineY(lineIndex) - lineExtra - topMargin - 12  // Above the selection

        bubbles.push({
          x,
          y,
          startRangeIndex: startRange,
          endRangeIndex: endRange
        })
      }
    }
  }

  return bubbles
})

// Merge two touching ranges
function handleMerge(bubble) {
  const ranges = selection.domain.value.ranges
  const startRange = ranges[bubble.startRangeIndex]
  const endRange = ranges[bubble.endRangeIndex]

  // Use orientation from the longer range
  const newOrientation = startRange.length >= endRange.length
    ? startRange.orientation
    : endRange.orientation

  // Extend the start range to cover both
  startRange.end = endRange.end
  startRange.orientation = newOrientation

  // Remove the end range
  ranges.splice(bubble.endRangeIndex, 1)

  // Trigger reactivity
  selection.domain.value = selection.domain.value

  emit('merge', { ranges: selection.domain.value.ranges })
}

// CSS class based on orientation and range length
function getCssClass(range) {
  // Zero-width selections (cursors) are always black
  if (range.start === range.end) {
    return 'selection cursor'
  }
  switch (range.orientation) {
    case Orientation.PLUS: return 'selection plus'
    case Orientation.MINUS: return 'selection minus'
    default: return 'selection undirected'
  }
}

function getHandleCssClass(range) {
  // Zero-width selections (cursors) are always black
  if (range.start === range.end) {
    return 'sel_handle cursor'
  }
  switch (range.orientation) {
    case Orientation.PLUS: return 'sel_handle plus'
    case Orientation.MINUS: return 'sel_handle minus'
    default: return 'sel_handle undirected'
  }
}

// Generate a "post-it tab arrow" path - rounded rectangle on top, triangle pointing down
// x, y is the junction between the rectangle and triangle
function getTrianglePathDown(x, y, width = 10, height = 8) {
  const halfWidth = width / 2
  const radius = 2  // Corner radius for rounded top
  const rectHeight = width  // Square: height equals width

  // Start at top-left corner (after radius), go clockwise
  const top = y - rectHeight
  const left = x - halfWidth
  const right = x + halfWidth
  const bottom = y + height  // Triangle tip

  return `M ${left + radius},${top} ` +           // Start after top-left radius
         `H ${right - radius} ` +                  // Top edge
         `Q ${right},${top} ${right},${top + radius} ` +  // Top-right corner
         `V ${y} ` +                               // Right edge down to triangle junction
         `L ${x},${bottom} ` +                     // Right side of triangle to tip
         `L ${left},${y} ` +                       // Left side of triangle from tip
         `V ${top + radius} ` +                    // Left edge up to corner
         `Q ${left},${top} ${left + radius},${top} ` +  // Top-left corner
         `Z`
}

// Generate a "post-it tab arrow" path pointing UP - rounded rectangle on bottom, triangle pointing up
// x, y is the junction between the rectangle and triangle (at the top of the rectangle)
function getTrianglePathUp(x, y, width = 10, height = 8) {
  const halfWidth = width / 2
  const radius = 2  // Corner radius for rounded bottom
  const rectHeight = width  // Square: height equals width

  // Rectangle is below y, triangle points up from y
  const bottom = y + rectHeight
  const left = x - halfWidth
  const right = x + halfWidth
  const top = y - height  // Triangle tip (pointing up)

  return `M ${x},${top} ` +                        // Start at triangle tip
         `L ${right},${y} ` +                      // Right side of triangle
         `V ${bottom - radius} ` +                 // Right edge down to corner
         `Q ${right},${bottom} ${right - radius},${bottom} ` +  // Bottom-right corner
         `H ${left + radius} ` +                   // Bottom edge
         `Q ${left},${bottom} ${left},${bottom - radius} ` +  // Bottom-left corner
         `V ${y} ` +                               // Left edge up to triangle junction
         `L ${x},${top} ` +                        // Left side of triangle to tip
         `Z`
}

// Get the appropriate triangle path based on direction
function getTrianglePath(x, y, pointUp = false) {
  return pointUp ? getTrianglePathUp(x, y) : getTrianglePathDown(x, y)
}

// Handle dragging
function startHandleDrag(event, rangeIndex, handleType) {
  if (event.button !== 0) return // Left click only
  event.preventDefault()
  event.stopPropagation()

  const range = selection.domain.value.ranges[rangeIndex]
  const handlePos = handleType === 'start' ? range.start : range.end

  // Check for other handles at the same position (touching ranges)
  const ranges = selection.domain.value.ranges
  const overlappingHandles = [{ rangeIndex, type: handleType }]

  for (let i = 0; i < ranges.length; i++) {
    if (i === rangeIndex) continue
    const r = ranges[i]
    if (r.start === handlePos) {
      overlappingHandles.push({ rangeIndex: i, type: 'start' })
    }
    if (r.end === handlePos) {
      overlappingHandles.push({ rangeIndex: i, type: 'end' })
    }
  }

  if (overlappingHandles.length > 1) {
    // Multiple handles at same position - wait for direction
    pendingDrag.value = {
      startX: event.clientX,
      touchPoint: handlePos,
      handles: overlappingHandles
    }
    window.addEventListener('mousemove', handlePendingDragMove)
    window.addEventListener('mouseup', handlePendingDragEnd)
  } else {
    // Single handle - proceed normally
    beginDrag(rangeIndex, handleType)
  }
}

// Handle pending drag to determine direction for overlapping handles
function handlePendingDragMove(event) {
  if (!pendingDrag.value) return

  const deltaX = event.clientX - pendingDrag.value.startX
  const threshold = 3 // pixels before deciding direction

  if (Math.abs(deltaX) < threshold) return

  const draggingLeft = deltaX < 0
  const { handles, touchPoint } = pendingDrag.value
  const ranges = selection.domain.value.ranges

  let chosenHandle
  if (draggingLeft) {
    // Dragging left: use the end handle of the left range
    chosenHandle = handles.find(h => {
      const r = ranges[h.rangeIndex]
      return h.type === 'end' && r.end === touchPoint
    })
  } else {
    // Dragging right: use the start handle of the right range
    chosenHandle = handles.find(h => {
      const r = ranges[h.rangeIndex]
      return h.type === 'start' && r.start === touchPoint
    })
  }

  if (!chosenHandle) chosenHandle = handles[0]

  // Clean up pending state
  window.removeEventListener('mousemove', handlePendingDragMove)
  window.removeEventListener('mouseup', handlePendingDragEnd)
  pendingDrag.value = null

  // Begin actual drag and process this move
  beginDrag(chosenHandle.rangeIndex, chosenHandle.type)
  handleDragMove(event)
}

function handlePendingDragEnd() {
  window.removeEventListener('mousemove', handlePendingDragMove)
  window.removeEventListener('mouseup', handlePendingDragEnd)
  pendingDrag.value = null
}

// Begin the actual drag operation
function beginDrag(rangeIndex, handleType) {
  const range = selection.domain.value.ranges[rangeIndex]
  const seqLen = editorState.sequenceLength.value

  // The anchor is the opposite end - this stays fixed during drag
  const anchor = handleType === 'start' ? range.end : range.start

  // Remember the original orientation and whether we started on left or right of anchor
  const originalOrientation = range.orientation
  const startedLeftOfAnchor = (handleType === 'start') ? (range.start < anchor) : (range.end < anchor)
  const wasZeroWidth = range.start === range.end

  draggedHandle.value = { rangeIndex, type: handleType }

  // Calculate drag limits (constrained by other ranges and sequence bounds)
  let low = 0
  let high = seqLen

  // Constrain by other ranges (but allow crossing the anchor)
  const ranges = selection.domain.value.ranges
  for (let i = 0; i < ranges.length; i++) {
    if (i === rangeIndex) continue
    const r = ranges[i]

    // Find the closest boundary on each side of the anchor
    if (r.end <= anchor && r.end > low) {
      low = r.end
    }
    if (r.start >= anchor && r.start < high) {
      high = r.start
    }
  }

  dragLimits.value = { low, high, anchor, originalOrientation, startedLeftOfAnchor, wasZeroWidth }

  window.addEventListener('mousemove', handleDragMove)
  window.addEventListener('mouseup', handleDragEnd)
}

function handleDragMove(event) {
  if (!draggedHandle.value) return

  const svg = document.querySelector('.editor-svg')
  if (!svg) return

  const rect = svg.getBoundingClientRect()
  const y = event.clientY - rect.top
  const x = event.clientX - rect.left

  // Convert to sequence position (use alignment-aware helper for Y)
  const lineIndex = getLineIndexFromYForSelection(y)
  const linePos = graphics.pixelToLinePosition(x)
  let pos

  // In alignment mode, use positionMap to convert aligned position to original
  // This matches SequenceLayer's behavior, ensuring consistent coordinates
  if (props.alignmentMode && injectedPositionMap?.value) {
    const alignedPos = editorState.lineToPosition(lineIndex, linePos)
    const map = injectedPositionMap.value
    const clampedPos = Math.max(0, Math.min(alignedPos, map.length - 1))
    pos = map[clampedPos]

    // Handle gaps - find nearest non-gap position
    if (pos === null || pos === undefined) {
      // Search backwards for non-gap
      for (let i = clampedPos - 1; i >= 0; i--) {
        if (map[i] !== null && map[i] !== undefined) {
          pos = map[i] + 1
          break
        }
      }
      // If still null, search forwards
      if (pos === null || pos === undefined) {
        for (let i = clampedPos + 1; i < map.length; i++) {
          if (map[i] !== null && map[i] !== undefined) {
            pos = map[i]
            break
          }
        }
      }
    }
  } else {
    pos = editorState.lineToPosition(lineIndex, linePos)
  }

  // Clamp to limits
  pos = Math.max(dragLimits.value.low, Math.min(pos, dragLimits.value.high))

  // Update the range - always maintain start <= end
  const { rangeIndex } = draggedHandle.value
  const range = selection.domain.value.ranges[rangeIndex]
  const { anchor, originalOrientation, startedLeftOfAnchor, wasZeroWidth } = dragLimits.value

  // Set start and end based on position relative to anchor
  range.start = Math.min(anchor, pos)
  range.end = Math.max(anchor, pos)

  // Determine if we've crossed the anchor
  const nowLeftOfAnchor = pos < anchor
  const nowRightOfAnchor = pos > anchor

  // Zero-width means neutral orientation
  if (pos === anchor) {
    range.orientation = Orientation.NONE
  } else if (wasZeroWidth) {
    // Started from zero-width cursor: orientation based on drag direction
    if (nowRightOfAnchor) {
      range.orientation = Orientation.PLUS
    } else {
      range.orientation = Orientation.MINUS
    }
  } else {
    // Normal case: flip orientation only when crossing the anchor
    const crossed = (startedLeftOfAnchor && nowRightOfAnchor) || (!startedLeftOfAnchor && nowLeftOfAnchor)

    if (crossed) {
      // Crossed the anchor: flip orientation
      range.orientation = originalOrientation === Orientation.PLUS ? Orientation.MINUS : Orientation.PLUS
    } else {
      // Haven't crossed: keep original orientation
      range.orientation = originalOrientation
    }
  }

  // Trigger reactivity
  selection.domain.value = selection.domain.value
}

function handleDragEnd() {
  draggedHandle.value = null
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', handleDragEnd)

  // Emit select event
  if (selection.isSelected.value) {
    emit('select', {
      ranges: selection.domain.value.ranges
    })
  }
}

function handlePathMouseDown(event, rangeIndex) {
  // Ctrl+click should add a new range - emit event so parent can handle it
  if (event.ctrlKey) {
    emit('mousedown', { event, rangeIndex, range: selection.domain.value.ranges[rangeIndex] })
  }
  // Otherwise, do nothing - let the selection path capture the click
  // to prevent it from clearing/changing the selection
}

function handlePathContextMenu(event, rangeIndex) {
  event.preventDefault()
  emit('contextmenu', {
    event,
    rangeIndex,
    range: selection.domain.value.ranges[rangeIndex]
  })
}

function handleHandleContextMenu(event, rangeIndex, handleType) {
  event.preventDefault()
  event.stopPropagation()
  const range = selection.domain.value.ranges[rangeIndex]
  const isCursor = range.start === range.end
  emit('handle-contextmenu', {
    event,
    rangeIndex,
    range,
    handleType,  // 'start' or 'end'
    isCursor
  })
}

// Expose for parent component, click routing, and context menu integration
defineExpose({
  selection,
  handleClickForElement
})
</script>

<template>
  <g class="selection-layer">
    <!-- Selection paths -->
    <g v-for="sel in selectionPaths" :key="`sel-${sel.index}-${sel.fragmentIndex ?? 0}`">
      <!-- Selection fill path -->
      <path
        :d="sel.path"
        :class="sel.cssClass"
        data-layer="selection"
        :data-range-index="sel.index"
        @mousedown="handlePathMouseDown($event, sel.index)"
        @contextmenu="handlePathContextMenu($event, sel.index)"
      />

      <!-- Start handle - triangle pointing toward selection (only on first fragment) -->
      <path
        v-if="sel.handleStart"
        :d="getTrianglePath(sel.handleStart.x, sel.handleStart.y, sel.isQuery)"
        :class="getHandleCssClass(sel.range)"
        data-layer="selection"
        :data-range-index="sel.index"
        data-handle-type="start"
        @mousedown="startHandleDrag($event, sel.index, 'start')"
        @contextmenu.prevent="handleHandleContextMenu($event, sel.index, 'start')"
      />

      <!-- End handle - triangle pointing toward selection (only on last fragment) -->
      <path
        v-if="sel.handleEnd"
        :d="getTrianglePath(sel.handleEnd.x, sel.handleEnd.y, sel.isQuery)"
        :class="getHandleCssClass(sel.range)"
        data-layer="selection"
        :data-range-index="sel.index"
        data-handle-type="end"
        @mousedown="startHandleDrag($event, sel.index, 'end')"
        @contextmenu.prevent="handleHandleContextMenu($event, sel.index, 'end')"
      />

      <!-- Tag for multi-range selection (only on first fragment) -->
      <g
        v-if="sel.isFirstFragment && selectionPaths.filter(p => p.isFirstFragment).length > 1"
        :transform="`translate(${sel.handleStart?.x ?? 0}, ${sel.isQuery ? (sel.handleStart?.y ?? 0) + 25 : (sel.handleStart?.y ?? 0) - 15})`"
        class="sel_tag"
      >
        <rect
          x="-8"
          y="-8"
          width="16"
          height="16"
          rx="2"
          class="sel_tag_box"
        />
        <text
          x="0"
          y="0"
          dominant-baseline="middle"
          text-anchor="middle"
          class="sel_tag_text"
        >
          {{ sel.index + 1 }}
        </text>
      </g>
    </g>

    <!-- Merge bubbles for touching ranges -->
    <g
      v-for="(bubble, idx) in mergeBubbles"
      :key="`merge-${idx}`"
      :transform="`translate(${bubble.x}, ${bubble.y})`"
      class="merge_bubble"
      @click="handleMerge(bubble)"
    >
      <rect
        x="-24"
        y="-8"
        width="48"
        height="16"
        rx="2"
        class="merge_bubble_box"
      />
      <text
        x="0"
        y="0"
        dominant-baseline="middle"
        text-anchor="middle"
        class="merge_bubble_text"
      >
        merge?
      </text>
    </g>
  </g>
</template>

<style scoped>
.selection-layer {
  pointer-events: none;
}

/* Selection paths */
.selection {
  pointer-events: all;
  cursor: pointer;
}

.selection.plus {
  fill: rgba(0, 255, 0, 0.3);
  stroke: rgba(0, 128, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.selection.minus {
  fill: rgba(255, 0, 0, 0.3);
  stroke: rgba(255, 0, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.selection.undirected {
  fill: rgba(192, 192, 192, 0.3);
  stroke: rgba(64, 64, 64, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.selection.cursor {
  fill: rgba(0, 0, 0, 0.3);
  stroke: rgba(0, 0, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

/* Selection handles */
.sel_handle {
  pointer-events: all;
  cursor: col-resize;
  opacity: 0.8;
  transition: opacity 0.15s;
}

.sel_handle:hover {
  opacity: 1;
}

.sel_handle.plus {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(0, 128, 0, 1);
  stroke-width: 2px;
}

.sel_handle.minus {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(255, 0, 0, 1);
  stroke-width: 2px;
}

.sel_handle.undirected {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(64, 64, 64, 1);
  stroke-width: 2px;
}

.sel_handle.cursor {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(0, 0, 0, 1);
  stroke-width: 2px;
}

/* Selection tags */
.sel_tag {
  pointer-events: none;
}

.sel_tag_box {
  fill: white;
  stroke: black;
  stroke-width: 1px;
}

.sel_tag_text {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 10px;
  fill: black;
}

/* Merge bubbles */
.merge_bubble {
  pointer-events: all;
  cursor: pointer;
}

.merge_bubble_box {
  fill: #ffffcc;
  stroke: #666;
  stroke-width: 1px;
  transition: fill 0.15s;
}

.merge_bubble:hover .merge_bubble_box {
  fill: #ffff99;
}

.merge_bubble_text {
  font-family: Arial, sans-serif;
  font-size: 11px;
  fill: #333;
  pointer-events: none;
}
</style>
