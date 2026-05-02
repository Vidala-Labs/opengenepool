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

// Handle context menu on match line
function handleContextMenu(event, lineIndex) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', { event, lineIndex })
}

// Get menu items for element (called by parent when building context menu)
function getMenuItemsForElement(dataset) {
  // Only provide menu items for the match layer
  if (dataset.layer !== 'alignment-match') return []

  // getAlignmentMenuItems is called by the parent with the click position
  // We return empty here since the parent handles computing aligned position
  return []
}

defineExpose({
  getMenuItemsForElement
})
</script>

<template>
  <g v-if="isAlignmentMode" class="alignment-ticks-layer">
    <g
      v-for="line in alignmentLines"
      :key="'ticks-' + line.index"
      :transform="`translate(0, ${alignmentTopPadding + line.index * alignmentBlockHeight + lineHeight})`"
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

      <!-- Match line text (only in text mode) -->
      <g :transform="`translate(${metrics.lmargin}, 0)`">
        <text
          v-if="isTextMode"
          x="0"
          :y="lineHeight / 2"
          dominant-baseline="middle"
          class="sequence-text alignment-match-text"
          :style="{ letterSpacing }"
        >{{ preserveSpaces(line.matchText) }}</text>

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
