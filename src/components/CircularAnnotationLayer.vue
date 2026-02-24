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
