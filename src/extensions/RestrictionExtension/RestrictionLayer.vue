<script setup>
import { inject, computed, ref, watch, onUnmounted } from 'vue'
import { restrictionSitesVisible, cutSites, setSequence } from './state.js'

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const extensionAPI = inject('extensionAPI')

// Height for a single restriction label row (T-bar + label + padding)
const LABEL_ROW_HEIGHT = 15
// Approximate width of a label for collision detection
const LABEL_HALF_WIDTH = 25

// Track which lines we've contributed height to (for cleanup)
const previousContributedLines = ref(new Set())

// Update sequence when it changes
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

// Convert cut sites to renderable markers with pixel positions and row assignments
const markersWithLayout = computed(() => {
  if (!shouldRender.value || !graphics?.metrics?.value || !editorState) return { markers: [], heightsByLine: new Map() }

  const m = graphics.metrics.value
  const zoom = editorState.zoomLevel.value
  const textMode = m.textMode

  // First pass: compute basic marker info grouped by line
  const markersByLine = new Map()

  for (let index = 0; index < cutSites.value.length; index++) {
    const site = cutSites.value[index]
    const lineIndex = Math.floor(site.position / zoom)
    const posInLine = site.position % zoom
    const x = m.lmargin + posInLine * m.charWidth

    // Calculate overhang positions
    const overhangStartInLine = site.overhangStart % zoom
    const overhangEndInLine = site.overhangEnd % zoom
    const overhangX1 = m.lmargin + overhangStartInLine * m.charWidth
    const overhangX2 = m.lmargin + overhangEndInLine * m.charWidth
    const overhangLineStart = Math.floor(site.overhangStart / zoom)
    const overhangLineEnd = Math.floor((site.overhangEnd - 1) / zoom)
    const overhangOnSameLine = overhangLineStart === lineIndex && overhangLineEnd === lineIndex

    const marker = {
      id: `${site.enzyme}-${index}`,
      x,
      lineIndex,
      enzyme: site.enzyme,
      position: site.position,
      strand: site.strand,
      showOverhang: textMode && overhangOnSameLine && site.overhangStart !== site.overhangEnd,
      overhangX1,
      overhangX2,
      // Bounding box for label collision detection
      labelLeft: x - LABEL_HALF_WIDTH,
      labelRight: x + LABEL_HALF_WIDTH,
      row: 0  // Will be assigned by collision detection
    }

    if (!markersByLine.has(lineIndex)) {
      markersByLine.set(lineIndex, [])
    }
    markersByLine.get(lineIndex).push(marker)
  }

  // Second pass: collision detection to assign rows within each line
  const heightsByLine = new Map()

  for (const [lineIndex, lineMarkers] of markersByLine) {
    // Sort markers by x position
    lineMarkers.sort((a, b) => a.x - b.x)

    // Track occupied ranges per row: Array of arrays of {left, right}
    const rows = []

    for (const marker of lineMarkers) {
      // Find the first row where this marker doesn't overlap
      let placedRow = -1
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        let hasOverlap = false
        for (const placed of rows[rowIdx]) {
          // Check if labels overlap (with some margin)
          if (!(marker.labelRight < placed.left || marker.labelLeft > placed.right)) {
            hasOverlap = true
            break
          }
        }
        if (!hasOverlap) {
          placedRow = rowIdx
          break
        }
      }

      // If no existing row works, create a new one
      if (placedRow === -1) {
        placedRow = rows.length
        rows.push([])
      }

      // Place marker in this row
      rows[placedRow].push({ left: marker.labelLeft, right: marker.labelRight })
      marker.row = placedRow
    }

    // Height for this line = number of rows * row height
    const numRows = rows.length
    heightsByLine.set(lineIndex, numRows * LABEL_ROW_HEIGHT)
  }

  // Flatten markers back to array
  const allMarkers = []
  for (const lineMarkers of markersByLine.values()) {
    allMarkers.push(...lineMarkers)
  }

  return { markers: allMarkers, heightsByLine, markersByLine }
})

