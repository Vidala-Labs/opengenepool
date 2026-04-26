<script setup>
import { computed, inject, ref, onMounted, onUnmounted } from 'vue'
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
const regionRegistry = inject('regionRegistry', null)

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
function handleClick(event, element) {
  event.stopPropagation()
  emit('click', { event, annotation: element.annotation })
  circularAnnotations.handleClick(element.annotation, event)
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
// Region Registry Integration
// ============================================

// Generate unique layer ID for this instance
const layerId = `circular-annotation-layer-${Math.random().toString(36).substr(2, 9)}`

// Computed regions for registry - uses polar coordinates (theta, r)
const regions = computed(() => {
  if (!showAnnotations.value) return []

  const result = []
  const seqLen = editorState.sequenceLength.value
  if (!seqLen) return []

  for (const element of annotationElements.value) {
    const annotation = element.annotation
    if (!annotation?.span?.ranges) continue

    // Each annotation may span multiple ranges
    for (const range of annotation.span.ranges) {
      // Convert sequence positions to angles
      const startTheta = (range.start / seqLen) * 2 * Math.PI
      const endTheta = (range.end / seqLen) * 2 * Math.PI
      const dTheta = endTheta - startTheta

      // Get radial position from element
      const r = element.innerRadius ?? circularGraphics.annotationInnerRadius.value
      const dR = element.trackWidth ?? circularGraphics.annotationTrackWidth.value

      result.push({
        id: `circ-ann-${annotation.id}-${range.start}`,
        bounds: {
          theta: startTheta,
          r,
          dTheta: dTheta > 0 ? dTheta : 2 * Math.PI + dTheta,  // Handle wrap-around
          dR
        },
        zIndex: 10,
        metadata: {
          annotation,
          element
        }
      })
    }
  }

  return result
})

// Context menu items for circular annotation regions
function getContextMenuItems(regionId, metadata) {
  const { annotation } = metadata
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

// Register with region registry if available
onMounted(() => {
  if (regionRegistry) {
    regionRegistry.registerLayer({
      id: layerId,
      regions,
      getContextMenuItems
    })
  }
})

// Unregister on unmount
onUnmounted(() => {
  if (regionRegistry) {
    regionRegistry.unregisterLayer(layerId)
  }
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
      @click="handleClick($event, element)"
      @contextmenu="handleContextMenu($event, element)"
      @mouseenter="handleMouseEnter($event, element)"
      @mouseleave="handleMouseLeave($event, element)"
    >
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
