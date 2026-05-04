<script setup>
import { computed, inject, ref, watch, onMounted, onUnmounted } from 'vue'
import { useCircularAnnotations } from '../composables/useCircularAnnotations.js'
import { showAnnotations, hiddenTypes, allAnnotationTypes, moduleConfigItems } from './AnnotationLayer.vue'

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
const eventBus = inject('eventBus', null)

// Track instance for first-instance config items (like AnnotationLayer)
let isFirstInstance = false
let instanceId = null

onMounted(() => {
  // Register this instance and track if it's first
  instanceId = Symbol('circular-annotation-layer')
  if (!window.__circularAnnotationLayerFirst) {
    window.__circularAnnotationLayerFirst = instanceId
    isFirstInstance = true
  }

  // Register annotation types from our props
  registerAnnotationTypes()
})

onUnmounted(() => {
  // Clear first instance tracking if we were first
  if (window.__circularAnnotationLayerFirst === instanceId) {
    window.__circularAnnotationLayerFirst = null
  }
})

// Register annotation types in the shared allAnnotationTypes set
function registerAnnotationTypes() {
  const types = new Set(props.annotations.map(a => a.type || 'misc_feature'))
  types.forEach(t => allAnnotationTypes.value.add(t))
}

// Watch for annotation changes and register new types
watch(() => props.annotations, registerAnnotationTypes, { deep: true })

// Filter annotations based on hiddenTypes (shared with AnnotationLayer)
const filteredAnnotations = computed(() => {
  if (!showAnnotations.value) return []
  return props.annotations.filter(a => !hiddenTypes.value.has(a.type || 'misc_feature'))
})

// Use the circular annotations composable
const circularAnnotations = useCircularAnnotations(
  editorState,
  circularGraphics,
  eventBus,
  { annotationColors }
)

// Sync filtered annotations to composable
// Using a computed that updates the composable when filtered annotations change
const annotationElements = computed(() => {
  circularAnnotations.setAnnotations(filteredAnnotations.value)
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

// Config items for Toolbar (shared with AnnotationLayer)
// Only provide if we're the first instance to avoid duplicates
const configItems = computed(() => {
  if (!isFirstInstance) return []
  return moduleConfigItems.value
})

// Expose for click routing, context menu integration, and config
defineExpose({
  handleClickForElement,
  getMenuItemsForElement,
  configItems
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
