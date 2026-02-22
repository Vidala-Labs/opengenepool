<script setup>
import { computed, inject, watch, ref } from 'vue'
import { AA_THREE_LETTER, iterateCodons, iterateCodonFragments } from '../utils/translation.js'
import { Span, Orientation, iterateSequence } from '../utils/dna.js'

const props = defineProps({
  /** Array of CDS Annotation objects to translate */
  annotations: {
    type: Array,
    default: () => []
  },
  /** Height of the translation row in pixels */
  height: {
    type: Number,
    default: 18
  },
  /** Map of lineIndex -> Map of annotationId -> deltaY from AnnotationLayer */
  annotationDeltaYByLine: {
    type: Map,
    default: () => new Map()
  }
})

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const showTranslation = inject('showTranslation', ref(true))

// Minimum codon width (3 bases) needed to display amino acid letter (~8px for 12px font)
const MIN_CODON_WIDTH = 8

// Display visibility - show only when user wants it AND zoom level allows readable text
const visible = computed(() => {
  if (!showTranslation.value) return false
  const codonWidth = 3 * graphics.metrics.value.charWidth
  return codonWidth >= MIN_CODON_WIDTH
})

// Amino acid background colors (from codon table)
// Colors extracted from ~/codon_table/codon.svg
const AA_COLORS = {
  // Aromatic: Medium green
  W: '#66CC66', Y: '#66CC66', F: '#66CC66',
  // Hydrophobic/aliphatic: Light green
  L: '#99FF99', A: '#99FF99', V: '#99FF99', I: '#99FF99', M: '#99FF99',
  // Acidic + Cysteine: Orange/salmon
  E: '#FF9999', D: '#FF9999', C: '#FF9999',
  // Polar uncharged: Light magenta
  T: '#FFAAFF', N: '#FFAAFF', S: '#FFAAFF', Q: '#FFAAFF',
  // Basic/positively charged: Light purple
  K: '#BBBBFF', R: '#BBBBFF', H: '#BBBBFF',
  // Special structure: Yellow
  G: '#FFFF99', P: '#FFFF99',
  // Stop codon - medium grey (50% lighter than #444444)
  '*': '#A2A2A2'
}

// Get background color for an amino acid
function getAminoAcidColor(aminoAcid) {
  return AA_COLORS[aminoAcid] || '#FFFFFF'
}

// Chevron extension (quarter letter width)
const chevronExtension = computed(() => graphics.metrics.value.charWidth / 4)

// Generate chevron path for a component box
// orientation: 1 = plus strand (chevron points right), -1 = minus strand (chevron points left)
// leftEdge: 'chevron' or 'flat'
// rightEdge: 'chevron' or 'flat'
function getChevronPath(x, width, h, orientation, leftEdge, rightEdge) {
  const ext = chevronExtension.value

  if (orientation === 1) {
    // Plus strand: nose on right, fork on left
    const leftExt = leftEdge === 'chevron' ? ext : 0
    const rightExt = rightEdge === 'chevron' ? ext : 0
    return `M ${x - leftExt} 0 ` +              // top-left corner
           `L ${x + width} 0 ` +                // top-right edge
           `L ${x + width + rightExt} ${h / 2} ` + // right point (nose or flat)
           `L ${x + width} ${h} ` +             // bottom-right edge
           `L ${x - leftExt} ${h} ` +           // bottom-left corner
           `L ${x + leftExt} ${h / 2} ` +       // left indent (fork or flat)
           `Z`
  } else {
    // Minus strand: nose on left, fork on right
    const leftExt = leftEdge === 'chevron' ? ext : 0
    const rightExt = rightEdge === 'chevron' ? ext : 0
    return `M ${x} 0 ` +                        // top-left edge
           `L ${x + width + rightExt} 0 ` +     // top-right corner
           `L ${x + width - rightExt} ${h / 2} ` + // right indent (fork or flat)
           `L ${x + width + rightExt} ${h} ` +  // bottom-right corner
           `L ${x} ${h} ` +                     // bottom-left edge
           `L ${x - leftExt} ${h / 2} ` +       // left point (nose or flat)
           `Z`
  }
}

/**
 * Walk a CDS annotation and produce components using the translation iterators.
 * Each component represents a piece of a codon, bounded by segment or line boundaries.
 *
 * @param {Object} annotation - CDS annotation with span
 * @param {string} sequence - Full sequence string
 * @param {number} zoom - Bases per line
 * @returns {Array} Array of component objects
 */
