<script setup>
import { computed, inject, ref } from 'vue'
import { Orientation } from '../utils/dna.js'
import { getArcPath, polarToCartesian } from '../utils/circular.js'

const props = defineProps({
  /** Selection thickness (visual width of the arc) */
  thickness: {
    type: Number,
    default: 20
  }
})

const emit = defineEmits(['select', 'contextmenu', 'merge', 'handle-contextmenu'])

// Inject from parent
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')
const selection = inject('selection')

// Tab handle dimensions (smaller version)
const tabWidth = 8
const tabHeight = 6  // Triangle height
const tabRectHeight = 8  // Square body height

/**
 * Compute selection arc paths for rendering.
 * Selection extends from backbone to just past the outermost annotation row.
 */
const selectionPaths = computed(() => {
  if (!selection.isSelected.value || !selection.domain.value) return []

  const seqLen = editorState.sequenceLength.value
  if (!seqLen) return []

  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value

  // Selection starts just inside backbone and extends past the outermost annotation
  // Use actual row count to find where annotations end, then add margin
  const rowCount = circularGraphics.annotationRowCount.value || 0
  const innerRadius = backboneRadius - 4
  const outerRadius = circularGraphics.getRowRadius(Math.max(0, rowCount - 1)) + circularGraphics.annotationHeight.value / 2 + 8
  const thickness = outerRadius - innerRadius
  const centerRadius = (innerRadius + outerRadius) / 2

  // Handle radius - junction of tab should be at the outer edge of selection
  const handleBaseRadius = outerRadius

  const paths = []

  for (let i = 0; i < selection.domain.value.ranges.length; i++) {
    const range = selection.domain.value.ranges[i]

    // Skip zero-length selections for arc display (but show cursor)
    if (range.start === range.end) {
      // Cursor - show as a line
      const angle = circularGraphics.positionToAngle(range.start)
      const innerPoint = polarToCartesian(cx, cy, innerRadius, angle)
      const outerPoint = polarToCartesian(cx, cy, outerRadius, angle)

      paths.push({
        index: i,
        type: 'cursor',
        path: `M ${innerPoint.x},${innerPoint.y} L ${outerPoint.x},${outerPoint.y}`,
        cssClass: 'selection cursor',
        range,
        // Handle positions and angles for tab handles
        startAngle: angle,
        endAngle: angle,
        handleRadius: handleBaseRadius
      })
      continue
    }

    // Generate arc path
    const angleOffset = circularGraphics.originOffset.value
    const path = getArcPath(
      range.start,
      range.end,
      seqLen,
      cx,
      cy,
      centerRadius,
      thickness,
      false,  // wrapAround
      angleOffset
    )

    if (!path) continue

    // Calculate handle angles and positions
    const startAngle = circularGraphics.positionToAngle(range.start)
    const endAngle = circularGraphics.positionToAngle(range.end)

    paths.push({
      index: i,
      type: 'selection',
      path,
      cssClass: getCssClass(range),
      range,
      startAngle,
      endAngle,
      handleRadius: outerRadius
    })
  }

  return paths
})

/**
 * Compute merge bubbles for touching range pairs.
 * When two ranges touch (one ends where another starts), show a merge control.
 */
const mergeBubbles = computed(() => {
  if (!selection.isSelected.value || !selection.domain.value) return []

  const ranges = selection.domain.value.ranges
  if (ranges.length < 2) return []

  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const rowCount = circularGraphics.annotationRowCount.value || 0
  const outerRadius = circularGraphics.getRowRadius(Math.max(0, rowCount - 1)) + circularGraphics.annotationHeight.value / 2 + 8

  // Position merge bubble outside the selection
  const bubbleRadius = outerRadius + 20

  const bubbles = []

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
        // Calculate position for bubble at the touch point angle
        const angle = circularGraphics.positionToAngle(touchPoint)
        const pos = polarToCartesian(cx, cy, bubbleRadius, angle)

        bubbles.push({
          x: pos.x,
          y: pos.y,
          startRangeIndex: startRange,
          endRangeIndex: endRange
        })
      }
    }
  }

  return bubbles
})

