<script setup>
import { inject, computed, watch } from 'vue'
import { restrictionSitesVisible, cutSites, setSequence } from './state.js'

// Inject from parent CircularView
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')

// Line lengths for the cut site markers
const MARKER_LINE_LENGTH = 12
const LABEL_OFFSET = 18

// Update sequence when it changes (same as linear layer)
watch(
  () => editorState?.sequence?.value,
  (newSequence) => {
    if (restrictionSitesVisible.value) {
      setSequence(newSequence, editorState?.title?.value || '')
    }
  },
  { immediate: true }
)

// Also update when sites become visible
watch(restrictionSitesVisible, (visible) => {
  if (visible && editorState?.sequence?.value) {
    setSequence(editorState.sequence.value, editorState?.title?.value || '')
  }
})

// Visibility check
const shouldRender = computed(() => {
  return restrictionSitesVisible.value && cutSites.value.length > 0
})

// Compute marker elements for rendering
const markers = computed(() => {
  if (!shouldRender.value || !circularGraphics) return []

  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value

  const result = []

  for (let i = 0; i < cutSites.value.length; i++) {
    const site = cutSites.value[i]
    const position = site.position

    // Get angle for this position
    const angle = circularGraphics.positionToAngle(position)

    // Calculate points for the radial line (extends inward from backbone)
    const outerPoint = circularGraphics.positionToCartesian(position, backboneRadius)
    const innerPoint = circularGraphics.positionToCartesian(position, backboneRadius - MARKER_LINE_LENGTH)

    // Calculate label position (inside the circle)
    const labelPoint = circularGraphics.positionToCartesian(position, backboneRadius - LABEL_OFFSET)

    // Calculate label rotation (perpendicular to radial line, readable)
    // Convert angle from radians to degrees and add 90 to make text follow the circle
    let rotationDeg = (angle * 180 / Math.PI) + 90
    // Flip text on bottom half so it's not upside down
    const isBottomHalf = rotationDeg > 90 && rotationDeg < 270
    if (isBottomHalf) {
      rotationDeg += 180
    }

    // Determine text anchor based on position
    const textAnchor = 'middle'

    result.push({
      id: `${site.enzyme}-${i}`,
      enzyme: site.enzyme,
      position,
      angle,
      outerPoint,
      innerPoint,
      labelPoint,
      rotationDeg,
      textAnchor,
      isBottomHalf
    })
  }

  return result
})

// For collision detection on labels, we'll group nearby labels
// and offset them if they would overlap
const markersWithLayout = computed(() => {
  if (markers.value.length === 0) return []

  const seqLen = editorState?.sequenceLength?.value || 1
  const result = [...markers.value]

  // Sort by position
  result.sort((a, b) => a.position - b.position)

  // Detect collisions - labels within ~3% of sequence length might overlap
  const collisionThreshold = seqLen * 0.02 // ~2% of sequence
  const labelRadiusOffsets = new Map()

  for (let i = 0; i < result.length; i++) {
    let offset = 0
    // Check against previous markers
    for (let j = 0; j < i; j++) {
      const dist = Math.abs(result[i].position - result[j].position)
      const wrapDist = seqLen - dist
      const minDist = Math.min(dist, wrapDist)

      if (minDist < collisionThreshold) {
        // This marker is close to a previous one, offset it further inward
        const prevOffset = labelRadiusOffsets.get(result[j].id) || 0
        offset = Math.max(offset, prevOffset + 14) // 14px per row
      }
    }
    labelRadiusOffsets.set(result[i].id, offset)

    // Recalculate label position with offset
    if (offset > 0) {
      const backboneRadius = circularGraphics.backboneRadius.value
      result[i].labelPoint = circularGraphics.positionToCartesian(
        result[i].position,
        backboneRadius - LABEL_OFFSET - offset
      )
      result[i].labelOffset = offset
    }
  }

  return result
})
</script>

<template>
  <g v-if="shouldRender" class="circular-restriction-layer">
    <g
      v-for="marker in markersWithLayout"
      :key="marker.id"
      class="restriction-marker"
    >
      <!-- Radial cut line (from backbone inward) -->
      <line
        :x1="marker.outerPoint.x"
        :y1="marker.outerPoint.y"
        :x2="marker.innerPoint.x"
        :y2="marker.innerPoint.y"
        stroke="black"
        stroke-width="1.5"
      />

      <!-- Small tick mark at backbone -->
      <line
        :x1="marker.outerPoint.x"
        :y1="marker.outerPoint.y"
        :x2="circularGraphics.positionToCartesian(marker.position, circularGraphics.backboneRadius.value + 3).x"
        :y2="circularGraphics.positionToCartesian(marker.position, circularGraphics.backboneRadius.value + 3).y"
        stroke="black"
        stroke-width="1.5"
      />

      <!-- Enzyme name label -->
      <text
        :x="marker.labelPoint.x"
        :y="marker.labelPoint.y"
        :text-anchor="marker.textAnchor"
        dominant-baseline="middle"
        :transform="`rotate(${marker.rotationDeg}, ${marker.labelPoint.x}, ${marker.labelPoint.y})`"
        class="enzyme-label"
      >
        {{ marker.enzyme }}
      </text>
    </g>
  </g>
</template>

<style scoped>
.circular-restriction-layer {
  pointer-events: none;
}

.restriction-marker {
  pointer-events: none;
}

.enzyme-label {
  font-size: 8px;
  font-family: system-ui, -apple-system, sans-serif;
  fill: black;
}
</style>
