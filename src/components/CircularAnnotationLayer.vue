<script setup>
import { computed, inject, ref } from 'vue'
import { useCircularAnnotations } from '../composables/useCircularAnnotations.js'

const props = defineProps({
  /** Array of Annotation objects to render */
  annotations: {
    type: Array,
    default: () => []
  },
  /** Whether to show captions on annotations */
  showCaptions: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['click', 'contextmenu', 'hover'])

// Inject from parent
const editorState = inject('editorState')
const circularGraphics = inject('circularGraphics')
const annotationColors = inject('annotationColors', null)
const showAnnotations = inject('showAnnotations', ref(true))
const eventBus = inject('eventBus', null)

// Use the circular annotations composable
const circularAnnotations = useCircularAnnotations(
  editorState,
  circularGraphics,
  eventBus,
  { annotationColors }
)

// Sync props.annotations to composable
// Using a computed that updates the composable when props change
const annotationElements = computed(() => {
  circularAnnotations.setAnnotations(props.annotations)
  return circularAnnotations.getElements.value
})

// Delegate to composable methods
const { captionFits } = circularAnnotations

// Event handlers - emit to parent and delegate to composable
// Click handler for direct element clicks (routes to handleClickForElement)
function handleClick(event, element) {
  event.stopPropagation()  // Prevent bubbling to SVG
  const dataset = {
    layer: 'circular-annotation',
    annotationId: element.annotation?.id
  }
  handleClickForElement(dataset, event)
}

function handleContextMenu(event, element) {
  event.preventDefault()
  event.stopPropagation()
  emit('contextmenu', { event, annotation: element.annotation })
  circularAnnotations.handleContextMenu(element.annotation, event)
}

function handleMouseEnter(event, element) {
  emit('hover', { event, annotation: element.annotation, entering: true })
}

function handleMouseLeave(event, element) {
  emit('hover', { event, annotation: element.annotation, entering: false })
}

// ============================================
// Click/Context Menu Items via elementsFromPoint
// ============================================

/**
 * Handle click for an element with data attributes.
 * Called by parent editor when routing clicks via elementsFromPoint.
 *
 * @param {DOMStringMap} dataset - The element's dataset (data-* attributes)
 * @param {MouseEvent} event - The click event
 * @returns {boolean} True if the click was handled
 */
function handleClickForElement(dataset, event) {
  if (dataset.layer !== 'circular-annotation') return false

  const annotationId = dataset.annotationId
  if (!annotationId) return false

  // Find the annotation by ID
  const annotation = props.annotations.find(a => a.id === annotationId)
  if (!annotation) return false

  // Emit click event for parent to handle
  emit('click', { event, annotation })

  // TODO: Selection integration - could select annotation span here
  // For now, just return true to indicate handled
  return true
}

/**
 * Get context menu items for an element with data attributes.
 * Called by parent editor when element is found via elementsFromPoint.
 *
 * @param {DOMStringMap} dataset - The element's dataset (data-* attributes)
 * @returns {Array} Menu items for this element
 */
function getMenuItemsForElement(dataset) {
  if (dataset.layer !== 'circular-annotation') return []

  const annotationId = dataset.annotationId
  if (!annotationId) return []

  // Find the annotation by ID
  const annotation = props.annotations.find(a => a.id === annotationId)
  if (!annotation) return []

  return [
    {
      label: 'Edit Annotation',
      action: () => emit('contextmenu', { event: null, annotation, action: 'edit' })
    },
    {
      label: 'Delete Annotation',
      action: () => emit('contextmenu', { event: null, annotation, action: 'delete' })
    }
  ]
}

// Expose for click routing and context menu integration
defineExpose({
  handleClickForElement,
  getMenuItemsForElement
})
</script>

<template>
  <g v-if="showAnnotations" class="circular-annotation-layer">
    <!-- Define text paths for curved captions -->
    <defs>
      <path
        v-for="(element, idx) in annotationElements"
        :key="`def-${element.textPathId}`"
        :id="element.textPathId"
        :d="element.textArcPath"
        fill="none"
      />
    </defs>

    <g
      v-for="(element, idx) in annotationElements"
      :key="`ann-${element.annotation.id || idx}`"
      class="annotation"
      data-layer="circular-annotation"
      :data-annotation-id="element.annotation?.id"
      @click="handleClick($event, element)"
      @contextmenu="handleContextMenu($event, element)"
      @mouseenter="handleMouseEnter($event, element)"
      @mouseleave="handleMouseLeave($event, element)"
    >
      <!-- Tooltip (native browser tooltip via SVG title element) -->
      <title v-if="element.caption">{{ element.caption }}</title>

      <!-- Annotation arc path -->
      <path
        :d="element.path"
        :fill="element.color"
        fill-opacity="0.7"
        stroke="black"
        stroke-width="1"
        class="annotation-path"
      />

      <!-- Caption along the arc -->
      <text
        v-if="showCaptions && captionFits(element)"
        class="annotation-caption"
      >
        <textPath
          :href="`#${element.textPathId}`"
          startOffset="50%"
          text-anchor="middle"
          dominant-baseline="middle"
        >
          {{ element.caption }}
        </textPath>
      </text>
    </g>
  </g>
</template>

<style scoped>
.circular-annotation-layer {
  pointer-events: none;
}

.annotation {
  pointer-events: all;
  cursor: pointer;
}

.annotation:hover .annotation-path {
  fill-opacity: 0.9;
}

.annotation-caption {
  font-family: Arial, sans-serif;
  font-size: 9px;
  fill: black;
  pointer-events: none;
}
</style>