function walkCDS(annotation, sequence, zoom) {
  // Parse span to get ranges
  const span = typeof annotation.span === 'string'
    ? Span.parse(annotation.span)
    : annotation.span

  if (!span || span.ranges.length === 0) return []

  // Get gene name for annotation metadata
  const geneName = annotation.attributes?.gene ||
                   annotation.attributes?.label ||
                   annotation.caption ||
                   annotation.attributes?.product ||
                   annotation.name ||
                   'Unknown'

  // Use the three-level iterator pipeline
  const bases = iterateSequence(span, sequence)
  const codons = [...iterateCodons(bases)]
  const rawComponents = [...iterateCodonFragments(codons, zoom)]

  // Enrich components with annotation metadata
  const isMinus = span.ranges[0].orientation === Orientation.MINUS
  const totalCodons = codons.length

  // Track which codon each component belongs to for aaIndex
  let currentCodonIdx = 0
  let componentsInCurrentCodon = 0

  return rawComponents.map((comp, idx) => {
    // Count components per codon to track amino acid index
    // Components from the same codon have the same aminoAcid
    if (idx > 0 && rawComponents[idx - 1].aminoAcid !== comp.aminoAcid) {
      currentCodonIdx++
      componentsInCurrentCodon = 0
    }
    componentsInCurrentCodon++

    // For display, show the actual amino acid position (1-based)
    // For minus strand, the amino acids are already in coding order (N to C terminus)
    // but displayed genomically left to right, so we reverse the index for display
    const displayAaIndex = isMinus
      ? totalCodons - currentCodonIdx
      : currentCodonIdx + 1

    // Map startEdge/endEdge (coding order) to left/right (visual position)
    // Plus strand: start is left, end is right
    // Minus strand: start is right, end is left
    // Use the fragment's own orientation, not the overall span orientation
    const fragIsMinus = comp.orientation === -1
    const left = fragIsMinus ? comp.endEdge : comp.startEdge
    const right = fragIsMinus ? comp.startEdge : comp.endEdge

    return {
      ...comp,
      left,
      right,
      annotationId: annotation.id,
      aaIndex: displayAaIndex,
      geneName
    }
  })
}

// Process all CDS annotations into components, grouped by line
const elementsByLine = computed(() => {
  const result = new Map()
  const zoom = editorState.zoomLevel.value
  const sequence = editorState.sequence.value

  if (!zoom || !sequence) return result

  for (const annotation of props.annotations) {
    // Only process CDS annotations
    if (annotation.type?.toUpperCase() !== 'CDS') continue

    const components = walkCDS(annotation, sequence, zoom)

    for (const comp of components) {
      if (!result.has(comp.lineIndex)) {
        result.set(comp.lineIndex, [])
      }
      result.get(comp.lineIndex).push(comp)
    }
  }

  return result
})

// Convert a component to pixel coordinates for rendering
function toPixels(comp) {
  const m = graphics.metrics.value
  const x = m.lmargin + comp.posInLine * m.charWidth
  const width = comp.width * m.charWidth
  return { x, width }
}

// Get the X position for the amino acid letter within a component
// For plus strand: letter index from left
// For minus strand: letter index from right (coding order is reversed visually)
function getLetterX(comp) {
  const m = graphics.metrics.value
  const baseX = m.lmargin + comp.posInLine * m.charWidth

  if (comp.orientation === -1) {
    // Minus strand: subtract from right edge
    // visual index = width - 1 - letter
    const visualIndex = comp.width - 1 - comp.letter
    return baseX + (visualIndex + 0.5) * m.charWidth
  } else {
    // Plus strand: add from left edge
    return baseX + (comp.letter + 0.5) * m.charWidth
  }
}

// Lines that have translation elements
const lines = computed(() => {
  return Array.from(elementsByLine.value.keys()).sort((a, b) => a - b)
})

// Get y position for a line (translation sits just above the sequence)
function getLineY(lineIndex) {
  return graphics.getLineY(lineIndex)
}

// Get deltaY for a specific annotation on a specific line
function getAnnotationDeltaY(lineIndex, annotationId) {
  const lineMap = props.annotationDeltaYByLine.get(lineIndex)
  if (lineMap) {
    return lineMap.get(annotationId) ?? 0
  }
  return 0
}

// Group elements by annotation ID for border rendering
function getAnnotationGroups(elements) {
  const groups = new Map()
  for (const elem of elements) {
    if (!groups.has(elem.annotationId)) {
      groups.set(elem.annotationId, [])
    }
    groups.get(elem.annotationId).push(elem)
  }
  return groups
}

const emit = defineEmits(['hover', 'click', 'contextmenu'])

// Get three-letter amino acid name
function getAaName(aa) {
  return AA_THREE_LETTER[aa] || aa
}

