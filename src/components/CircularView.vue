<script setup>
import { computed, inject, ref, provide } from 'vue'
import { useCircularGraphics } from '../composables/useCircularGraphics.js'
import CircularAnnotationLayer from './CircularAnnotationLayer.vue'
import CircularSelectionLayer from './CircularSelectionLayer.vue'

const props = defineProps({
  /** Array of Annotation objects to display */
  annotations: {
    type: Array,
    default: () => []
  },
  /** Whether to show annotation captions */
  showAnnotationCaptions: {
    type: Boolean,
    default: true
  },
  /** Extensions to render circular layers for */
  extensions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'select',
  'contextmenu',
  'handle-contextmenu',
  'annotation-click',
  'annotation-contextmenu',
  'annotation-hover'
])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const eventBus = inject('eventBus', null)
const selection = inject('selection')
const annotationColors = inject('annotationColors', null)

// Create circular graphics
const circularGraphics = useCircularGraphics(editorState)

// Provide circular graphics to child components
provide('circularGraphics', circularGraphics)

// SVG ref for mouse coordinate calculation
const svgRef = ref(null)

// Backbone circle path (simple circle)
const backbonePath = computed(() => {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const r = circularGraphics.backboneRadius.value
  // SVG circle as path (two arcs)
  return `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy}`
})

// Title display position (center of circle)
const titlePosition = computed(() => ({
  x: circularGraphics.centerX.value,
  y: circularGraphics.centerY.value - 10
}))

// Length display position (below title)
const lengthPosition = computed(() => ({
  x: circularGraphics.centerX.value,
  y: circularGraphics.centerY.value + 10
}))

// Mouse handling
const isDragging = ref(false)
const dragStart = ref(null)
const lastDragPos = ref(null)
const isWrapped = ref(false)