/**
 * Merge two touching ranges.
 */
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

/**
 * Generate post-it tab path at a given angle.
 * Rectangle on outside with triangle pointing inward (toward center/selection).
 * Matches the linear view's getTrianglePath style.
 */
function getTabPath(cx, cy, baseRadius, angle) {
  const halfWidth = tabWidth / 2
  const angleOffset = halfWidth / baseRadius  // Angular width of half the tab

  // The tab sits at baseRadius, with rectangle outside and triangle pointing in
  const outerRadius = baseRadius + tabRectHeight  // Top of rectangle (away from center)
  const junctionRadius = baseRadius  // Junction between rect and triangle
  const innerRadius = baseRadius - tabHeight  // Tip of triangle (toward center)

  // Rectangle corners
  const rectOuterLeft = polarToCartesian(cx, cy, outerRadius, angle - angleOffset)
  const rectOuterRight = polarToCartesian(cx, cy, outerRadius, angle + angleOffset)
  const rectInnerLeft = polarToCartesian(cx, cy, junctionRadius, angle - angleOffset)
  const rectInnerRight = polarToCartesian(cx, cy, junctionRadius, angle + angleOffset)

  // Triangle tip (pointing inward)
  const triangleTip = polarToCartesian(cx, cy, innerRadius, angle)

  // Path: outer edge of rectangle, down sides, triangle pointing in
  return `M ${rectOuterLeft.x},${rectOuterLeft.y} ` +
         `L ${rectOuterRight.x},${rectOuterRight.y} ` +
         `L ${rectInnerRight.x},${rectInnerRight.y} ` +
         `L ${triangleTip.x},${triangleTip.y} ` +
         `L ${rectInnerLeft.x},${rectInnerLeft.y} ` +
         `Z`
}

/**
 * Get CSS class based on orientation.
 */
function getCssClass(range) {
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
  if (range.start === range.end) {
    return 'sel_handle cursor'
  }
  switch (range.orientation) {
    case Orientation.PLUS: return 'sel_handle plus'
    case Orientation.MINUS: return 'sel_handle minus'
    default: return 'sel_handle undirected'
  }
}

// Handle dragging state
const draggedHandle = ref(null)
const dragLimits = ref({ low: 0, high: 0 })
const lastDragPos = ref(null)
const isWrapped = ref(false)
const wrappedSecondRangeIndex = ref(null)
const wrapDirection = ref(null)  // 'clockwise' or 'counterclockwise'

function startHandleDrag(event, rangeIndex, handleType) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()

  const range = selection.domain.value.ranges[rangeIndex]
  const seqLen = editorState.sequenceLength.value

  // Anchor is the opposite end
  const anchor = handleType === 'start' ? range.end : range.start
  const originalOrientation = range.orientation
  const startedLeftOfAnchor = (handleType === 'start') ? (range.start < anchor) : (range.end < anchor)
  const wasZeroWidth = range.start === range.end

  // Get initial position of the handle being dragged
  const initialPos = handleType === 'start' ? range.start : range.end

  draggedHandle.value = { rangeIndex, type: handleType }
  lastDragPos.value = initialPos
  isWrapped.value = false
  wrappedSecondRangeIndex.value = null
  wrapDirection.value = null

  // Calculate drag limits (only relevant for non-wrapped mode)
  let low = 0
  let high = seqLen

  const ranges = selection.domain.value.ranges
  for (let i = 0; i < ranges.length; i++) {
    if (i === rangeIndex) continue
    const r = ranges[i]
    if (r.end <= anchor && r.end > low) {
      low = r.end
    }
    if (r.start >= anchor && r.start < high) {
      high = r.start
    }
  }

  dragLimits.value = { low, high, anchor, originalOrientation, startedLeftOfAnchor, wasZeroWidth, seqLen }

  window.addEventListener('mousemove', handleDragMove)
  window.addEventListener('mouseup', handleDragEnd)
}