// Handle hover events - emit to parent like AnnotationLayer does
function handleMouseEnter(event, element) {
  const aaName = getAaName(element.aminoAcid)
  const aaLabel = element.aminoAcid === '*' ? 'Stop' : `${aaName}${element.aaIndex}`
  const tooltipText = `${element.geneName}: ${aaLabel} [${element.codon}]`

  emit('hover', {
    event,
    element,
    tooltipText,
    entering: true
  })
}

function handleMouseLeave(event, element) {
  emit('hover', {
    event,
    element,
    entering: false
  })
}

function handleClick(event, element) {
  event.stopPropagation()  // Prevent bubbling to SVG mousedown
  emit('click', {
    event,
    element,
    codonStart: element.codonStart,
    codonEnd: element.codonEnd
  })
}

// Get the full translation string for an annotation using the iterator pipeline
function getTranslationString(annotationId) {
  const annotation = props.annotations.find(a => a.id === annotationId)
  if (!annotation) return ''

  const sequence = editorState.sequence.value
  if (!sequence) return ''

  // Parse span
  const span = typeof annotation.span === 'string'
    ? Span.parse(annotation.span)
    : annotation.span

  if (!span || span.ranges.length === 0) return ''

  // Use the translation cache feature of iterateCodons
  // This produces amino acids in coding order (N-to-C terminus), which is
  // the correct order for copying translations regardless of strand
  const result = { aminoAcids: '' }
  const bases = iterateSequence(span, sequence)
  // Consume the iterator to populate result.aminoAcids
  for (const _ of iterateCodons(bases, result)) { /* just consume */ }

  return result.aminoAcids
}

// Handle right-click on translation
function handleContextMenu(event, element) {
  event.preventDefault()
  const translation = getTranslationString(element.annotationId)
  emit('contextmenu', { event, element, translation })
}

// Expose show and visible for parent to bind to
defineExpose({ showTranslation, visible })
</script>

<template>
  <g v-if="visible" class="translation-layer">
    <!-- Render translations for each line -->
    <g
      v-for="lineIndex in lines"
      :key="`line-${lineIndex}`"
      :transform="`translate(0, ${getLineY(lineIndex)})`"
    >
      <!-- Each annotation group positioned at its annotation's deltaY -->
      <g
        v-for="[annotationId, groupElements] in getAnnotationGroups(elementsByLine.get(lineIndex))"
        :key="`group-${annotationId}`"
        :transform="`translate(0, ${getAnnotationDeltaY(lineIndex, annotationId)})`"
      >
        <!-- Each component of an amino acid (components created at line/segment breaks) -->
        <g
          v-for="(comp, compIndex) in groupElements"
          :key="`aa-${comp.annotationId}-${comp.aaIndex}-${compIndex}`"
          :class="{ 'aa-element': comp.letter !== null }"
          @mouseenter="comp.letter !== null && handleMouseEnter($event, comp)"
          @mouseleave="comp.letter !== null && handleMouseLeave($event, comp)"
          @click="comp.letter !== null && handleClick($event, comp)"
          @contextmenu="handleContextMenu($event, comp)"
        >
          <!-- Component path (flat edges at breaks, chevrons elsewhere) -->
          <path
            :d="getChevronPath(toPixels(comp).x, toPixels(comp).width, height, comp.orientation, comp.left, comp.right)"
            :fill="getAminoAcidColor(comp.aminoAcid)"
            :transform="`translate(0, ${-height})`"
            class="aa-chevron"
          />
          <!-- Amino acid letter (only on component with letter !== null) -->
          <text
            v-if="comp.letter !== null && comp.aminoAcid !== '*'"
            :x="getLetterX(comp)"
            :y="-height / 2 + 1"
            text-anchor="middle"
            dominant-baseline="middle"
            class="translation-text"
          >{{ comp.aminoAcid }}</text>
          <!-- Stop sign for stop codons (red octagon) -->
          <g
            v-if="comp.letter !== null && comp.aminoAcid === '*'"
            :transform="`translate(${getLetterX(comp)}, ${-height / 2})`"
          >
            <polygon
              points="-2,-5 2,-5 5,-2 5,2 2,5 -2,5 -5,2 -5,-2"
              fill="#CC0000"
              stroke="white"
              stroke-width="1"
              class="stop-sign"
            />
          </g>
        </g>
      </g>
    </g>
  </g>
</template>

<style scoped>
.translation-layer {
  pointer-events: none;
}

/* Amino acid chevron */
.aa-chevron {
  stroke: black;
  stroke-width: 0.5px;
}

/* Amino acid text - black */
.translation-text {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 12px;
  fill: black;
  user-select: none;
  pointer-events: none;
}

/* Interactive amino acid elements */
.aa-element {
  pointer-events: all;
  cursor: pointer;
}

.aa-element:hover .aa-chevron {
  filter: brightness(0.9);
}

</style>
