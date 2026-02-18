<script setup>
import { computed, inject, watch, ref } from 'vue'
import { Orientation } from '../utils/dna.js'
import { useAnnotations, generateArrowPath } from '../composables/useAnnotations.js'

// Height reserved for translation display (must match useAnnotations)
const TRANSLATION_HEIGHT = 18

// Inject shared visibility state from parent
const showAnnotations = inject('showAnnotations', ref(true))

// Display visibility - derived from shared state
const visible = computed(() => showAnnotations.value)

const props = defineProps({
  /** Array of Annotation objects to render */
  annotations: {
    type: Array,
    default: () => []
  },
  /** Vertical offset from top of each line */
  offsetY: {
    type: Number,
    default: 0
  },
  /** Height of annotation bars */
  height: {
    type: Number,
    default: 16
  },
  /** Whether to show captions on annotations */
  showCaptions: {
    type: Boolean,
    default: true
  },
  /** Whether to show translation for CDS annotations (reserves extra space) */
  showTranslation: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['click', 'contextmenu', 'hover'])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const eventBus = inject('eventBus', null)
// Annotation colors from localStorage (provided by SequenceEditor)
const annotationColors = inject('annotationColors', null)

// Default colors used when not provided via inject (e.g., in tests)
const DEFAULT_COLORS = {
  gene: '#4CAF50',
  CDS: '#2196F3',
  promoter: '#FF9800',
  terminator: '#F44336',
  misc_feature: '#9E9E9E',
  rep_origin: '#9C27B0',
  origin: '#9C27B0',
  primer_bind: '#00BCD4',
  protein_bind: '#795548',
  regulatory: '#FFEB3B',
  source: '#B0BEC5',
  _default: '#607D8B'
}

// Get color for an annotation type from persisted colors or defaults
function getTypeColor(type) {
  const colors = annotationColors?.value || DEFAULT_COLORS
  return colors[type] || colors._default
}

// Use annotations composable for layout calculations
// Pass showTranslation as a computed so CDS annotations can reserve extra space
const showTranslationRef = computed(() => props.showTranslation)
const annotationsComposable = useAnnotations(editorState, graphics, eventBus, {
  showTranslation: showTranslationRef
})

// Watch for annotation prop changes
watch(() => props.annotations, (newAnnotations) => {
  annotationsComposable.setAnnotations(newAnnotations)
}, { immediate: true })

// Settings for arrow path generation
const blockWidth = 8
const arrowEdge = 2

// Calculate text x position - nudge right for minus strand arrows
function getCaptionX(element) {
  const baseOffset = 4
  // If this fragment has a left-pointing arrow (minus strand at start), nudge text right
  if (element.fragment.orientation === Orientation.MINUS && element.fragment.isStart) {
    return element.left + blockWidth + baseOffset
  }
  return element.left + baseOffset
}

// Check if caption fits within the arrow
// Estimates ~7px per character for 12px font, plus padding for arrow points
function captionFits(element) {
  const caption = element.fragment.caption
  if (!caption) return false

  const arrowWidth = element.right - element.left
  const estimatedTextWidth = caption.length * 7  // ~7px per char at 12px font
  const padding = 8  // padding on both sides

  // Account for arrow point taking up space
  let availableWidth = arrowWidth - padding
  if (element.fragment.orientation === Orientation.PLUS && element.fragment.isEnd) {
    availableWidth -= blockWidth  // right arrow takes space
  }
  if (element.fragment.orientation === Orientation.MINUS && element.fragment.isStart) {
    availableWidth -= blockWidth  // left arrow takes space
  }

  return estimatedTextWidth <= availableWidth
}

// Use the composable's laid-out elements (with collision detection applied)
const elementsByLine = computed(() => {
  return annotationsComposable.getElementsByLine.value
})

// Lines that have annotations
const lines = computed(() => {
  return Array.from(elementsByLine.value.keys()).sort((a, b) => a - b)
})

// For backward compatibility - expose fragments
const fragments = computed(() => {
  const allFragments = []
  for (const elements of elementsByLine.value.values()) {
    for (const elem of elements) {
      allFragments.push(elem.fragment)
    }
  }
  return allFragments
})

const fragmentsByLine = computed(() => {
  const byLine = new Map()
  for (const [line, elements] of elementsByLine.value) {
    byLine.set(line, elements.map(e => e.fragment))
  }
  return byLine
})

// Calculate x position for a fragment
function getFragmentX(fragment) {
  return graphics.metrics.value.lmargin + fragment.start * graphics.metrics.value.charWidth
}

// Calculate width for a fragment
function getFragmentWidth(fragment) {
  return fragment.width * graphics.metrics.value.charWidth
}

// Get y position for a line
function getLineY(lineIndex) {
  return graphics.getLineY(lineIndex)
}

// Generate full arrow-shaped path for fragment (like original)
function getFullArrowPath(fragment) {
  const x = getFragmentX(fragment)
  const width = getFragmentWidth(fragment)
  const h = props.height

  // Determine if this fragment should show directional arrow
  let orientation = Orientation.NONE
  if (fragment.orientation === Orientation.PLUS && fragment.isEnd) {
    orientation = Orientation.PLUS
  } else if (fragment.orientation === Orientation.MINUS && fragment.isStart) {
    orientation = Orientation.MINUS
  }

  return generateArrowPath({
    left: x,
    right: x + width,
    height: h,
    blockWidth,
    arrowEdge,
    orientation
  })
}

// Generate arrow path for directional annotations (legacy small arrow overlay)
function getArrowPath(fragment) {
  const x = getFragmentX(fragment)
  const width = getFragmentWidth(fragment)
  const h = props.height
  const arrowSize = Math.min(8, h / 2)

  if (fragment.orientation === Orientation.PLUS && fragment.isEnd) {
    // Arrow pointing right at end
    const endX = x + width
    return `M ${endX - arrowSize} 0 L ${endX} ${h / 2} L ${endX - arrowSize} ${h} L ${endX - arrowSize} 0`
  } else if (fragment.orientation === Orientation.MINUS && fragment.isStart) {
    // Arrow pointing left at start
    return `M ${x + arrowSize} 0 L ${x} ${h / 2} L ${x + arrowSize} ${h} L ${x + arrowSize} 0`
  }
  return null
}

// Event handlers
function handleClick(event, fragment) {
  event.stopPropagation()  // Prevent bubbling to SVG mousedown
  emit('click', { event, annotation: fragment.annotation, fragment })
}

function handleContextMenu(event, fragment) {
  event.preventDefault()
  emit('contextmenu', { event, annotation: fragment.annotation, fragment })
}

function handleMouseEnter(event, fragment) {
  emit('hover', { event, annotation: fragment.annotation, fragment, entering: true })
}

function handleMouseLeave(event, fragment) {
  emit('hover', { event, annotation: fragment.annotation, fragment, entering: false })
}

// Computed: Map annotation ID to deltaY for translation positioning
const annotationDeltaYByLine = computed(() => {
  const result = new Map()
  for (const [lineIndex, elements] of elementsByLine.value) {
    const lineMap = new Map()
    for (const elem of elements) {
      // Use the annotation ID from the fragment
      const annotationId = elem.fragment.annotation?.id
      if (annotationId) {
        lineMap.set(annotationId, elem.deltaY)
      }
    }
    result.set(lineIndex, lineMap)
  }
  return result
})

// Computed: Generate gradient definitions for fragments with indefinite locations
const indefiniteGradients = computed(() => {
  const gradients = []
  for (const elements of elementsByLine.value.values()) {
    for (const elem of elements) {
      const frag = elem.fragment
      if (frag.startIndefinite || frag.endIndefinite) {
        const color = getTypeColor(frag.type)
        const id = `grad-${frag.annotation?.id}-${frag.line}-${frag.start}`

        // Build gradient stops
        const stops = []
        if (frag.startIndefinite && frag.endIndefinite) {
          // Both ends indefinite: fade in from left, fade out to right
          stops.push({ offset: '0%', color, opacity: 0 })
          stops.push({ offset: '20%', color, opacity: 0.7 })
          stops.push({ offset: '80%', color, opacity: 0.7 })
          stops.push({ offset: '100%', color, opacity: 0 })
        } else if (frag.startIndefinite) {
          // Start indefinite: fade in from left
          stops.push({ offset: '0%', color, opacity: 0 })
          stops.push({ offset: '30%', color, opacity: 0.7 })
          stops.push({ offset: '100%', color, opacity: 0.7 })
        } else {
          // End indefinite: fade out to right
          stops.push({ offset: '0%', color, opacity: 0.7 })
          stops.push({ offset: '70%', color, opacity: 0.7 })
          stops.push({ offset: '100%', color, opacity: 0 })
        }

        gradients.push({ id, stops, element: elem })
      }
    }
  }
  return gradients
})

// Get fill for an element - gradient if indefinite, solid color otherwise
function getElementFill(element) {
  const frag = element.fragment
  if (frag.startIndefinite || frag.endIndefinite) {
    const id = `grad-${frag.annotation?.id}-${frag.line}-${frag.start}`
    return `url(#${id})`
  }
  return getTypeColor(frag.type)
}

// Get opacity for element - 1 for gradient (opacity in gradient), 0.7 for solid
function getElementOpacity(element) {
  const frag = element.fragment
  if (frag.startIndefinite || frag.endIndefinite) {
    return 1  // Opacity is handled in gradient stops
  }
  return 0.7
}

// Expose for testing and visibility control
defineExpose({
  showAnnotations,
  visible,
  fragments,
  fragmentsByLine,
  getFragmentX,
  getFragmentWidth,
  annotationDeltaYByLine
})
</script>

<template>
  <g v-if="visible" class="annotation-layer">
    <!-- Gradient definitions for indefinite annotations -->
    <defs>
      <linearGradient
        v-for="grad in indefiniteGradients"
        :key="grad.id"
        :id="grad.id"
        x1="0%"
        y1="0%"
        x2="100%"
        y2="0%"
      >
        <stop
          v-for="(stop, idx) in grad.stops"
          :key="idx"
          :offset="stop.offset"
          :stop-color="stop.color"
          :stop-opacity="stop.opacity"
        />
      </linearGradient>
    </defs>

    <!-- Render annotations for each line -->
    <!-- Position at top of line so negative-Y arrows extend into space above -->
    <g
      v-for="lineIndex in lines"
      :key="`line-${lineIndex}`"
      :transform="`translate(0, ${getLineY(lineIndex)})`"
    >
      <!-- Each element on this line (with layout-computed deltaY) -->
      <!-- When translation space is reserved, offset visual up to leave room below for translation -->
      <g
        v-for="(element, elemIndex) in elementsByLine.get(lineIndex)"
        :key="`elem-${element.fragment.id}-${elemIndex}`"
        :class="['annotation-fragment', element.fragment.cssClass]"
        :transform="`translate(0, ${element.deltaY - (element.reserveTranslationSpace ? TRANSLATION_HEIGHT : 0)})`"
        @click="handleClick($event, element.fragment)"
        @contextmenu="handleContextMenu($event, element.fragment)"
        @mouseenter="handleMouseEnter($event, element.fragment)"
        @mouseleave="handleMouseLeave($event, element.fragment)"
      >
        <!-- Use pre-computed arrow path from layout, color/gradient based on indefinite state -->
        <path
          :d="element.path"
          :fill="getElementFill(element)"
          :opacity="getElementOpacity(element)"
          class="annotation-path"
        />

        <!-- Caption text (only shown if it fits within the arrow) -->
        <text
          v-if="showCaptions && captionFits(element)"
          :x="getCaptionX(element)"
          :y="-height / 2"
          dominant-baseline="middle"
          class="annotation-caption"
        >
          {{ element.fragment.caption }}
        </text>
      </g>
    </g>
  </g>
</template>

<style scoped>
.annotation-layer {
  pointer-events: none;
}

.annotation-fragment {
  pointer-events: all;
  cursor: pointer;
}

.annotation-fragment:hover .annotation-path {
  opacity: 0.9;
}

/* Annotation path style - fill color comes from inline style (persisted to localStorage) */
.annotation-path {
  stroke: black;
  stroke-width: 1px;
}

/* Caption style - matches original */
.annotation-caption {
  font-family: Arial, sans-serif;
  font-size: 12px;
  fill: black;
  pointer-events: none;
  text-anchor: start;
  user-select: none;
}
</style>
