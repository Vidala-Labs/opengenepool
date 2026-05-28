<script>
// ============================================
// Module-level state (shared across all instances)
// ============================================
import { ref, computed, watch } from 'vue'

const HIDDEN_TYPES_STORAGE_KEY = 'ogp-hidden-annotation-types'

// Reference to TranslationLayer's showTranslation (set by TranslationLayer on load)
let translationShowRef = null
export function _setTranslationShowRef(r) {
  translationShowRef = r
}

function isTranslationEffectivelyVisible() {
  if (!translationShowRef) return false
  return translationShowRef.value
}

// Load hidden types from localStorage
function loadHiddenTypes() {
  try {
    const stored = localStorage.getItem(HIDDEN_TYPES_STORAGE_KEY)
    if (stored) return new Set(JSON.parse(stored))
  } catch (e) {}
  return new Set()
}

const showAnnotations = ref(true)
const hiddenTypes = ref(loadHiddenTypes())

watch(hiddenTypes, (newSet) => {
  try {
    localStorage.setItem(HIDDEN_TYPES_STORAGE_KEY, JSON.stringify([...newSet]))
  } catch (e) {}
}, { deep: true })

const allAnnotationTypes = ref(new Set())
let instanceCount = 0

const MODULE_DEFAULT_COLORS = {
  gene: '#4CAF50', CDS: '#2196F3', promoter: '#FF9800', terminator: '#F44336',
  misc_feature: '#9E9E9E', rep_origin: '#9C27B0', origin: '#9C27B0',
  primer_bind: '#00BCD4', protein_bind: '#795548', regulatory: '#FFEB3B',
  source: '#B0BEC5', _default: '#607D8B'
}

let annotationColorsRef = null
function getModuleTypeColor(type) {
  const colors = annotationColorsRef?.value || MODULE_DEFAULT_COLORS
  return colors[type] || colors._default
}

function moduleToggleAnnotationType(type) {
  const newSet = new Set(hiddenTypes.value)
  if (newSet.has(type)) newSet.delete(type)
  else newSet.add(type)
  hiddenTypes.value = newSet
}

const sortedAnnotationTypes = computed(() => [...allAnnotationTypes.value].sort())

const moduleConfigItems = computed(() => {
  const items = [{
    type: 'toggle', label: 'Annotations', value: showAnnotations.value,
    onChange: () => { showAnnotations.value = !showAnnotations.value }
  }]
  if (showAnnotations.value && sortedAnnotationTypes.value.length > 0) {
    items.push({
      type: 'type-filter', label: null, types: sortedAnnotationTypes.value,
      hiddenTypes: hiddenTypes.value, getColor: getModuleTypeColor,
      onToggle: moduleToggleAnnotationType
    })
  }
  return items
})

// Export for TranslationLayer coordination and CircularAnnotationLayer sharing
export { showAnnotations, hiddenTypes, allAnnotationTypes, moduleConfigItems }

// Reset function for testing - resets module-level state
export function __resetModuleState() {
  showAnnotations.value = true
  hiddenTypes.value = new Set()
  allAnnotationTypes.value = new Set()
  instanceCount = 0
  annotationColorsRef = null
  translationShowRef = null
  try { localStorage.removeItem(HIDDEN_TYPES_STORAGE_KEY) } catch (e) {}
}
</script>

<script setup>
import { computed, inject, watch, onMounted, onUnmounted } from 'vue'
import { Orientation } from '../utils/dna.js'
import { useAnnotations, generateArrowPath } from '../composables/useAnnotations.js'

// Height reserved for translation display (must match useAnnotations)
const TRANSLATION_HEIGHT = 18

// Display visibility - derived from shared state
const visible = computed(() => showAnnotations.value)

let isFirstInstance = false
onMounted(() => {
  instanceCount++
  if (instanceCount === 1) isFirstInstance = true
})
onUnmounted(() => {
  instanceCount--
  if (instanceCount === 0) allAnnotationTypes.value = new Set()
})

