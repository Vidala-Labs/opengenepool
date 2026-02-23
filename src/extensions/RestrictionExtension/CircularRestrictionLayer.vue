<script setup>
import { inject, computed, watch, ref, onMounted, onUnmounted, nextTick } from 'vue'
import { restrictionSitesVisible, cutSites, setSequence } from './state.js'
import { polarToCartesian } from '../../utils/circular.js'

// Inject from parent CircularView
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')
const circularAnnotations = inject('circularAnnotations', null)

// Layout constants
const TICK_LENGTH = 6           // Short tick mark through backbone
const LEADER_GAP = 4            // Gap between annotation layer and leader line start
const LEADER_LENGTH = 20        // Length of radial portion of leader
const TEXT_OFFSET = 3           // Gap between horizontal line and text
const LABEL_PADDING = 4         // Minimum horizontal gap between adjacent labels (pixels)
const ESTIMATED_CHAR_WIDTH = 5  // Estimated width per character for initial layout
const LABEL_HEIGHT = 10         // Approximate height of label text

// Total radial space needed for restriction labels (for zoom constraints)
const RESTRICTION_RADIAL_SPACE = LEADER_GAP + LEADER_LENGTH + TEXT_OFFSET + LABEL_HEIGHT + 5

// Refs for measuring text widths
const textRefs = ref({})
const measuredTextWidths = ref({})

// Measure text widths after render
function measureTextWidths() {
  for (const [id, el] of Object.entries(textRefs.value)) {
    if (el && el.getBBox) {
      const bbox = el.getBBox()
      measuredTextWidths.value[id] = bbox.width
    }
  }
}

// Re-measure when markers change
watch(
  () => cutSites.value,
  async () => {
    await nextTick()
    measureTextWidths()
  },
  { deep: true }
)

onMounted(() => {
  nextTick(() => measureTextWidths())
})

// Get measured text width for a marker (with fallback)
function getTextWidth(markerId) {
  return measuredTextWidths.value[markerId] || 0
}

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

// Register/unregister radial space for zoom constraints
watch(
  shouldRender,
  (visible) => {
    if (circularGraphics?.setExtensionRadialSpace) {
      circularGraphics.setExtensionRadialSpace('restriction', visible ? RESTRICTION_RADIAL_SPACE : 0)
    }
  },
  { immediate: true }
)

// Cleanup on unmount
onUnmounted(() => {
  if (circularGraphics?.setExtensionRadialSpace) {
    circularGraphics.setExtensionRadialSpace('restriction', 0)
  }
})

/**
 * Compute annotation row assignments (mirrors CircularAnnotationLayer logic).
 * Returns a Map from annotation to row index.
 */
const annotationRowAssignments = computed(() => {
  const annotations = circularAnnotations?.value || []
  if (annotations.length === 0) return new Map()

  // Sort by span length (widest first)
  const sorted = [...annotations].sort((a, b) => {
    const aLen = getSpanLength(a)
    const bLen = getSpanLength(b)
    return bLen - aLen
  })

  const rows = []
  const assignments = new Map()

  for (const annotation of sorted) {
    const span = annotation.span
    if (!span || !span.ranges || span.ranges.length === 0) continue

    const bounds = span.bounds
    const start = bounds.start
    const end = bounds.end

    // Find first row without overlap
    let placedRow = -1
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      let hasOverlap = false
      for (const placed of rows[rowIdx]) {
        if (rangesOverlap(start, end, placed.start, placed.end)) {
          hasOverlap = true
          break
        }
      }
      if (!hasOverlap) {
        placedRow = rowIdx
        break
      }
    }

    if (placedRow === -1) {
      placedRow = rows.length
      rows.push([])
    }

    rows[placedRow].push({ start, end, annotation })
    assignments.set(annotation, placedRow)
  }

  return assignments
})

function getSpanLength(annotation) {
  if (!annotation.span || !annotation.span.ranges) return 0
  return annotation.span.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
}

function rangesOverlap(start1, end1, start2, end2) {
  return start1 < end2 && end1 > start2
}

/**
 * Check if an angle falls within an angular range.
 * Handles wraparound at 2π.
 */
function isAngleInRange(angle, rangeStart, rangeEnd) {
  const TWO_PI = 2 * Math.PI
  // Normalize all angles to [0, 2π)
  angle = ((angle % TWO_PI) + TWO_PI) % TWO_PI
  rangeStart = ((rangeStart % TWO_PI) + TWO_PI) % TWO_PI
  rangeEnd = ((rangeEnd % TWO_PI) + TWO_PI) % TWO_PI

  if (rangeStart <= rangeEnd) {
    // Normal range (doesn't wrap around 0)
    return angle >= rangeStart && angle <= rangeEnd
  } else {
    // Range wraps around 0
    return angle >= rangeStart || angle <= rangeEnd
  }
}

