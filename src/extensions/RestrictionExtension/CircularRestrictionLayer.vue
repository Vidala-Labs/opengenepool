<script setup>
import { inject, computed, watch } from 'vue'
import { restrictionSitesVisible, cutSites, setSequence } from './state.js'
import { polarToCartesian } from '../../utils/circular.js'

// Inject from parent CircularView
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')

// Layout constants
const TICK_LENGTH = 6           // Short tick mark through backbone
const LEADER_START_OFFSET = 8   // Start of leader line (outside backbone)
const LEADER_LENGTH = 20        // Length of radial portion of leader
const LABEL_GAP = 4             // Gap between leader end and label
const ANGULAR_SPREAD = 0.06     // Radians to spread crowded labels (~3.5 degrees)

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

// Compute marker elements with leader line layout
const markersWithLayout = computed(() => {
  if (!shouldRender.value || !circularGraphics) return []

  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const seqLen = editorState?.sequenceLength?.value || 1

  // First pass: create basic marker data
  const markers = []
  for (let i = 0; i < cutSites.value.length; i++) {
    const site = cutSites.value[i]
    const position = site.position
    const angle = circularGraphics.positionToAngle(position)

    markers.push({
      id: `${site.enzyme}-${i}`,
      enzyme: site.enzyme,
      position,
      angle,
      labelAngle: angle, // Will be adjusted for crowded labels
      row: 0             // Will be set for stacked labels
    })
  }

  // Sort by position for collision detection
  markers.sort((a, b) => a.position - b.position)

  // Second pass: detect clusters and spread labels
  // Group markers that are close together
  const collisionThreshold = seqLen * 0.025 // ~2.5% of sequence
  const clusters = []
  let currentCluster = []

  for (let i = 0; i < markers.length; i++) {
    if (currentCluster.length === 0) {
      currentCluster.push(markers[i])
    } else {
      const lastMarker = currentCluster[currentCluster.length - 1]
      const dist = markers[i].position - lastMarker.position

      if (dist < collisionThreshold) {
        currentCluster.push(markers[i])
      } else {
        clusters.push(currentCluster)
        currentCluster = [markers[i]]
      }
    }
  }
  if (currentCluster.length > 0) {
    clusters.push(currentCluster)
  }

  // Check for wrap-around cluster (first and last markers close together)
  if (clusters.length >= 2) {
    const firstCluster = clusters[0]
    const lastCluster = clusters[clusters.length - 1]
    const firstPos = firstCluster[0].position
    const lastPos = lastCluster[lastCluster.length - 1].position
    const wrapDist = (seqLen - lastPos) + firstPos

    if (wrapDist < collisionThreshold) {
      // Merge first and last clusters
      const merged = [...lastCluster, ...firstCluster]
      clusters[0] = merged
      clusters.pop()
    }
  }

  // Third pass: spread labels within each cluster
  for (const cluster of clusters) {
    if (cluster.length === 1) continue

    // Calculate center angle of cluster
    const centerAngle = cluster.reduce((sum, m) => sum + m.angle, 0) / cluster.length

    // Spread labels evenly around the center
    const totalSpread = (cluster.length - 1) * ANGULAR_SPREAD
    const startAngle = centerAngle - totalSpread / 2

    for (let i = 0; i < cluster.length; i++) {
      cluster[i].labelAngle = startAngle + i * ANGULAR_SPREAD
      cluster[i].row = i // For staggered radius if needed
    }
  }

  // Fourth pass: calculate all geometry
  const result = []
  for (const marker of markers) {
    const { angle, labelAngle, enzyme, id, position, row } = marker

    // Tick mark through backbone
    const tickInner = polarToCartesian(cx, cy, backboneRadius - TICK_LENGTH / 2, angle)
    const tickOuter = polarToCartesian(cx, cy, backboneRadius + TICK_LENGTH / 2, angle)

    // Leader line: starts at backbone, goes outward radially, then bends to label
    const leaderStart = polarToCartesian(cx, cy, backboneRadius + LEADER_START_OFFSET, angle)

    // Add extra radius for stacked labels in clusters
    const extraRadius = row * 12
    const leaderEndRadius = backboneRadius + LEADER_START_OFFSET + LEADER_LENGTH + extraRadius
    const leaderEnd = polarToCartesian(cx, cy, leaderEndRadius, labelAngle)

    // Label position (just beyond leader end)
    const labelRadius = leaderEndRadius + LABEL_GAP
    const labelPoint = polarToCartesian(cx, cy, labelRadius, labelAngle)

    // Label rotation - text reads outward from center
    let rotationDeg = (labelAngle * 180 / Math.PI) + 90
    // Flip on left side so text is always readable
    const isLeftSide = labelAngle > Math.PI / 2 && labelAngle < 3 * Math.PI / 2
    const textAnchor = isLeftSide ? 'end' : 'start'
    if (isLeftSide) {
      rotationDeg += 180
    }

    result.push({
      id,
      enzyme,
      position,
      tickInner,
      tickOuter,
      leaderStart,
      leaderEnd,
      labelPoint,
      rotationDeg,
      textAnchor,
      hasLeaderBend: Math.abs(angle - labelAngle) > 0.01 // Leader bends if label was spread
    })
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
      <!-- Tick mark through backbone -->
      <line
        :x1="marker.tickInner.x"
        :y1="marker.tickInner.y"
        :x2="marker.tickOuter.x"
        :y2="marker.tickOuter.y"
        stroke="black"
        stroke-width="1.5"
      />

      <!-- Leader line (from backbone outward to label) -->
      <path
        :d="`M ${marker.tickOuter.x} ${marker.tickOuter.y} L ${marker.leaderStart.x} ${marker.leaderStart.y} L ${marker.leaderEnd.x} ${marker.leaderEnd.y}`"
        stroke="black"
        stroke-width="1"
        fill="none"
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