const props = defineProps({
  /** SequenceDocument for edit operations (delete, update annotations) */
  document: {
    type: Object,
    default: null
  },
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
  },
  /** Mode: null (normal), 'target', or 'query' (for alignment mode) */
  mode: {
    type: String,
    default: null,
    validator: (v) => v === null || v === 'target' || v === 'query'
  },
  /** Y offset within each alignment block (for alignment mode) */
  yOffset: {
    type: Number,
    default: 0
  },
  /** Block height for alignment mode (height of target+match+query block) */
  blockHeight: {
    type: Number,
    default: 0
  },
  /** Stack direction: 'up' (default, annotations stack above baseline) or 'down' */
  stackDirection: {
    type: String,
    default: 'up',
    validator: (v) => v === 'up' || v === 'down'
  }
})

const emit = defineEmits(['click', 'contextmenu', 'hover', 'edit-annotation', 'delete-annotation'])

// Inject from parent SequenceEditor
const editorState = inject('editorState')
const graphics = inject('graphics')
const eventBus = inject('eventBus', null)
// Annotation colors from localStorage (provided by SequenceEditor)
const annotationColors = inject('annotationColors', null)
// Selection state for context menu items (optional)
const selection = inject('selection', null)
// Inject alignment line positioning function (provided by AlignmentEditor)
const getAlignmentLineY = inject('getAlignmentLineY', null)

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

// Track this instance's annotation types
const instanceTypes = computed(() => new Set(props.annotations.map(a => a.type || 'misc_feature')))

watch(instanceTypes, (newTypes) => {
  for (const type of newTypes) allAnnotationTypes.value.add(type)
}, { immediate: true })

// Filter annotations based on hiddenTypes
const visibleAnnotations = computed(() => {
  if (!showAnnotations.value) return []
  return props.annotations.filter(a => !hiddenTypes.value.has(a.type || 'misc_feature'))
})

// Use annotations composable for layout calculations
// Pass showTranslation using coordinated visibility from TranslationLayer
const showTranslationRef = computed(() => isTranslationEffectivelyVisible())
const stackDirectionRef = computed(() => props.stackDirection)
// In alignment mode, skip line height management to avoid infinite reactive loops
// when multiple AnnotationLayers exist (one for target, one for query)
const skipLineHeightRef = computed(() => props.mode !== null)
const annotationsComposable = useAnnotations(editorState, graphics, eventBus, {
  showTranslation: showTranslationRef,
  stackDirection: stackDirectionRef,
  skipLineHeightManagement: skipLineHeightRef
})