function handleMouseDown(event) {
  const coords = getCoordsFromEvent(event)

  // Right-click in dead zone starts zoom
  if (event.button === 2 && coords && isInDeadZone(coords)) {
    startZoomDrag(event)
    return
  }

  // Only left click for selection
  if (event.button !== 0) return
  event.preventDefault()

  // Left-click in dead zone clears selection
  if (coords && isInDeadZone(coords)) {
    selection.unselect()
    return
  }

  const pos = getPositionFromEvent(event)
  if (pos === null) return

  isDragging.value = true
  dragStart.value = pos
  lastDragPos.value = pos
  isWrapped.value = false

  // Shift-click extends selection (circular mode - closes gaps, no directional extend for multi-range)
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

  // Detect origin crossing: if position jumps by more than half the sequence
  if (lastDragPos.value !== null) {
    const delta = pos - lastDragPos.value
    if (Math.abs(delta) > seqLen / 2) {
      // We crossed the origin - toggle wrapped state
      isWrapped.value = !isWrapped.value

      const ranges = selection.domain.value.ranges
      const currentRange = ranges[ranges.length - 1]
      const originalOrientation = currentRange.orientation || 1

      if (isWrapped.value) {
        // Create second range for the wrap
        const wentClockwise = delta < 0

        if (wentClockwise) {
          // Selection goes from anchor clockwise past origin to pos
          // Range 1: anchor to seqLen, Range 2: 0 to pos
          currentRange.start = anchor
          currentRange.end = seqLen
          currentRange.orientation = originalOrientation

          ranges.push({
            start: 0,
            end: pos,
            orientation: originalOrientation
          })
        } else {
          // Selection goes from anchor counter-clockwise past origin to pos
          // Range 1: 0 to anchor, Range 2: pos to seqLen
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
        // Unwrap: remove the second range
        if (ranges.length > 1) {
          ranges.pop()
        }
      }
    }
  }

  lastDragPos.value = pos

  // Update range(s) based on wrapped state
  if (isWrapped.value && selection.domain.value.ranges.length > 1) {
    const ranges = selection.domain.value.ranges
    const primaryRange = ranges[ranges.length - 2]
    const secondRange = ranges[ranges.length - 1]

    // Determine which direction we wrapped and update accordingly
    if (primaryRange.end === seqLen) {
      // Clockwise wrap: primary is anchor..seqLen, secondary is 0..pos
      secondRange.end = pos
    } else if (primaryRange.start === 0) {
      // Counter-clockwise wrap: primary is 0..anchor, secondary is pos..seqLen
      secondRange.start = pos
    }

    // Trigger reactivity
    selection.domain.value = selection.domain.value
  } else {
    // Non-wrapped: use standard selection update
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

  // Emit select event
  const domain = selection.domain.value
  if (domain && domain.ranges.length > 0) {
    emit('select', { ranges: domain.ranges })
  }
}

function handleContextMenu(event) {
  // Prevent context menu during zoom operations
  if (isZooming.value) {
    event.preventDefault()
    return
  }

  // Check if right-click is in dead zone (for starting zoom)
  const coords = getCoordsFromEvent(event)
  if (coords && isInDeadZone(coords)) {
    event.preventDefault()
    return
  }

  event.preventDefault()
  const pos = getPositionFromEvent(event)
  emit('contextmenu', { event, position: pos })
}

function getCoordsFromEvent(event) {
  if (!svgRef.value) return null

  const rect = svgRef.value.getBoundingClientRect()
  const vbWidth = circularGraphics.viewBoxWidth.value
  const vbHeight = circularGraphics.viewBoxHeight.value

  // With preserveAspectRatio="xMidYMid meet", the viewBox is scaled uniformly
  // and centered within the element
  const scaleX = vbWidth / rect.width
  const scaleY = vbHeight / rect.height
  const scale = Math.max(scaleX, scaleY)  // "meet" uses the larger scale (smaller rendered size)

  // Calculate the offset due to centering
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

// Event handlers for child components
function handleAnnotationClick(data) {
  emit('annotation-click', data)
}

function handleAnnotationContextMenu(data) {
  emit('annotation-contextmenu', data)
}

function handleAnnotationHover(data) {
  emit('annotation-hover', data)
}

function handleSelectionChange(data) {
  emit('select', data)
}

function handleSelectionContextMenu(data) {
  emit('contextmenu', data)
}

function handleHandleContextMenu(data) {
  emit('handle-contextmenu', data)
}

// Origin dragging
const isDraggingOrigin = ref(false)
const originDragStartAngle = ref(0)
const originDragStartOffset = ref(0)

// Zoom dragging (right-click in dead zone)
const isZooming = ref(false)
const zoomStartY = ref(0)
const zoomStartScale = ref(1.0)
const showZoomTooltip = ref(false)

/**
 * Check if coordinates are in the dead zone (center area).
 */
function isInDeadZone(coords) {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const dx = coords.x - cx
  const dy = coords.y - cy
  const distance = Math.sqrt(dx * dx + dy * dy)
  // Dead zone: more than 20px inside the backbone (toward center)
  const deadZoneOuterRadius = backboneRadius - 20
  return distance < deadZoneOuterRadius
}

/**
 * Start zoom drag on right-click in dead zone.
 */
function startZoomDrag(event) {
  event.preventDefault()
  event.stopPropagation()

  isZooming.value = true
  zoomStartY.value = event.clientY
  zoomStartScale.value = circularGraphics.zoomScale.value
  showZoomTooltip.value = true

  window.addEventListener('mousemove', handleZoomDrag)
  window.addEventListener('mouseup', handleZoomEnd)
}

function handleZoomDrag(event) {
  if (!isZooming.value) return

  // Drag up = positive deltaY = zoom in
  const deltaY = zoomStartY.value - event.clientY
  // 200px drag = 2x zoom change
  const scaleFactor = 1 + deltaY / 200
  circularGraphics.setZoom(zoomStartScale.value * scaleFactor)
}

function handleZoomEnd() {
  isZooming.value = false
  showZoomTooltip.value = false
  window.removeEventListener('mousemove', handleZoomDrag)
  window.removeEventListener('mouseup', handleZoomEnd)
}

function startOriginDrag(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()

  isDraggingOrigin.value = true

  const coords = getCoordsFromEvent(event)
  if (coords) {
    originDragStartAngle.value = circularGraphics.mouseToAngle(coords.x, coords.y)
    originDragStartOffset.value = circularGraphics.originOffset.value
  }

  window.addEventListener('mousemove', handleOriginDragMove)
  window.addEventListener('mouseup', handleOriginDragEnd)
}

function handleOriginDragMove(event) {
  if (!isDraggingOrigin.value) return

  const coords = getCoordsFromEvent(event)
  if (!coords) return

  const currentAngle = circularGraphics.mouseToAngle(coords.x, coords.y)
  const angleDelta = currentAngle - originDragStartAngle.value
  circularGraphics.setOriginOffset(originDragStartOffset.value + angleDelta)
}

function handleOriginDragEnd() {
  isDraggingOrigin.value = false
  window.removeEventListener('mousemove', handleOriginDragMove)
  window.removeEventListener('mouseup', handleOriginDragEnd)
}

// Expose for parent
defineExpose({
  circularGraphics,
  isZooming,
  showZoomTooltip
})
</script>

<template>
  <svg
    ref="svgRef"
    class="circular-view"
    :viewBox="circularGraphics.viewBox.value"
    preserveAspectRatio="xMidYMid meet"
    @mousedown="handleMouseDown"
    @contextmenu="handleContextMenu"
  >
    <!-- Background for click handling -->
    <rect
      x="0"
      y="0"
      :width="circularGraphics.viewBoxWidth.value"
      :height="circularGraphics.viewBoxHeight.value"
      class="background"
    />

    <!-- Backbone circle -->
    <path
      :d="backbonePath"
      class="backbone"
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
          :class="['tick-label', { 'origin-label': tick.position === 0 }]"
          @mousedown="tick.position === 0 && startOriginDrag($event)"
        >
          {{ tick.label }}
        </text>
      </g>
    </g>

    <!-- Selection layer (below annotations) -->
    <CircularSelectionLayer
      @select="handleSelectionChange"
      @contextmenu="handleSelectionContextMenu"
      @handle-contextmenu="handleHandleContextMenu"
    />

    <!-- Annotation layer -->
    <CircularAnnotationLayer
      :annotations="annotations"
      :show-captions="showAnnotationCaptions"
      @click="handleAnnotationClick"
      @contextmenu="handleAnnotationContextMenu"
      @hover="handleAnnotationHover"
    />

    <!-- Extension circular graphics layers -->
    <component
      v-for="ext in props.extensions.filter(e => e.circularGraphicsLayer)"
      :key="ext.id + '-circular-layer'"
      :is="ext.circularGraphicsLayer"
    />

    <!-- Center text (title and length) -->
    <text
      :x="titlePosition.x"
      :y="titlePosition.y"
      text-anchor="middle"
      dominant-baseline="middle"
      class="center-title"
    >
      {{ editorState.title.value || 'Untitled' }}
    </text>
    <text
      :x="lengthPosition.x"
      :y="lengthPosition.y"
      text-anchor="middle"
      dominant-baseline="middle"
      class="center-length"
    >
      {{ editorState.sequenceLength.value.toLocaleString() }} bp
    </text>

    <!-- Zoom tooltip showing current backbone radius -->
    <g v-if="showZoomTooltip" class="zoom-tooltip">
      <rect
        :x="circularGraphics.centerX.value - 50"
        :y="circularGraphics.centerY.value + 25"
        width="100"
        height="24"
        rx="4"
        class="zoom-tooltip-bg"
      />
      <text
        :x="circularGraphics.centerX.value"
        :y="circularGraphics.centerY.value + 42"
        text-anchor="middle"
        dominant-baseline="middle"
        class="zoom-tooltip-text"
      >
        Radius: {{ Math.round(circularGraphics.backboneRadius.value) }}px
      </text>
    </g>
  </svg>
</template>

<style scoped>
.circular-view {
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-select: none;
}

.background {
  fill: white;
}

.backbone {
  fill: none;
  stroke: #333;
  stroke-width: 3;
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

.center-title {
  font-family: Arial, sans-serif;
  font-size: 14px;
  font-weight: bold;
  fill: #333;
}

.center-length {
  font-family: Arial, sans-serif;
  font-size: 11px;
  fill: #666;
}

/* Zoom tooltip */
.zoom-tooltip {
  pointer-events: none;
}

.zoom-tooltip-bg {
  fill: rgba(0, 0, 0, 0.8);
}

.zoom-tooltip-text {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 11px;
  fill: white;
}
</style>