// Report height contributions to graphics system
watch(
  () => markersWithLayout.value,
  ({ heightsByLine }) => {
    if (!graphics?.setLineExtraHeight) return

    const currentLines = new Set()

    if (shouldRender.value) {
      // Set height for lines with markers
      for (const [lineIndex, height] of heightsByLine) {
        graphics.setLineExtraHeight(lineIndex, height, 'restriction')
        currentLines.add(lineIndex)
      }
    }

    // Clear lines we no longer contribute to
    for (const lineIndex of previousContributedLines.value) {
      if (!currentLines.has(lineIndex)) {
        graphics.setLineExtraHeight(lineIndex, 0, 'restriction')
      }
    }

    previousContributedLines.value = currentLines
  },
  { immediate: true }
)

// Cleanup on unmount
onUnmounted(() => {
  if (graphics?.setLineExtraHeight) {
    for (const lineIndex of previousContributedLines.value) {
      graphics.setLineExtraHeight(lineIndex, 0, 'restriction')
    }
  }
})

// Line height for positioning
const lineHeight = computed(() => graphics?.lineHeight?.value || 16)

// Get the Y position for a marker's T-bar and label
// Restriction markers sit at the TOP of the extra height area (above annotations)
function getMarkerY(marker) {
  const lineY = graphics?.getLineY?.(marker.lineIndex) || 0
  const totalExtraHeight = graphics?.lineExtraHeight?.value?.get(marker.lineIndex) || 0
  const restrictionHeight = graphics?.getLineExtraHeightForSource?.(marker.lineIndex, 'restriction') || 0

  // Annotations occupy the bottom portion of extra height (from lineY upward)
  // Restriction markers occupy the top portion
  // Position this marker based on its row (row 0 is closest to annotations)
  const annotationHeight = totalExtraHeight - restrictionHeight
  const rowOffset = marker.row * LABEL_ROW_HEIGHT

  // T-bar Y position: above annotations, offset by row
  return lineY - annotationHeight - rowOffset - 4
}

// Get line Y for overhang rendering
function getLineY(lineIndex) {
  return graphics?.getLineY?.(lineIndex) || 0
}
</script>

<template>
  <g v-if="shouldRender" class="restriction-layer">
    <g
      v-for="marker in markersWithLayout.markers"
      :key="marker.id"
      class="cut-site-marker"
    >
      <!-- Vertical cut line (extends through DNA sequence, ends at horizontal T) -->
      <line
        :x1="marker.x"
        :y1="getLineY(marker.lineIndex) + lineHeight"
        :x2="marker.x"
        :y2="getMarkerY(marker)"
        stroke="black"
        stroke-width="1"
      />

      <!-- Horizontal T-bar -->
      <line
        :x1="marker.x - 10"
        :y1="getMarkerY(marker)"
        :x2="marker.x + 10"
        :y2="getMarkerY(marker)"
        stroke="black"
        stroke-width="1"
      />

      <!-- Enzyme name label (above the T-bar) -->
      <text
        :x="marker.x"
        :y="getMarkerY(marker) - 4"
        text-anchor="middle"
        class="enzyme-label"
      >
        {{ marker.enzyme }}
      </text>

      <!-- Overhang underline (text mode only) -->
      <line
        v-if="marker.showOverhang"
        :x1="marker.overhangX1"
        :y1="getLineY(marker.lineIndex) + lineHeight - 1"
        :x2="marker.overhangX2"
        :y2="getLineY(marker.lineIndex) + lineHeight - 1"
        stroke="black"
        stroke-width="2"
      />

      <!-- Stub at far end indicating opposing strand cut -->
      <line
        v-if="marker.showOverhang"
        :x1="marker.x === marker.overhangX1 ? marker.overhangX2 : marker.overhangX1"
        :y1="getLineY(marker.lineIndex) + lineHeight - 1"
        :x2="marker.x === marker.overhangX1 ? marker.overhangX2 : marker.overhangX1"
        :y2="getLineY(marker.lineIndex) + lineHeight + 3"
        stroke="black"
        stroke-width="1"
      />
    </g>
  </g>
</template>

<style scoped>
.restriction-layer {
  pointer-events: none;
}

.enzyme-label {
  font-size: 10px;
  font-family: system-ui, -apple-system, sans-serif;
  fill: black;
}
</style>