function handleDragMove(event) {
  if (!draggedHandle.value) return

  const svg = document.querySelector('.circular-view')
  if (!svg) return

  const rect = svg.getBoundingClientRect()
  const vbWidth = circularGraphics.viewBoxWidth.value
  const vbHeight = circularGraphics.viewBoxHeight.value

  // Match CircularView's coordinate calculation for preserveAspectRatio="xMidYMid meet"
  const scaleX = vbWidth / rect.width
  const scaleY = vbHeight / rect.height
  const scale = Math.max(scaleX, scaleY)

  const renderedWidth = vbWidth / scale
  const renderedHeight = vbHeight / scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2

  const x = (event.clientX - rect.left - offsetX) * scale
  const y = (event.clientY - rect.top - offsetY) * scale

  let pos = circularGraphics.mouseToPosition(x, y)

  const { rangeIndex } = draggedHandle.value
  const { anchor, originalOrientation, startedLeftOfAnchor, wasZeroWidth, seqLen } = dragLimits.value

  // Detect origin crossing: if position jumps by more than half the sequence
  if (lastDragPos.value !== null) {
    const delta = pos - lastDragPos.value
    if (Math.abs(delta) > seqLen / 2) {
      // We crossed the origin - toggle wrapped state
      isWrapped.value = !isWrapped.value

      if (isWrapped.value) {
        // Create second range for the wrap
        // Determine direction: if delta is negative but large, we went clockwise past origin
        // if delta is positive but large, we went counter-clockwise past origin
        const wentClockwise = delta < 0

        if (wentClockwise) {
          // Selection goes from anchor clockwise past origin to pos
          // Creates: high range (anchor..seqLen) + low range (0..pos)
          wrapDirection.value = 'clockwise'
          const ranges = selection.domain.value.ranges
          const primaryRange = ranges[rangeIndex]

          const highRange = { start: anchor, end: seqLen, orientation: originalOrientation }
          const lowRange = { start: 0, end: pos, orientation: originalOrientation }

          // For cut/paste ordering:
          // - FORWARD reads high→origin→low, so high range should be first
          // - REVERSE reads low→origin→high, so low range should be first
          if (originalOrientation === Orientation.MINUS) {
            // Reverse: low range first, high range second
            primaryRange.start = lowRange.start
            primaryRange.end = lowRange.end
            primaryRange.orientation = originalOrientation
            // Insert adjacent to partner range, not at end
            ranges.splice(rangeIndex + 1, 0, highRange)
          } else {
            // Forward (or none): high range first, low range second
            primaryRange.start = highRange.start
            primaryRange.end = highRange.end
            primaryRange.orientation = originalOrientation
            // Insert adjacent to partner range, not at end
            ranges.splice(rangeIndex + 1, 0, lowRange)
          }
          wrappedSecondRangeIndex.value = rangeIndex + 1
        } else {
          // Selection goes from anchor counter-clockwise past origin to pos
          // Creates: low range (0..anchor) + high range (pos..seqLen)
          wrapDirection.value = 'counterclockwise'
          const ranges = selection.domain.value.ranges
          const primaryRange = ranges[rangeIndex]

          const lowRange = { start: 0, end: anchor, orientation: originalOrientation }
          const highRange = { start: pos, end: seqLen, orientation: originalOrientation }

          // For cut/paste ordering:
          // - FORWARD reads high→origin→low, so high range should be first
          // - REVERSE reads low→origin→high, so low range should be first
          if (originalOrientation === Orientation.MINUS) {
            // Reverse: low range first, high range second
            primaryRange.start = lowRange.start
            primaryRange.end = lowRange.end
            primaryRange.orientation = originalOrientation
            // Insert adjacent to partner range, not at end
            ranges.splice(rangeIndex + 1, 0, highRange)
          } else {
            // Forward (or none): high range first, low range second
            primaryRange.start = highRange.start
            primaryRange.end = highRange.end
            primaryRange.orientation = originalOrientation
            // Insert adjacent to partner range, not at end
            ranges.splice(rangeIndex + 1, 0, lowRange)
          }
          wrappedSecondRangeIndex.value = rangeIndex + 1
        }
      } else {
        // Unwrap: remove the second range and go back to single range
        if (wrappedSecondRangeIndex.value !== null) {
          const ranges = selection.domain.value.ranges
          ranges.splice(wrappedSecondRangeIndex.value, 1)
          wrappedSecondRangeIndex.value = null
          wrapDirection.value = null
        }
      }
    }
  }

  lastDragPos.value = pos

  // Update range(s) based on wrapped state
  const ranges = selection.domain.value.ranges
  const primaryRange = ranges[rangeIndex]

  if (isWrapped.value && wrappedSecondRangeIndex.value !== null) {
    // Update wrapped ranges
    // The dynamic range (containing pos) may be primary or secondary depending on orientation
    const secondRange = ranges[wrappedSecondRangeIndex.value]

    // Use tracked wrap direction instead of inferring from range positions
    // (range positions vary based on orientation for correct cut/paste ordering)
    if (wrapDirection.value === 'clockwise') {
      // Clockwise wrap: pos moves in the 0..anchor region (low range)
      // Find the low range - it has start=0
      const lowRange = primaryRange.start === 0 ? primaryRange : secondRange

      // Find the minimum start of any OTHER range in the 0..anchor region
      let maxEnd = anchor
      for (let i = 0; i < ranges.length; i++) {
        if (i === rangeIndex || i === wrappedSecondRangeIndex.value) continue
        const r = ranges[i]
        // If this range is in the 0..anchor region, we can't go past its start
        if (r.start < anchor && r.start < maxEnd) {
          maxEnd = r.start
        }
      }
      lowRange.end = Math.min(pos, maxEnd)
    } else if (wrapDirection.value === 'counterclockwise') {
      // Counter-clockwise wrap: pos moves in the anchor..seqLen region (high range)
      // Find the high range - it has end=seqLen
      const highRange = primaryRange.end === seqLen ? primaryRange : secondRange

      // Find the maximum end of any OTHER range in the anchor..seqLen region
      let minStart = anchor
      for (let i = 0; i < ranges.length; i++) {
        if (i === rangeIndex || i === wrappedSecondRangeIndex.value) continue
        const r = ranges[i]
        // If this range is in the anchor..seqLen region, we can't go before its end
        if (r.end > anchor && r.end > minStart) {
          minStart = r.end
        }
      }
      highRange.start = Math.max(pos, minStart)
    }
  } else {
    // Non-wrapped: standard single-range logic
    // Clamp to limits
    pos = Math.max(dragLimits.value.low, Math.min(pos, dragLimits.value.high))

    primaryRange.start = Math.min(anchor, pos)
    primaryRange.end = Math.max(anchor, pos)

    // Determine orientation
    const nowLeftOfAnchor = pos < anchor
    const nowRightOfAnchor = pos > anchor

    if (pos === anchor) {
      primaryRange.orientation = Orientation.NONE
    } else if (wasZeroWidth) {
      primaryRange.orientation = nowRightOfAnchor ? Orientation.PLUS : Orientation.MINUS
    } else {
      const crossed = (startedLeftOfAnchor && nowRightOfAnchor) || (!startedLeftOfAnchor && nowLeftOfAnchor)
      if (crossed) {
        primaryRange.orientation = originalOrientation === Orientation.PLUS ? Orientation.MINUS : Orientation.PLUS
      } else {
        primaryRange.orientation = originalOrientation
      }
    }
  }

  // Trigger reactivity
  selection.domain.value = selection.domain.value
}

