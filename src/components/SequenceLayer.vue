<script setup>
import { inject, computed, ref, onMounted, onUnmounted } from 'vue'
import { Range } from '../utils/dna.js'
import { sequenceMenuItems } from './menus/sequenceMenuContributor.js'

const props = defineProps({
  /** SequenceDocument for edit operations (insert, delete, replace) */
  document: {
    type: Object,
    default: null
  },
  /** Mode: null (normal), 'target', or 'query' */
  mode: {
    type: String,
    default: null,
    validator: (v) => v === null || v === 'target' || v === 'query'
  },
  /** Lines to render (for alignment mode) */
  lines: {
    type: Array,
    default: null
  },
  /** Position map: aligned position -> original sequence position (for alignment mode) */
  positionMap: {
    type: Array,
    default: null
  },
  /** Y offset within the SVG for this layer */
  yOffset: {
    type: Number,
    default: 0
  },
  /** Block height for alignment mode (height of target+match+query block) */
  blockHeight: {
    type: Number,
    default: 0
  },
  /** Original sequence length for Select all in alignment mode */
  originalSequenceLength: {
    type: Number,
    default: null
  },
  /** Callback to get alignment-specific menu items (for gap/mutation annotation) */
  getAlignmentMenuItems: {
    type: Function,
    default: null
  },
  /** When true, this row aligned as a reverse complement; its left-margin
   *  position labels are marked so CSS can color them (red) to flag the strand. */
  reverseComplement: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['select', 'contextmenu'])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const selection = inject('selection')

// Context-menu service + sequence action handlers (provided by the editor). The
// contributor always fires; it shows Select all / Insert from system state, and
// uses this layer's mode (props.mode) so only the clicked alignment row contributes.
const contextMenu = inject('contextMenu', null)
const sequenceMenuActions = inject('sequenceMenuActions', null)
const sequenceContributor = {
  id: `sequence${props.mode ? ':' + props.mode : ''}`,
  getItems: (context) => sequenceMenuItems(
    { ...context, layerMode: props.mode, sequenceLength: props.originalSequenceLength ?? editorState.sequenceLength.value },
    sequenceMenuActions || {}
  )
}
onMounted(() => contextMenu?.register(sequenceContributor))
onUnmounted(() => contextMenu?.unregister(sequenceContributor))
// Inject alignment line positioning function and lines (provided by AlignmentEditor)
const getAlignmentLineY = inject('getAlignmentLineY', null)
const injectedAlignmentLines = inject('alignmentLines', null)
const injectedLineAnnotationHeights = inject('lineAnnotationHeights', null)
const injectedAlignmentTopPadding = inject('alignmentTopPadding', 30)

// Normal mode lines (from editorState)
const normalLines = computed(() => editorState.lines.value)

// Use prop lines if provided, otherwise use normal lines
const effectiveLines = computed(() => props.lines ?? normalLines.value)

// Metrics and layout
const metrics = computed(() => graphics.metrics.value)
const lineHeight = computed(() => graphics.lineHeight.value)
const isTextMode = computed(() => metrics.value.textMode)

// Is this an alignment mode layer?
const isAlignmentLayer = computed(() => props.mode !== null)

// Letter spacing for monospace text
const letterSpacing = computed(() => {
  const m = metrics.value
  return `${m.charWidth - m.blockWidth}px`
})

// Convert spaces to non-breaking spaces to prevent SVG whitespace collapse
function preserveSpaces(text) {
  return text ? text.replace(/ /g, '\u00A0') : text
}

// Bar width calculation for a given text length
function getBarWidth(textLength) {
  return textLength * metrics.value.charWidth
}

// Get Y position for a line
function getLineY(lineIndex) {
  if (isAlignmentLayer.value) {
    // Use injected per-line positioning if available, otherwise fall back to uniform spacing
    if (getAlignmentLineY) {
      return getAlignmentLineY(lineIndex) + props.yOffset
    }
    return lineIndex * props.blockHeight + props.yOffset
  }
  return graphics.getLineY(lineIndex)
}

// Get line text for rendering
function getLineText(line) {
  if (isAlignmentLayer.value) {
    return props.mode === 'target' ? line.targetText : line.queryText
  }
  return line.text
}

// Get position label for a line
function getPositionLabel(line) {
  if (isAlignmentLayer.value) {
    return props.mode === 'target' ? line.targetPosition : line.queryPosition
  }
  return line.position
}

// Get line width for overlay
function getLineWidth(line) {
  const text = getLineText(line)
  return text ? text.length * metrics.value.charWidth : getBarWidth(line.end - line.start)
}

// Compute bar segments that skip gaps (for alignment mode, zoomed out)
function getBarSegments(line) {
  if (!isAlignmentLayer.value || isTextMode.value) return null

  const text = getLineText(line)
  if (!text) return null

  const charWidth = metrics.value.charWidth
  const segments = []
  let segmentStart = null

  for (let i = 0; i <= text.length; i++) {
    const isGap = i < text.length && text[i] === '-'

    if (!isGap && segmentStart === null) {
      // Start a new segment
      segmentStart = i
    } else if ((isGap || i === text.length) && segmentStart !== null) {
      // End the current segment
      segments.push({
        x: segmentStart * charWidth,
        width: (i - segmentStart) * charWidth
      })
      segmentStart = null
    }
  }

  return segments.length > 0 ? segments : null
}

// --- Selection handling ---

const isDragging = ref(false)
const dragStart = ref(null)  // Position where drag started

// Convert pixel coordinates to sequence position
function getPositionFromEvent(event, lineIndex) {
  const svgEl = document.querySelector('.editor-svg')
  if (!svgEl) return null

  const svgRect = svgEl.getBoundingClientRect()
  const x = event.clientX - svgRect.left - metrics.value.lmargin
  const charWidth = metrics.value.charWidth
  const linePos = Math.max(0, Math.floor(x / charWidth))

  if (isAlignmentLayer.value) {
    // Alignment mode: convert to aligned position, then to original
    const zoomLevel = editorState.zoomLevel.value
    const alignedPos = lineIndex * zoomLevel + linePos

    if (!props.positionMap) return null

    // Clamp to valid range (use length - 1 since we're using as array index)
    const maxPos = props.positionMap.length - 1
    const clampedAlignedPos = Math.max(0, Math.min(alignedPos, maxPos))

    // Map to original position
    let originalPos = props.positionMap[clampedAlignedPos]

    // If on a gap (null) or undefined (shouldn't happen but handle it), find nearest non-gap position
    if (originalPos === null || originalPos === undefined) {
      // Search backwards
      for (let i = clampedAlignedPos - 1; i >= 0; i--) {
        if (props.positionMap[i] !== null) {
          originalPos = props.positionMap[i] + 1
          break
        }
      }
      // Search forwards if still null
      if (originalPos === null) {
        for (let i = clampedAlignedPos + 1; i < props.positionMap.length; i++) {
          if (props.positionMap[i] !== null) {
            originalPos = props.positionMap[i]
            break
          }
        }
      }
    }

    return originalPos
  } else {
    // Normal mode: direct position calculation
    const zoomLevel = editorState.zoomLevel.value
    return lineIndex * zoomLevel + Math.min(linePos, zoomLevel)
  }
}

// Get line index from Y coordinate
function getLineIndexFromY(y) {
  if (isAlignmentLayer.value && getAlignmentLineY && injectedAlignmentLines && injectedLineAnnotationHeights) {
    const numLines = injectedAlignmentLines.value?.length || 0
    if (numLines === 0) return 0

    const heights = injectedLineAnnotationHeights.value
    const padding = injectedAlignmentTopPadding
    const lh = lineHeight.value

    // Each row's capture zone:
    // top: baselineY - targetHeight - padding/2
    // bottom: baselineY + 3*lineHeight + queryHeight + padding/2
    for (let i = 0; i < numLines; i++) {
      const baselineY = getAlignmentLineY(i)
      const targetH = heights.target.get(i) || 0
      const queryH = heights.query.get(i) || 0

      const rowTop = baselineY - targetH - padding / 2
      const rowBottom = baselineY + 3 * lh + queryH + padding / 2

      if (y >= rowTop && y < rowBottom) {
        return i
      }
    }

    // If before first row, return 0; if after last row, return last
    const firstBaselineY = getAlignmentLineY(0)
    const firstTargetH = heights.target.get(0) || 0
    if (y < firstBaselineY - firstTargetH - padding / 2) return 0

    return numLines - 1
  }
  return graphics.pixelToLineIndex(y, editorState.lineCount.value)
}

function handleMouseDown(event, lineIndex) {
  if (event.button !== 0) return // Left click only
  event.preventDefault()
  event.stopPropagation() // Prevent bubbling to background click handler

  // Clear native text selection
  window.getSelection()?.removeAllRanges()

  const pos = getPositionFromEvent(event, lineIndex)
  if (pos === null) return

  isDragging.value = true
  dragStart.value = pos

  // Shift-click extends existing selection
  if (event.shiftKey && selection.isSelected.value) {
    selection.extendToPosition(pos)
    return
  }

  // Start new selection (or add range with Ctrl)
  // Pass the mode ('target', 'query', or null) as the selection source
  selection.startSelection(pos, event.ctrlKey, props.mode)

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event) {
  if (!isDragging.value || dragStart.value === null) return

  // Clear native text selection
  window.getSelection()?.removeAllRanges()

  const svgEl = document.querySelector('.editor-svg')
  if (!svgEl) return

  const svgRect = svgEl.getBoundingClientRect()
  const y = event.clientY - svgRect.top
  const lineIndex = getLineIndexFromY(y)

  const pos = getPositionFromEvent(event, lineIndex)
  if (pos !== null) {
    selection.updateSelection(pos)
  }
}

function handleMouseUp() {
  isDragging.value = false
  dragStart.value = null

  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)

  selection.endSelection()

  // Emit select event if there's a non-zero selection
  const domain = selection.domain.value
  if (domain && domain.ranges.length > 0) {
    const range = domain.ranges[0]
    if (range.start !== range.end) {
      emit('select', { start: range.start, end: range.end, mode: props.mode })
    }
  }
}