// Watch for visible annotation changes (filtered by hiddenTypes)
watch(visibleAnnotations, (newAnnotations) => {
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

// ============================================
// Context Menu Items via elementsFromPoint
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
  if (dataset.layer !== 'annotation') return false

  const annotationId = dataset.annotationId
  if (!annotationId) return false

  // Find the annotation by ID
  const annotation = props.annotations.find(a => a.id === annotationId)
  if (!annotation) return false

  // In alignment mode, use the original annotation span (not the aligned coordinates)
  // The original annotation is stored in _originalAnnotation attribute by mapAnnotationThroughAlignment
  const originalAnnotation = annotation.attributes?._originalAnnotation
  const span = originalAnnotation?.span ?? annotation.span
  if (!span) return false

  // Emit click event for parent to handle (e.g., show tooltip)
  emit('click', { event, annotation: originalAnnotation ?? annotation })

  // Select the annotation's span
  if (selection) {
    if (event.shiftKey && selection.isSelected?.value) {
      // Shift+click: extend selection to include annotation
      selection.extendToSpan(span)
    } else if (event.ctrlKey || event.metaKey) {
      // Ctrl/Cmd+click: add annotation span to existing selection
      for (const range of span.ranges) {
        selection.addRange(range)
      }
    } else {
      // Normal click: select annotation span
      selection.select(span)
    }

    // In alignment mode, set the selection source to track which row was clicked
    if (props.mode && selection.source) {
      selection.source.value = props.mode
    }
  }

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
  if (dataset.layer !== 'annotation') return []

  const annotationId = dataset.annotationId
  if (!annotationId) return []

  // Find the annotation by ID
  const annotation = props.annotations.find(a => a.id === annotationId)
  if (!annotation) return []

  // In alignment mode, use the original annotation (not the aligned coordinates)
  // The original annotation is stored in _originalAnnotation attribute by mapAnnotationThroughAlignment
  const originalAnnotation = annotation.attributes?._originalAnnotation
  const effectiveAnnotation = originalAnnotation ?? annotation

  const items = []

  // Edit annotation
  items.push({
    label: 'Edit Annotation',
    action: () => emit('edit-annotation', { annotation: effectiveAnnotation })
  })

  // Delete annotation
  items.push({
    label: 'Delete Annotation',
    action: () => {
      if (props.document) {
        props.document.deleteAnnotation(effectiveAnnotation.id)
      } else {
        emit('delete-annotation', { id: effectiveAnnotation.id })
      }
    }
  })

  // Subtract from selection (when annotation overlaps selection)
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const annotationSpan = annotation.span
    const hasOverlap = selection.domain.value.ranges.some(selRange =>
      annotationSpan?.ranges?.some(annRange => selRange.overlaps?.(annRange))
    )

    if (hasOverlap) {
      items.push({
        label: 'Subtract from selection',
        action: () => selection.subtractSpan(annotationSpan)
      })
    }
  }

  // Merge segment options for multi-range annotations
  // Use effectiveAnnotation's span for merge/split operations
  const effectiveSpanRanges = effectiveAnnotation.span?.ranges
  const rangeIndex = dataset.rangeIndex !== undefined ? parseInt(dataset.rangeIndex, 10) : undefined
  if (rangeIndex !== undefined && effectiveSpanRanges && effectiveSpanRanges.length > 1) {
    const currentRange = effectiveSpanRanges[rangeIndex]

    // Check if can merge with left (previous range)
    if (rangeIndex > 0) {
      const leftRange = effectiveSpanRanges[rangeIndex - 1]
      if (leftRange.end === currentRange.start && leftRange.orientation === currentRange.orientation) {
        items.push({
          label: 'Merge with left segment',
          action: () => emit('contextmenu', {
            event: null,
            annotation: effectiveAnnotation,
            fragment: { rangeIndex },
            action: 'merge-left',
            rangeIndex
          })
        })
      }
    }

    // Check if can merge with right (next range)
    if (rangeIndex < effectiveSpanRanges.length - 1) {
      const rightRange = effectiveSpanRanges[rangeIndex + 1]
      if (currentRange.end === rightRange.start && currentRange.orientation === rightRange.orientation) {
        items.push({
          label: 'Merge with right segment',
          action: () => emit('contextmenu', {
            event: null,
            annotation: effectiveAnnotation,
            fragment: { rangeIndex },
            action: 'merge-right',
            rangeIndex
          })
        })
      }
    }
  }

  // Split annotation option when cursor is strictly inside a range
  if (selection?.isSelected?.value && rangeIndex !== undefined) {
    const selRanges = selection.domain.value?.ranges
    if (selRanges?.length === 1 && selRanges[0].start === selRanges[0].end) {
      const cursorPos = selRanges[0].start

      if (effectiveSpanRanges?.[rangeIndex]) {
        const targetRange = effectiveSpanRanges[rangeIndex]

        // Check if cursor is strictly inside (not at boundaries)
        if (cursorPos > targetRange.start && cursorPos < targetRange.end) {
          items.push({
            label: 'Split annotation',
            action: () => emit('contextmenu', {
              event: null,
              annotation: effectiveAnnotation,
              fragment: { rangeIndex },
              action: 'split',
              rangeIndex,
              splitPosition: cursorPos
            })
          })
        }
      }
    }
  }

  // Clip primer binding option
  // When selection exactly matches a primer's span, and clicked annotation has exactly one end inside
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const selRanges = selection.domain.value.ranges
    if (selRanges?.length === 1) {
      const selRange = selRanges[0]

      // Find primers whose span exactly matches selection (single-segment, no primer_bind)
      const matchingPrimers = props.annotations.filter(ann => {
        if (ann.type !== 'primer') return false
        if (ann.attributes?.primer_bind !== undefined) return false
        const ranges = ann.span?.ranges
        if (!ranges || ranges.length !== 1) return false
        const r = ranges[0]
        return r.start === selRange.start && r.end === selRange.end
      })

      // Check if clicked annotation has exactly one end inside selection
      const clickedRange = annotation.span?.ranges?.[rangeIndex ?? 0]
      if (clickedRange && matchingPrimers.length > 0) {
        const startInside = clickedRange.start > selRange.start && clickedRange.start < selRange.end
        const endInside = clickedRange.end > selRange.start && clickedRange.end < selRange.end

        if (startInside !== endInside) { // XOR - exactly one end inside
          const clipPosition = startInside ? clickedRange.start : clickedRange.end

          for (const primer of matchingPrimers) {
            items.push({
              label: `Clip primer binding of ${primer.caption}`,
              action: () => {
                // Calculate primer_bind based on orientation
                const primerRange = primer.span.ranges[0]
                let primerBind
                if (primerRange.orientation === Orientation.PLUS) {
                  primerBind = primerRange.end - clipPosition
                } else {
                  primerBind = clipPosition - primerRange.start
                }
                // Update via document or emit
                if (props.document) {
                  props.document.updateAnnotation({
                    id: primer.id,
                    attributes: { ...primer.attributes, primer_bind: primerBind }
                  })
                }
              }
            })
          }
        }
      }
    }
  }

  // Reverse operation: Clip this primer with selection
  // When right-clicking a primer, selection has one terminus inside primer
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const selRanges = selection.domain.value.ranges
    // Only single-range selection
    if (selRanges?.length === 1) {
      const selRange = selRanges[0]

      // Check if clicked annotation is an eligible primer
      if (annotation.type === 'primer' &&
          annotation.attributes?.primer_bind === undefined) {
        const primerRanges = annotation.span?.ranges
        // Only single-segment primers
        if (primerRanges?.length === 1) {
          const primerRange = primerRanges[0]

          // Check if exactly one selection terminus is inside primer (exclusive)
          const selStartInside = selRange.start > primerRange.start && selRange.start < primerRange.end
          const selEndInside = selRange.end > primerRange.start && selRange.end < primerRange.end

          if (selStartInside !== selEndInside) { // XOR - exactly one terminus inside
            const clipPosition = selStartInside ? selRange.start : selRange.end

            items.push({
              label: 'Clip this primer with selection',
              action: () => {
                // Calculate primer_bind based on orientation
                let primerBind
                if (primerRange.orientation === Orientation.PLUS) {
                  primerBind = primerRange.end - clipPosition
                } else {
                  primerBind = clipPosition - primerRange.start
                }
                // Update via document
                if (props.document) {
                  props.document.updateAnnotation({
                    id: annotation.id,
                    attributes: { ...annotation.attributes, primer_bind: primerBind }
                  })
                }
              }
            })
          }
        }
      }
    }
  }

  return items
}

