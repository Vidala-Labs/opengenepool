<script setup>
import { inject, computed, ref } from 'vue'

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
  }
})

const emit = defineEmits(['select', 'contextmenu'])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const selection = inject('selection')

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

// Bar width calculation for a given text length
function getBarWidth(textLength) {
  return textLength * metrics.value.charWidth
}

// Get Y position for a line
function getLineY(lineIndex) {
  if (isAlignmentLayer.value) {
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

    // Clamp to valid range
    const maxPos = props.positionMap.length
    const clampedAlignedPos = Math.max(0, Math.min(alignedPos, maxPos))

    // Map to original position
    let originalPos = props.positionMap[clampedAlignedPos]

    // If on a gap, find nearest non-gap position
    if (originalPos === null) {
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
  if (isAlignmentLayer.value) {
    return Math.floor((y - props.yOffset) / props.blockHeight)
  }
  return graphics.pixelToLineIndex(y, editorState.lineCount.value)
}

function handleMouseDown(event, lineIndex) {
  if (event.button !== 0) return // Left click only
  event.preventDefault()

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
  emit('contextmenu', { event, lineIndex })
}
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
        class="position-label"
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
        >{{ getLineText(line) }}</text>

        <!-- Bar mode - thin bar above center -->
        <rect
          v-else
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
          @mousedown="handleMouseDown($event, line.index)"
          @contextmenu="handleContextMenu($event, line.index)"
        />
      </g>
    </g>
  </g>
</template>