function handleContextMenu(event, lineIndex) {
  emit('contextmenu', { event, lineIndex, mode: props.mode })
}

// ============================================
// Click/Context Menu Items via elementsFromPoint
// ============================================

/**
 * Handle click for an element with data attributes.
 * Called by parent editor when routing clicks via elementsFromPoint.
 *
 * SequenceLayer handles selection via mousedown (drag-based), so clicks here
 * just return true to prevent the "clear selection" fallback from firing.
 * The actual selection logic has already happened in the mousedown/mouseup cycle.
 *
 * @param {DOMStringMap} dataset - The element's dataset (data-* attributes)
 * @param {MouseEvent} event - The click event
 * @returns {boolean} True if the click was handled
 */
function handleClickForElement(dataset, event) {
  if (dataset.layer !== 'sequence') return false

  // In alignment mode, only handle if the element's mode matches this layer's mode
  if (props.mode && dataset.mode !== props.mode) return false

  // Selection is handled via mousedown/mouseup, not click.
  // Return true to prevent the "clear selection" fallback from undoing
  // the selection that was just made via the mousedown/mouseup cycle.
  return true
}

// Expose for click routing
defineExpose({
  handleClickForElement
})
</script>

<template>
  <g class="sequence-layer">
    <g
      v-for="line in effectiveLines"
      :key="line.index"
      :transform="`translate(0, ${getLineY(line.index)})`"
      class="sequence-line"
    >
      <!-- Position label -->
      <text
        v-if="getPositionLabel(line) !== null"
        :x="metrics.lmargin - 8"
        :y="lineHeight / 2"
        text-anchor="end"
        dominant-baseline="middle"
        :class="['position-label', { 'reverse-complement': reverseComplement }]"
      >
        {{ getPositionLabel(line) }}
      </text>

      <!-- Sequence content (text or bar) -->
      <g :transform="`translate(${metrics.lmargin}, 0)`">
        <!-- Text mode -->
        <text
          v-if="isTextMode"
          x="0"
          :y="lineHeight / 2"
          dominant-baseline="middle"
          :class="['sequence-text', mode ? `alignment-${mode}-text` : '']"
          :style="{ letterSpacing }"
        >{{ preserveSpaces(getLineText(line)) }}</text>

        <!-- Bar mode - thin bar above center -->
        <!-- For alignment mode: multiple segments that skip gaps -->
        <template v-else-if="isAlignmentLayer && getBarSegments(line)">
          <rect
            v-for="(seg, idx) in getBarSegments(line)"
            :key="idx"
            :x="seg.x"
            :y="lineHeight * 3 / 8"
            :width="seg.width"
            :height="lineHeight / 4"
            class="sequence-bar"
          />
        </template>
        <!-- Normal mode: single bar -->
        <rect
          v-else-if="!isTextMode"
          x="0"
          :y="lineHeight * 3 / 8"
          :width="getLineWidth(line)"
          :height="lineHeight / 4"
          class="sequence-bar"
        />

        <!-- Invisible overlay to capture mouse events -->
        <rect
          x="0"
          y="0"
          :width="getLineWidth(line)"
          :height="lineHeight"
          class="sequence-overlay"
          data-layer="sequence"
          :data-mode="mode || undefined"
          :data-line-index="line.index"
          :data-line-start="line.start"
          @mousedown="handleMouseDown($event, line.index)"
          @contextmenu="handleContextMenu($event, line.index)"
        />
      </g>
    </g>
  </g>
</template>