/**
 * Check if two angular ranges overlap.
 */
function angularRangesOverlap(start1, end1, start2, end2) {
  // Check if any endpoint of one range is within the other range
  return isAngleInRange(start2, start1, end1) ||
         isAngleInRange(end2, start1, end1) ||
         isAngleInRange(start1, start2, end2) ||
         isAngleInRange(end1, start2, end2)
}

/**
 * Get the maximum annotation row at a given position.
 * Returns -1 if no annotations at this position.
 */
function getMaxRowAtPosition(position) {
  const annotations = circularAnnotations?.value || []
  const assignments = annotationRowAssignments.value
  let maxRow = -1

  for (const annotation of annotations) {
    const span = annotation.span
    if (!span || !span.ranges) continue

    // Check if position is within any range of this annotation
    for (const range of span.ranges) {
      if (position >= range.start && position < range.end) {
        const row = assignments.get(annotation)
        if (row !== undefined && row > maxRow) {
          maxRow = row
        }
        break
      }
    }
  }

  return maxRow
}

/**
 * Get the maximum annotation row within an angular sector.
 * Returns -1 if no annotations overlap with this sector.
 */
function getMaxRowInSector(sectorStart, sectorEnd) {
  if (!circularGraphics) return -1

  const annotations = circularAnnotations?.value || []
  const assignments = annotationRowAssignments.value
  let maxRow = -1

  for (const annotation of annotations) {
    const span = annotation.span
    if (!span || !span.bounds) continue

    // Get annotation's angular extent
    const annStart = circularGraphics.positionToAngle(span.bounds.start)
    const annEnd = circularGraphics.positionToAngle(span.bounds.end)

    // Check if the label sector overlaps with this annotation's angular range
    if (angularRangesOverlap(sectorStart, sectorEnd, annStart, annEnd)) {
      const row = assignments.get(annotation)
      if (row !== undefined && row > maxRow) {
        maxRow = row
      }
    }
  }

  return maxRow
}

