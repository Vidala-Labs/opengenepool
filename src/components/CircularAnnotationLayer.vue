<script setup>
import { computed, inject, ref, watch, onMounted, onUnmounted } from 'vue'
import { useCircularAnnotations } from '../composables/useCircularAnnotations.js'
import {
  showAnnotations,
  hiddenTypes,
  showHiddenAnnotations,
  moduleConfigItems,
  setAnnotationTypesForSource,
  removeAnnotationTypeSource
} from './AnnotationLayer.vue'
import { isAnnotationHidden } from '../utils/annotation.js'
import { annotationMenuItems } from './menus/annotationMenuContributor.js'

const mountedCircularLayers = []
const circularLayersRevision = ref(0)

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

// Context-menu service + annotation actions (provided by CircularView)
const contextMenu = inject('contextMenu', null)
const annotationMenuActions = inject('annotationMenuActions', null)
const annotationContributor = {
  id: 'annotation',
  getItems: (context) => annotationMenuItems(context, annotationMenuActions || {})
}
onMounted(() => contextMenu?.register(annotationContributor))
onUnmounted(() => contextMenu?.unregister(annotationContributor))

// Track instance for first-instance config items (like AnnotationLayer)
let instanceId = null

onMounted(() => {
  instanceId = Symbol('circular-annotation-layer')
  mountedCircularLayers.push(instanceId)
  circularLayersRevision.value++
})

onUnmounted(() => {
  const index = mountedCircularLayers.indexOf(instanceId)
  if (index !== -1) mountedCircularLayers.splice(index, 1)
  circularLayersRevision.value++
  removeAnnotationTypeSource(annotationTypeSource)
})

// Keep the shared type filter in sync with current annotations without deeply
// traversing spans and metadata.
const annotationTypeSource = Symbol('circular-annotation-layer-types')
watch(
  () => props.annotations.map(annotation => annotation.type || 'misc_feature'),
  types => setAnnotationTypesForSource(annotationTypeSource, types),
  { immediate: true }
)

// Filter annotations based on hiddenTypes and per-annotation ogp:hidden
// (visibility state shared with AnnotationLayer)
const filteredAnnotations = computed(() => {
  if (!showAnnotations.value) return []
  return props.annotations.filter(a =>
    !hiddenTypes.value.has(a.type || 'misc_feature') &&
    (showHiddenAnnotations.value || !isAnnotationHidden(a))
  )
})

// Use the circular annotations composable
const circularAnnotations = useCircularAnnotations(
  editorState,
  circularGraphics,
  eventBus,
  { annotationColors }
)

// Sync filtered annotations when their inputs change. Keep this side effect out
// of the rendering computed below so unrelated render dependencies (such as
// annotation colors) don't repeatedly reset the composable's annotation state.
watch(filteredAnnotations, annotations => {
  circularAnnotations.setAnnotations(annotations)
}, { immediate: true })

const annotationElements = computed(() => {
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

// Config items for Toolbar (shared with AnnotationLayer)
// Only provide if we're the first instance to avoid duplicates
const configItems = computed(() => {
  circularLayersRevision.value
  if (mountedCircularLayers[0] !== instanceId) return []
  return moduleConfigItems.value
})

// Expose for click routing and config
defineExpose({
  handleClickForElement,
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
      :key="`ann-${element.annotation.id || idx}-${element.range.start}-${element.range.end}`"
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