// Calculate x position for a fragment
function getFragmentX(fragment) {
  return graphics.metrics.value.lmargin + fragment.start * graphics.metrics.value.charWidth
}

// Calculate width for a fragment
function getFragmentWidth(fragment) {
  return fragment.width * graphics.metrics.value.charWidth
}

// Calculate x position for primer_bind line indicator
// Returns null if no line should be drawn
function getPrimerBindLineX(element) {
  const fragment = element.fragment
  const annotation = fragment.annotation

  // Only for primer type with primer_bind attribute
  if (fragment.type !== 'primer' && annotation?.type !== 'primer') return null
  const primerBind = annotation?.attributes?.primer_bind
  if (primerBind === undefined || primerBind === null) return null

  // Get the annotation's full span (not fragment)
  const annRange = annotation?.span?.ranges?.[0]
  if (!annRange) return null

  const { lmargin, charWidth } = graphics.metrics.value
  const zoomLevel = editorState.zoomLevel.value

  // Calculate absolute line position from annotation's actual start/end
  let linePos
  if (annRange.orientation === Orientation.PLUS) {
    // Forward: 3' end at annRange.end, line at end - primerBind
    linePos = annRange.end - primerBind
  } else if (annRange.orientation === Orientation.MINUS) {
    // Reverse: 3' end at annRange.start, line at start + primerBind
    linePos = annRange.start + primerBind
  } else {
    return null
  }

  // Fragment positions are line-relative, convert to absolute for comparison
  const fragAbsStart = fragment.line * zoomLevel + fragment.start
  const fragAbsEnd = fragment.line * zoomLevel + fragment.end

  // Only draw if linePos falls within this fragment's absolute range
  if (linePos < fragAbsStart || linePos > fragAbsEnd) {
    return null
  }

  // Convert absolute linePos to line-relative for x calculation
  const lineRelativePos = linePos - fragment.line * zoomLevel
  return lmargin + lineRelativePos * charWidth
}

// Is this an alignment mode layer?
const isAlignmentLayer = computed(() => props.mode !== null)