// Compute marker elements with leader line layout
const markersWithLayout = computed(() => {
  if (!shouldRender.value || !circularGraphics) return []

  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const annotationHeight = circularGraphics.annotationHeight?.value || 14

  // Radius where labels will be placed (for angular width calculation)
  const baseRadius = backboneRadius + LEADER_GAP + LEADER_LENGTH

  // First pass: create basic marker data with angular extents
  const markers = []
  for (let i = 0; i < cutSites.value.length; i++) {
    const site = cutSites.value[i]
    const position = site.position
    const angle = circularGraphics.positionToAngle(position)

    // Calculate angular half-width based on estimated text width
    const textWidth = site.enzyme.length * ESTIMATED_CHAR_WIDTH
    const angularHalfWidth = (textWidth / 2 + LABEL_PADDING / 2) / baseRadius

    markers.push({
      id: `${site.enzyme}-${i}`,
      enzyme: site.enzyme,
      position,
      angle,
      labelAngle: angle,  // Start at ideal position
      angularHalfWidth
    })
  }

  // Sort by angle for collision detection
  markers.sort((a, b) => a.angle - b.angle)

  // Second pass: iterative relaxation to resolve overlaps globally
  // This handles both within-cluster and between-cluster collisions
  if (markers.length > 1) {
    const maxIterations = 50
    const TWO_PI = 2 * Math.PI

    for (let iter = 0; iter < maxIterations; iter++) {
      let maxOverlap = 0

      for (let i = 0; i < markers.length; i++) {
        const curr = markers[i]
        const nextIdx = (i + 1) % markers.length
        const next = markers[nextIdx]

        // Calculate gap between current label's right edge and next label's left edge
        let gap
        if (nextIdx === 0) {
          // Wraparound: next is the first marker
          gap = (next.labelAngle + TWO_PI) - curr.labelAngle - curr.angularHalfWidth - next.angularHalfWidth
        } else {
          gap = next.labelAngle - curr.labelAngle - curr.angularHalfWidth - next.angularHalfWidth
        }

        if (gap < 0) {
          // Overlap detected - push labels apart symmetrically
          const overlap = -gap
          maxOverlap = Math.max(maxOverlap, overlap)
          const push = overlap / 2 + 0.001 // Small epsilon to ensure separation
          curr.labelAngle -= push
          next.labelAngle += push
        }
      }

      // Normalize angles to [0, 2π)
      for (const marker of markers) {
        marker.labelAngle = ((marker.labelAngle % TWO_PI) + TWO_PI) % TWO_PI
      }

      // Re-sort by labelAngle to maintain order after adjustments
      markers.sort((a, b) => a.labelAngle - b.labelAngle)

      // Converged if no significant overlaps
      if (maxOverlap < 0.001) break
    }
  }

  // Third pass: calculate all geometry
  const result = []
  for (const marker of markers) {
    const { angle, labelAngle, angularHalfWidth, enzyme, id, position } = marker

    // Calculate radius at the root (cut position)
    const maxRowAtRoot = getMaxRowAtPosition(position)
    let rootRadius = backboneRadius
    if (maxRowAtRoot >= 0) {
      const rowRadius = circularGraphics.getRowRadius(maxRowAtRoot)
      rootRadius = rowRadius + annotationHeight / 2
    }

    // Calculate the angular sector this label occupies (after relaxation)
    const sectorStart = labelAngle - angularHalfWidth
    const sectorEnd = labelAngle + angularHalfWidth

    // Find the maximum annotation row across the label's sector
    const maxRowInSector = getMaxRowInSector(sectorStart, sectorEnd)
    let sectorRadius = backboneRadius
    if (maxRowInSector >= 0) {
      const rowRadius = circularGraphics.getRowRadius(maxRowInSector)
      sectorRadius = rowRadius + annotationHeight / 2
    }

    // Label radius is the max of root and sector (can't dip below either)
    const labelOutermostRadius = Math.max(rootRadius, sectorRadius)

    // Tick mark through backbone
    const tickInner = polarToCartesian(cx, cy, backboneRadius - TICK_LENGTH / 2, angle)
    const tickOuter = polarToCartesian(cx, cy, backboneRadius + TICK_LENGTH / 2, angle)

    // Leader line: starts at root position, outside its local annotation layer
    const leaderStart = polarToCartesian(cx, cy, rootRadius + LEADER_GAP, angle)

    // Label uses the max radius (never dips below root or sector)
    const leaderEndRadius = labelOutermostRadius + LEADER_GAP + LEADER_LENGTH
    const leaderEnd = polarToCartesian(cx, cy, leaderEndRadius, labelAngle)

    // Determine if leader connects from above or below the horizontal line
    // If leader comes from above (start.y < end.y), text goes below (overline)
    // If leader comes from below (start.y > end.y), text goes above (underline)
    const leaderFromAbove = leaderStart.y < leaderEnd.y

    // Horizontal line Y position (at leader end)
    const hLineY = leaderEnd.y

    // Label position: horizontal text, centered on the horizontal line
    const labelX = leaderEnd.x
    const labelY = leaderFromAbove
      ? hLineY + TEXT_OFFSET  // Leader from above → text below (overline)
      : hLineY - TEXT_OFFSET  // Leader from below → text above (underline)

    // Text is always horizontal, centered
    const textAnchor = 'middle'
    const dominantBaseline = leaderFromAbove ? 'hanging' : 'auto'

    result.push({
      id,
      enzyme,
      position,
      tickInner,
      tickOuter,
      leaderStart,
      leaderEnd,
      hLineY,
      labelX,
      labelY,
      textAnchor,
      dominantBaseline
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

      <!-- Leader line (from outer annotation layer to horizontal line) -->
      <path
        :d="`M ${marker.leaderStart.x} ${marker.leaderStart.y} L ${marker.leaderEnd.x} ${marker.leaderEnd.y}`"
        stroke="black"
        stroke-width="1"
        fill="none"
      />

      <!-- Enzyme name label (horizontal) - rendered first to measure -->
      <text
        :ref="el => { if (el) textRefs[marker.id] = el }"
        :x="marker.labelX"
        :y="marker.labelY"
        :text-anchor="marker.textAnchor"
        :dominant-baseline="marker.dominantBaseline"
        class="enzyme-label"
      >
        {{ marker.enzyme }}
      </text>

      <!-- Horizontal connector line (overline below center, underline above) -->
      <line
        v-if="getTextWidth(marker.id) > 0"
        :x1="marker.labelX - getTextWidth(marker.id) / 2"
        :y1="marker.hLineY"
        :x2="marker.labelX + getTextWidth(marker.id) / 2"
        :y2="marker.hLineY"
        stroke="black"
        stroke-width="1"
      />
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
