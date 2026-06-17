<script setup>
import { inject, computed, ref } from 'vue'

const props = defineProps({
  /** Callback to get alignment-specific menu items (for gap/mutation annotation) */
  getAlignmentMenuItems: {
    type: Function,
    default: null
  }
})

const emit = defineEmits(['contextmenu'])

// Inject from parent SequenceEditor
const graphics = inject('graphics')

// Inject alignment state (provided by SequenceEditor when in alignment mode)
const isAlignmentMode = inject('isAlignmentMode', ref(false))
const alignmentLines = inject('alignmentLines', ref([]))
const alignmentBlockHeight = inject('alignmentBlockHeight', ref(0))
const alignmentTopPadding = inject('alignmentTopPadding', 0)
// Inject alignment line positioning function (provided by AlignmentEditor)
const getAlignmentLineY = inject('getAlignmentLineY', null)

// Get y position for a line (match row is 1 lineHeight below target)
function getLineY(lineIndex) {
  if (getAlignmentLineY) {
    return getAlignmentLineY(lineIndex) + lineHeight.value
  }
  return alignmentTopPadding + lineIndex * alignmentBlockHeight.value + lineHeight.value
}

// Metrics for positioning
const metrics = computed(() => graphics.metrics.value)
const lineHeight = computed(() => graphics.lineHeight.value)
const isTextMode = computed(() => metrics.value.textMode)

// Letter spacing for monospace text
const letterSpacing = computed(() => {
  const m = metrics.value
  return `${m.charWidth - m.blockWidth}px`
})

// Convert spaces to non-breaking spaces to prevent SVG whitespace collapse
function preserveSpaces(text) {
  return text ? text.replace(/ /g, '\u00A0') : text
}

// Match bar colors and dimensions
const MATCH_COLOR = '#888888'  // Grey for matches
const GAP_COLOR = '#FFEB3B'    // Yellow for gaps
const MUTATION_COLOR = '#F44336'  // Red for mutations
const ANNOTATION_HEIGHT = 18  // Height of match bar segments (same as annotation bars)

/**
 * Compute colored bar segments for zoomed-out match line.
 * Consolidates adjacent positions of the same type into segments.
 * @param {Object} line - The alignment line with targetText, queryText, matchText
 * @returns {Array|null} Array of segments [{x, width, color}, ...] or null
 */
function getMatchBarSegments(line) {
  if (isTextMode.value) return null
  if (!line.targetText || !line.queryText || !line.matchText) return null

  const charWidth = metrics.value.charWidth
  const segments = []
  let currentType = null
  let segmentStart = 0

  for (let i = 0; i <= line.targetText.length; i++) {
    let type = null

    if (i < line.targetText.length) {
      const targetChar = line.targetText[i]
      const queryChar = line.queryText[i]
      const matchChar = line.matchText[i]

      if (targetChar === '-' || queryChar === '-') {
        type = 'gap'
      } else if (matchChar === '|') {
        type = 'match'
      } else {
        type = 'mutation'
      }
    }

    // If type changed or we're at the end, close the current segment
    if (type !== currentType && currentType !== null) {
      let color
      switch (currentType) {
        case 'gap': color = GAP_COLOR; break
        case 'mutation': color = MUTATION_COLOR; break
        default: color = MATCH_COLOR; break
      }
      segments.push({
        x: segmentStart * charWidth,
        width: (i - segmentStart) * charWidth,
        color
      })
    }

    // Start a new segment
    if (type !== currentType) {
      currentType = type
      segmentStart = i
    }
  }

  return segments.length > 0 ? segments : null
}

// Handle context menu on match line — the parent (AlignmentEditor) resolves the
// aligned position and the alignment contributor supplies the gap/mutation items.
function handleContextMenu(event, lineIndex) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', { event, lineIndex })
}
</script>

<template>
  <g v-if="isAlignmentMode" class="alignment-ticks-layer">
    <g
      v-for="line in alignmentLines"
      :key="'ticks-' + line.index"
      :transform="`translate(0, ${getLineY(line.index)})`"
      class="alignment-ticks"
    >
      <!-- No label for match row -->
      <text
        :x="metrics.lmargin - 8"
        :y="lineHeight / 2"
        text-anchor="end"
        dominant-baseline="middle"
        class="position-label"
      ></text>

      <!-- Match line content -->
      <g :transform="`translate(${metrics.lmargin}, 0)`">
        <!-- Text mode: render match characters -->
        <text
          v-if="isTextMode"
          x="0"
          :y="lineHeight / 2"
          dominant-baseline="middle"
          class="sequence-text alignment-match-text"
          :style="{ letterSpacing }"
        >{{ preserveSpaces(line.matchText) }}</text>

        <!-- Bar mode: render colored segments for match/gap/mutation -->
        <template v-else-if="getMatchBarSegments(line)">
          <rect
            v-for="(seg, idx) in getMatchBarSegments(line)"
            :key="idx"
            :x="seg.x"
            :y="(lineHeight - ANNOTATION_HEIGHT) / 2"
            :width="seg.width"
            :height="ANNOTATION_HEIGHT"
            :fill="seg.color"
            class="match-bar-segment"
          />
        </template>

        <!-- Invisible overlay for context menu on gaps/mismatches -->
        <rect
          x="0"
          y="0"
          :width="line.matchText.length * metrics.charWidth"
          :height="lineHeight"
          class="alignment-match-overlay"
          data-layer="alignment-match"
          :data-line-index="line.index"
          :data-line-start="line.start"
          @contextmenu="handleContextMenu($event, line.index)"
        />
      </g>
    </g>
  </g>
</template>

<!--
  Styles for AlignmentTicksLayer elements are defined in SequenceEditor.vue
  using :deep() selectors to ensure consistent styling.
-->