function handleDragEnd() {
  draggedHandle.value = null
  lastDragPos.value = null
  isWrapped.value = false
  wrappedSecondRangeIndex.value = null
  wrapDirection.value = null
  window.removeEventListener('mousemove', handleDragMove)
  window.removeEventListener('mouseup', handleDragEnd)

  if (selection.isSelected.value) {
    emit('select', { ranges: selection.domain.value.ranges })
  }
}

function handlePathClick(event, rangeIndex) {
  // Shift-click triggers context menu (Mac-friendly alternative to right-click)
  if (event.shiftKey) {
    handlePathContextMenu(event, rangeIndex)
  }
}

function handlePathContextMenu(event, rangeIndex) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', {
    event,
    source: 'selection',
    rangeIndex,
    range: selection.domain.value.ranges[rangeIndex]
  })
}

function handleHandleClick(event, rangeIndex, handleType) {
  // Shift-click triggers context menu (Mac-friendly alternative to right-click)
  if (event.shiftKey) {
    handleHandleContextMenu(event, rangeIndex, handleType)
  }
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
</script>

<template>
  <g class="circular-selection-layer">
    <g v-for="sel in selectionPaths" :key="`sel-${sel.index}`">
      <!-- Selection arc path -->
      <path
        :d="sel.path"
        :class="sel.cssClass"
        @click="handlePathClick($event, sel.index)"
        @contextmenu="handlePathContextMenu($event, sel.index)"
      />

      <!-- Start tab handle -->
      <path
        :d="getTabPath(
          circularGraphics.centerX.value,
          circularGraphics.centerY.value,
          sel.handleRadius,
          sel.startAngle
        )"
        :class="getHandleCssClass(sel.range)"
        @mousedown="startHandleDrag($event, sel.index, 'start')"
        @click="handleHandleClick($event, sel.index, 'start')"
        @contextmenu.prevent="handleHandleContextMenu($event, sel.index, 'start')"
      />

      <!-- End tab handle (only if different from start) -->
      <path
        v-if="sel.type !== 'cursor'"
        :d="getTabPath(
          circularGraphics.centerX.value,
          circularGraphics.centerY.value,
          sel.handleRadius,
          sel.endAngle
        )"
        :class="getHandleCssClass(sel.range)"
        @mousedown="startHandleDrag($event, sel.index, 'end')"
        @click="handleHandleClick($event, sel.index, 'end')"
        @contextmenu.prevent="handleHandleContextMenu($event, sel.index, 'end')"
      />

      <!-- Range index tag for multi-range selections -->
      <g
        v-if="selectionPaths.length > 1"
        class="sel_tag"
      >
        <rect
          :x="polarToCartesian(circularGraphics.centerX.value, circularGraphics.centerY.value, sel.handleRadius + 12, sel.startAngle).x - 8"
          :y="polarToCartesian(circularGraphics.centerX.value, circularGraphics.centerY.value, sel.handleRadius + 12, sel.startAngle).y - 8"
          width="16"
          height="16"
          rx="2"
          class="sel_tag_box"
        />
        <text
          :x="polarToCartesian(circularGraphics.centerX.value, circularGraphics.centerY.value, sel.handleRadius + 12, sel.startAngle).x"
          :y="polarToCartesian(circularGraphics.centerX.value, circularGraphics.centerY.value, sel.handleRadius + 12, sel.startAngle).y"
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
      @mousedown.stop
      @click.stop="handleMerge(bubble)"
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
.circular-selection-layer {
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
}

.selection.minus {
  fill: rgba(255, 0, 0, 0.3);
  stroke: rgba(255, 0, 0, 1);
  stroke-width: 2px;
}

.selection.undirected {
  fill: rgba(192, 192, 192, 0.3);
  stroke: rgba(64, 64, 64, 1);
  stroke-width: 2px;
}

.selection.cursor {
  fill: none;
  stroke: rgba(0, 0, 0, 1);
  stroke-width: 2px;
}

/* Selection handles */
.sel_handle {
  pointer-events: all;
  cursor: grab;
}

.sel_handle:hover {
  filter: brightness(0.95);
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