// Get y position for a line
function getLineY(lineIndex) {
  if (isAlignmentLayer.value) {
    // Use injected per-line positioning if available, otherwise fall back to uniform spacing
    if (getAlignmentLineY) {
      return getAlignmentLineY(lineIndex) + props.yOffset
    }
    return lineIndex * props.blockHeight + props.yOffset
  }
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
// Click handler for direct element clicks (routes to handleClickForElement)
function handleClick(event, fragment) {
  event.stopPropagation()  // Prevent bubbling to SVG
  const dataset = {
    layer: 'annotation',
    annotationId: fragment.annotation?.id,
    rangeIndex: fragment.rangeIndex?.toString()
  }
  handleClickForElement(dataset, event)
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

/**
 * Delete an annotation by ID.
 * If document is provided, calls document.deleteAnnotation directly.
 * Otherwise, emits 'delete-annotation' event for parent to handle.
 * @param {string} id - The annotation ID to delete
 */
function deleteAnnotation(id) {
  if (props.document) {
    props.document.deleteAnnotation(id)
  } else {
    emit('delete-annotation', { id })
  }
}

/**
 * Request editing an annotation (opens modal in parent).
 * @param {Object} annotation - The annotation to edit
 */
function requestEditAnnotation(annotation) {
  emit('edit-annotation', { annotation })
}

// Config items for Toolbar
const configItems = computed(() => {
  if (!isFirstInstance) return []
  return moduleConfigItems.value
})

// Expose for testing, visibility control, and click/context menu integration
defineExpose({
  showAnnotations,
  visible,
  fragments,
  fragmentsByLine,
  getFragmentX,
  getFragmentWidth,
  annotationDeltaYByLine,
  deleteAnnotation,
  requestEditAnnotation,
  handleClickForElement,
  getMenuItemsForElement,
  configItems
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
      <!-- When translation space is reserved, offset visual to leave room for translation -->
      <!-- stack-direction="up": shift up (subtract) to leave room below -->
      <!-- stack-direction="down": shift down (add) to leave room above -->
      <g
        v-for="(element, elemIndex) in elementsByLine.get(lineIndex)"
        :key="`elem-${element.fragment.id}-${elemIndex}`"
        :class="['annotation-fragment', element.fragment.cssClass]"
        :transform="`translate(0, ${element.deltaY + (element.reserveTranslationSpace ? (stackDirection === 'down' ? TRANSLATION_HEIGHT : -TRANSLATION_HEIGHT) : 0)})`"
        data-layer="annotation"
        :data-annotation-id="element.fragment.annotation?.id"
        :data-range-index="element.fragment.rangeIndex"
        @click="handleClick($event, element.fragment)"
        @contextmenu="handleContextMenu($event, element.fragment)"
        @mouseenter="handleMouseEnter($event, element.fragment)"
        @mouseleave="handleMouseLeave($event, element.fragment)"
      >
        <!-- Tooltip (native browser tooltip via SVG title element) -->
        <title v-if="element.fragment.caption">{{ element.fragment.caption }}</title>

        <!-- Use pre-computed arrow path from layout, color/gradient based on indefinite state -->
        <path
          :d="element.path"
          :fill="getElementFill(element)"
          :opacity="getElementOpacity(element)"
          class="annotation-path"
        />

        <!-- Caption text (only shown if it fits within the arrow) -->
        <!-- For down direction, nudge text down slightly to better center in the arrow -->
        <text
          v-if="showCaptions && captionFits(element)"
          :x="getCaptionX(element)"
          :y="stackDirection === 'down' ? height / 2 + 2 : -height / 2"
          dominant-baseline="middle"
          class="annotation-caption"
        >
          {{ element.fragment.caption }}
        </text>

        <!-- Primer binding line indicator (vertical dotted line showing where primer binds) -->
        <template v-if="getPrimerBindLineX(element) !== null">
          <rect
            :x="getPrimerBindLineX(element) - 2"
            :y="stackDirection === 'down' ? -arrowEdge : -arrowEdge"
            :width="4"
            :height="arrowEdge"
            fill="#333"
          />
          <line
            :x1="getPrimerBindLineX(element)"
            :x2="getPrimerBindLineX(element)"
            :y1="stackDirection === 'down' ? 0 : -height"
            :y2="stackDirection === 'down' ? height : 0"
            class="primer-bind-line"
            stroke="black"
            stroke-width="1"
            stroke-dasharray="2,2"
          />
        </template>
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
