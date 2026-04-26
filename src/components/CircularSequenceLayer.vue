<script setup>
import { inject, computed, ref } from 'vue'
import { polarToCartesian } from '../utils/circular.js'

const props = defineProps({
  /** Whether to show the origin tick as draggable */
  draggableOrigin: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['select', 'contextmenu', 'origin-drag-start'])

// Inject from parent
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')
const selection = inject('selection')

// ============================================
// Backbone Path
// ============================================

const backbonePath = computed(() => {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const r = circularGraphics.backboneRadius.value
  // SVG circle as path (two arcs)
  return `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy}`
})

// ============================================
// Mouse Handling
// ============================================

const isDragging = ref(false)
const dragStart = ref(null)
const lastDragPos = ref(null)
const isWrapped = ref(false)

function getCoordsFromEvent(event) {
  // Get coordinates relative to SVG viewBox
  const svg = document.querySelector('.circular-view')
  if (!svg) return null

  const rect = svg.getBoundingClientRect()
  const vbWidth = circularGraphics.viewBoxWidth.value
  const vbHeight = circularGraphics.viewBoxHeight.value

  const scaleX = vbWidth / rect.width
  const scaleY = vbHeight / rect.height
  const scale = Math.max(scaleX, scaleY)

  const renderedWidth = vbWidth / scale
  const renderedHeight = vbHeight / scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2

  return {
    x: (event.clientX - rect.left - offsetX) * scale,
    y: (event.clientY - rect.top - offsetY) * scale
  }
}

function getPositionFromEvent(event) {
  const coords = getCoordsFromEvent(event)
  if (!coords) return null
  return circularGraphics.mouseToPosition(coords.x, coords.y)
}

function isInDeadZone(coords) {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const dx = coords.x - cx
  const dy = coords.y - cy
  const distance = Math.sqrt(dx * dx + dy * dy)
  const deadZoneOuterRadius = backboneRadius - 20
  return distance < deadZoneOuterRadius
}

function handleMouseDown(event) {
  // Only left click for selection
  if (event.button !== 0) return

  const coords = getCoordsFromEvent(event)

  // Left-click in dead zone clears selection
  if (coords && isInDeadZone(coords)) {
    selection.unselect()
    return
  }

  event.preventDefault()

  const pos = getPositionFromEvent(event)
  if (pos === null) return

  isDragging.value = true
  dragStart.value = pos
  lastDragPos.value = pos
  isWrapped.value = false

  // Shift-click extends selection
  if (event.shiftKey && selection.isSelected.value) {
    selection.extendToPosition(pos, true)
    return
  }

  // Start a new selection (or add range with Ctrl)
  selection.startSelection(pos, event.ctrlKey)

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event) {
  if (!isDragging.value || dragStart.value === null) return

  const pos = getPositionFromEvent(event)
  if (pos === null) return

  const seqLen = editorState.sequenceLength.value
  const anchor = selection.anchor.value

  // Detect origin crossing
  if (lastDragPos.value !== null) {
    const delta = pos - lastDragPos.value
    if (Math.abs(delta) > seqLen / 2) {
      isWrapped.value = !isWrapped.value

      const ranges = selection.domain.value.ranges
      const currentRange = ranges[ranges.length - 1]
      const originalOrientation = currentRange.orientation || 1

      if (isWrapped.value) {
        const wentClockwise = delta < 0

        if (wentClockwise) {
          currentRange.start = anchor
          currentRange.end = seqLen
          currentRange.orientation = originalOrientation

          ranges.push({
            start: 0,
            end: pos,
            orientation: originalOrientation
          })
        } else {
          currentRange.start = 0
          currentRange.end = anchor
          currentRange.orientation = originalOrientation

          ranges.push({
            start: pos,
            end: seqLen,
            orientation: originalOrientation
          })
        }
      } else {
        if (ranges.length > 1) {
          ranges.pop()
        }
      }
    }
  }

  lastDragPos.value = pos

  if (isWrapped.value && selection.domain.value.ranges.length > 1) {
    const ranges = selection.domain.value.ranges
    const primaryRange = ranges[ranges.length - 2]
    const secondRange = ranges[ranges.length - 1]

    if (primaryRange.end === seqLen) {
      secondRange.end = pos
    } else if (primaryRange.start === 0) {
      secondRange.start = pos
    }

    selection.domain.value = selection.domain.value
  } else {
    selection.updateSelection(pos)
  }
}

function handleMouseUp() {
  isDragging.value = false
  lastDragPos.value = null
  isWrapped.value = false
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)

  selection.endSelection()

  const domain = selection.domain.value
  if (domain && domain.ranges.length > 0) {
    emit('select', { ranges: domain.ranges })
  }
}

function handleContextMenu(event) {
  const coords = getCoordsFromEvent(event)
  if (coords && isInDeadZone(coords)) {
    // Don't emit context menu for dead zone
    return
  }

  event.preventDefault()
  const pos = getPositionFromEvent(event)
  emit('contextmenu', { event, position: pos, source: 'sequence' })
}

function handleOriginDragStart(event) {
  if (!props.draggableOrigin) return
  emit('origin-drag-start', event)
}
</script>

<template>
  <g class="circular-sequence-layer">
    <!-- Backbone circle -->
    <path
      :d="backbonePath"
      class="backbone"
      @mousedown="handleMouseDown"
      @contextmenu="handleContextMenu"
    />

    <!-- Tick marks -->
    <g class="tick-marks">
      <g
        v-for="tick in circularGraphics.tickMarks.value"
        :key="tick.position"
        :class="['tick', { 'origin-tick': tick.position === 0 }]"
      >
        <!-- Tick line -->
        <line
          :x1="tick.innerPoint.x"
          :y1="tick.innerPoint.y"
          :x2="tick.outerPoint.x"
          :y2="tick.outerPoint.y"
          :class="['tick-line', { 'origin-line': tick.position === 0 }]"
        />
        <!-- Tick label (origin is draggable) -->
        <text
          :x="tick.labelPoint.x"
          :y="tick.labelPoint.y"
          :text-anchor="tick.textAnchor"
          :dominant-baseline="tick.dominantBaseline"
          :class="['tick-label', { 'origin-label': tick.position === 0 && draggableOrigin }]"
          @mousedown="tick.position === 0 && handleOriginDragStart($event)"
        >
          {{ tick.label }}
        </text>
      </g>
    </g>
  </g>
</template>

<style scoped>
.circular-sequence-layer {
  pointer-events: none;
}

.backbone {
  fill: none;
  stroke: #333;
  stroke-width: 3;
  pointer-events: stroke;
  cursor: crosshair;
}

.tick-marks {
  pointer-events: none;
}

.tick-line {
  stroke: #666;
  stroke-width: 1;
}

.tick-label {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 9px;
  fill: #666;
}

/* Origin tick (position 0) - draggable */
.origin-tick {
  pointer-events: all;
}

.origin-line {
  stroke: #333;
  stroke-width: 2;
}

.origin-label {
  font-weight: bold;
  fill: #333;
  cursor: grab;
}

.origin-label:hover {
  fill: #0066cc;
}

.origin-label:active {
  cursor: grabbing;
}
</style>
