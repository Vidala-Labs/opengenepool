<script setup>
import { ref, shallowRef, computed, markRaw, onMounted, onUnmounted, provide, watch, watchEffect, nextTick } from 'vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { usePersistedZoom } from '../composables/usePersistedZoom.js'
import { useClipboard } from '../composables/useClipboard.js'
import { useSelection, SelectionDomain } from '../composables/useSelection.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Annotation, ANNOTATION_COLORS } from '../utils/annotation.js'
import { Span, Range, Orientation, iterateSequence, reverseComplement, calculateTm } from '../utils/dna.js'
import { iterateCodons } from '../utils/translation.js'
import AnnotationLayer, { showAnnotations, hiddenTypes } from './AnnotationLayer.vue'
import TranslationLayer, { showTranslation } from './TranslationLayer.vue'
import SelectionLayer from './SelectionLayer.vue'
import CircularView from './CircularView.vue'
import ContextMenu from './ContextMenu.vue'
import InsertModal from './InsertModal.vue'
import AnnotationModal from './AnnotationModal.vue'
import ExtendModal from './ExtendModal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SequenceLayer from './SequenceLayer.vue'
import Toolbar from './Toolbar.vue'
import Indicator from './Indicator.vue'

const props = defineProps({
  /**
   * SequenceDocument instance to edit.
   * For alignment mode, use the separate AlignmentEditor component instead.
   */
  sequence: {
    type: [Object, SequenceDocument],
    default: null
  },
  /** Initial zoom level (bases per line) */
  initialZoom: {
    type: Number,
    default: 100
  },
  /** Whether to show annotation captions */
  showAnnotationCaptions: {
    type: Boolean,
    default: true
  },
  /** Whether the editor is read-only (disables editing, allows selection/copy) */
  readonly: {
    type: Boolean,
    default: false
  },
  /**
   * Clipboard backend for copy/paste operations.
   * Document-level operations (insert/delete/annotations) should use the
   * backend passed to SequenceDocument when creating it.
   */
  clipboardBackend: {
    type: Object,
    default: null
  },
  /** Array of extension objects */
  extensions: {
    type: Array,
    default: () => []
  },
  /** Custom Tm calculator function. Receives sequence string, returns display string (e.g., "Tm: 58.2°C") or null to hide. */
  tmCalculator: {
    type: Function,
    default: null
  },
  /** Additional annotation field definitions from extensions/plugins */
  annotationFields: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'select',
  'contextmenu',
  'ready',
  'edit',
  'annotation-click',
  'annotation-contextmenu',
  'annotation-hover',
  'annotations-update'
])

// Effective clipboard backend - returns null when readonly to prevent copy/paste
// For document edits, use targetDoc methods which call the document's backend
const effectiveClipboardBackend = computed(() => props.readonly ? null : props.clipboardBackend)
const { copyText, readText } = useClipboard(effectiveClipboardBackend)
const renderExtensions = shallowRef([])
watchEffect(() => {
  renderExtensions.value = props.extensions.map(ext => markRaw({
    ...ext,
    toolbarButton: ext.toolbarButton ? markRaw(ext.toolbarButton) : null,
    graphicsLayer: ext.graphicsLayer ? markRaw(ext.graphicsLayer) : null,
    panel: ext.panel ? markRaw(ext.panel) : null
  }))
})

// ============================================
// Document Access Computed Properties
// ============================================

// Target document (the sequence being viewed/edited)
// Note: For alignment mode, use the separate AlignmentEditor component
const targetDoc = computed(() => props.sequence)

// Is the sequence circular? (from target document)
const isCircular = computed(() => targetDoc.value?.circular ?? false)

// Default Tm calculator - uses built-in SantaLucia 1998 method
// Returns display string (e.g., "Tm: 58.2°C") or null to hide
function defaultTmCalculator(sequence) {
  if (!sequence || sequence.length < 2 || sequence.length > 80) return null
  const tm = calculateTm(sequence)
  if (tm === null) return null
  return `Tm: ${tm}°C`
}

// Valid DNA bases for input (IUPAC codes)
// A, T, C, G - standard bases
// N - any base
// R - purine (A/G), Y - pyrimidine (C/T)
// S - strong (G/C), W - weak (A/T)
// K - keto (G/T), M - amino (A/C)
// B - not A (C/G/T), D - not C (A/G/T), H - not G (A/C/T), V - not T (A/C/G)
const DNA_BASES = new Set([
  'A', 'T', 'C', 'G', 'N', 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V',
  'a', 't', 'c', 'g', 'n', 'r', 'y', 's', 'w', 'k', 'm', 'b', 'd', 'h', 'v'
])

// Insert/replace modal state
const insertModalVisible = ref(false)
const insertModalText = ref('')
const insertModalIsReplace = ref(false)
const insertModalPosition = ref(0)
const insertModalSelectionEnd = ref(0)  // End of selection for replace mode
const insertModalOrientation = ref(Orientation.PLUS)  // Orientation of selection for replace mode

// Rich paste state - holds overlay annotations to create after paste
const pendingOverlayAnnotations = ref(null)

// Count annotations that would be affected by a replacement
// Affected = intersects selection but doesn't fully contain it
const affectedAnnotationCount = computed(() => {
  if (!insertModalIsReplace.value) return 0
  const selStart = insertModalPosition.value
  const selEnd = insertModalSelectionEnd.value
  if (selStart === selEnd) return 0

  let count = 0
  for (const ann of localAnnotations.value) {
    const span = ann.span
    for (const range of span.ranges) {
      const intersects = range.end > selStart && range.start < selEnd
      const contains = range.start <= selStart && range.end >= selEnd
      if (intersects && !contains) {
        count++
        break // Count each annotation only once
      }
    }
  }
  return count
})

// Compute annotations that touch the insertion point (for disciplined inserts)
// Only applies to pure inserts, not replacements
// Returns flat list with separate entries for left (end touches) and right (start touches)
const touchingAnnotations = computed(() => {
  if (insertModalIsReplace.value) return []
  if (!localAnnotations.value || localAnnotations.value.length === 0) return []
  const pos = insertModalPosition.value

  const result = []
  for (const ann of localAnnotations.value) {
    if (!ann.span) continue
    const span = ann.span
    const name = ann.caption || ann.type || ann.id
    const type = ann.type || 'feature'

    // Check each range for touching the insertion point
    for (const range of span.ranges) {
      // Arrow direction based on strand: → for plus, ← for minus
      const isMinus = range.orientation === Orientation.MINUS
      const arrow = isMinus ? '←' : '→'
      // Format range in GenBank style: complement(...) for minus strand
      const rangeStr = isMinus
        ? `complement(${range.start}..${range.end})`
        : `${range.start}..${range.end}`

      if (range.end === pos) {
        // This range ends at the insertion point - insert goes RIGHT (after)
        // Arrow goes on the right side of the range
        result.push({
          key: `${ann.id}:end`,
          id: ann.id,
          side: 'end',
          label: `${name} (${type}) ${rangeStr} ${arrow}`
        })
      }
      if (range.start === pos) {
        // This range starts at the insertion point - insert goes LEFT (before)
        // Arrow goes on the left side of the range
        result.push({
          key: `${ann.id}:start`,
          id: ann.id,
          side: 'start',
          label: `${name} (${type}) ${arrow} ${rangeStr}`
        })
      }
    }
  }
  return result
})

// Annotation modal state
const annotationModalOpen = ref(false)
const annotationModalSpan = ref(new Span())
const editingAnnotation = ref(null)  // null = create mode, annotation object = edit mode

// Extend modal state
const extendModalVisible = ref(false)
const extendModalDirection = ref('positive')
const extendModalRangeIndex = ref(0)
const extendModalHandleType = ref('end')  // 'start' or 'end'

// Delete confirmation dialog state
const deleteConfirmVisible = ref(false)
const deleteConfirmLength = ref(0)

// Computed max bases for extend modal
const extendModalMaxBases = computed(() => {
  if (!extendModalVisible.value) return null

  const domain = selection.domain.value
  if (!domain || extendModalRangeIndex.value >= domain.ranges.length) return null

  const range = domain.ranges[extendModalRangeIndex.value]
  const seqLen = editorState.sequenceLength.value
  const direction = extendModalDirection.value
  const docIsCircular = isCircular.value

  if (direction === 'negative') {
    if (docIsCircular) {
      // Circular: can wrap around, limited by nearest range end (going backwards)
      // Start from range.start, go backwards wrapping at 0 to seqLen
      let limit = seqLen  // max possible (full circle minus current selection)

      for (let i = 0; i < domain.ranges.length; i++) {
        if (i === extendModalRangeIndex.value) continue
        const other = domain.ranges[i]
        // Calculate distance going backwards (wrapping)
        let gap
        if (other.end <= range.start) {
          // Other range is before us (no wrap needed)
          gap = range.start - other.end
        } else {
          // Other range is after us, wrap around
          gap = range.start + (seqLen - other.end)
        }
        limit = Math.min(limit, gap)
      }
      return limit
    } else {
      // Linear: max is distance to 0 or nearest range end
      let limit = range.start

      for (let i = 0; i < domain.ranges.length; i++) {
        if (i === extendModalRangeIndex.value) continue
        const other = domain.ranges[i]
        if (other.end <= range.start) {
          const gap = range.start - other.end
          limit = Math.min(limit, gap)
        }
      }
      return limit
    }
  } else {
    if (docIsCircular) {
      // Circular: can wrap around, limited by nearest range start (going forwards)
      let limit = seqLen  // max possible (full circle minus current selection)

      for (let i = 0; i < domain.ranges.length; i++) {
        if (i === extendModalRangeIndex.value) continue
        const other = domain.ranges[i]
        // Calculate distance going forwards (wrapping)
        let gap
        if (other.start >= range.end) {
          // Other range is after us (no wrap needed)
          gap = other.start - range.end
        } else {
          // Other range is before us, wrap around
          gap = (seqLen - range.end) + other.start
        }
        limit = Math.min(limit, gap)
      }
      return limit
    } else {
      // Linear: max is distance to seqLen or nearest range start
      let limit = seqLen - range.end

      for (let i = 0; i < domain.ranges.length; i++) {
        if (i === extendModalRangeIndex.value) continue
        const other = domain.ranges[i]
        if (other.start >= range.end) {
          const gap = other.start - range.end
          limit = Math.min(limit, gap)
        }
      }
      return limit
    }
  }
})

// View mode state ('linear' | 'circular')
// Only circular sequences can switch to circular view
const viewMode = ref('linear')

// Computed: whether to show the view mode toggle
const showViewModeToggle = computed(() => isCircular.value)

// Initialize composables
const editorState = useEditorState()
const graphics = useGraphics(editorState)
const eventBus = createEventBus()

// Selection is owned here and provided to children (single source of truth)
const selection = useSelection(editorState, graphics, eventBus)

// Local copy of annotations for optimistic UI updates
// This allows us to adjust annotation positions locally before server confirmation
const localAnnotations = computed(() => targetDoc.value?.annotations ?? [])

// Helper to convert a range to GenBank notation (1-based)
function rangeToGenBank(range) {
  // Convert from 0-based fenced to 1-based GenBank
  // In fenced: 0..10 means bases at positions 0-9 (end exclusive)
  // In GenBank: 1..10 means bases 1-10 inclusive
  const start = range.start + 1
  const end = range.end  // fenced end is exclusive, so this is the last base

  const baseStr = `${start}..${end}`

  // MINUS strand → complement(), NONE treated as PLUS
  if (range.orientation === Orientation.MINUS) {
    return `complement(${baseStr})`
  }
  return baseStr
}

// Computed property for selection status text displayed in the indicator
const selectionStatusText = computed(() => {
  if (!selection.isSelected.value || !selection.domain.value) {
    return null
  }

  const domain = selection.domain.value
  const ranges = domain.ranges

  if (!ranges || ranges.length === 0) {
    return null
  }

  // Filter out cursor ranges (length === 0) for composite selections
  const nonCursorRanges = ranges.filter(r => r.length > 0)

  // Check if ALL ranges are cursors
  const allCursors = nonCursorRanges.length === 0

  if (allCursors && ranges.length === 1) {
    // Single cursor - show "cursor between X and Y"
    const pos = ranges[0].start
    const seq = editorState.sequence.value

    if (pos === 0) {
      // Cursor at start
      const rightBase = seq[0]
      return `cursor at start, before ${rightBase}${pos + 1}`
    } else if (pos >= seq.length) {
      // Cursor at end
      const leftBase = seq[seq.length - 1]
      return `cursor at end, after ${leftBase}${seq.length}`
    } else {
      // Cursor in middle
      const leftBase = seq[pos - 1]
      const rightBase = seq[pos]
      return `cursor between ${leftBase}${pos} and ${rightBase}${pos + 1}`
    }
  }

  if (nonCursorRanges.length === 0) {
    return null // Multiple cursors only, no selection to show
  }

  // Calculate total length
  const totalLength = nonCursorRanges.reduce((sum, r) => sum + r.length, 0)

  // Build GenBank notation
  let genbankStr
  if (nonCursorRanges.length === 1) {
    genbankStr = rangeToGenBank(nonCursorRanges[0])
  } else {
    const parts = nonCursorRanges.map(r => rangeToGenBank(r))
    genbankStr = `join(${parts.join(', ')})`
  }

  const baseWord = totalLength === 1 ? 'base' : 'bases'
  let statusText = `selected: ${genbankStr} (${totalLength} ${baseWord})`

  // Add Tm for single contiguous selections (calculator handles length limits)
  if (nonCursorRanges.length === 1) {
    const range = nonCursorRanges[0]
    const seq = editorState.sequence.value
    const selectedSeq = seq.slice(range.start, range.end)
    const calculator = props.tmCalculator || defaultTmCalculator
    const tmDisplay = calculator(selectedSeq)
    if (tmDisplay) {
      statusText += ` · ${tmDisplay}`
    }

    // Check if selection matches a primer with primer_bind attribute
    const matchingPrimer = localAnnotations.value?.find(ann => {
      if (ann.type !== 'primer') return false
      if (ann.attributes?.primer_bind === undefined) return false
      const ranges = ann.span?.ranges
      if (!ranges || ranges.length !== 1) return false
      const r = ranges[0]
      return r.start === range.start && r.end === range.end
    })

    if (matchingPrimer) {
      const primerRange = matchingPrimer.span.ranges[0]
      const primerBind = matchingPrimer.attributes.primer_bind

      // Calculate binding region coordinates based on strand orientation
      // Forward (PLUS): binding at 3' end of primer (end of range)
      // Reverse (MINUS): binding at 5' end (start of range, but reversed)
      let bindStart, bindEnd
      if (primerRange.orientation === Orientation.MINUS) {
        bindStart = primerRange.start
        bindEnd = primerRange.start + primerBind
      } else {
        bindStart = primerRange.end - primerBind
        bindEnd = primerRange.end
      }

      // Extract binding region sequence
      let bindingSeq = seq.slice(bindStart, bindEnd)

      // For minus strand, reverse complement to get primer sequence
      if (primerRange.orientation === Orientation.MINUS) {
        bindingSeq = reverseComplement(bindingSeq)
      }

      const bindingTm = calculator(bindingSeq)
      if (bindingTm) {
        statusText += ` · Binding ${bindingTm}`
      }
    }
  }

  return statusText
})

// Set initial zoom from localStorage (fallback to prop)
const { getInitialZoom, saveZoom } = usePersistedZoom(props.initialZoom)
editorState.setZoom(getInitialZoom())

// Persist zoom changes to localStorage
watch(editorState.zoomLevel, (newZoom) => {
  saveZoom(newZoom)
})

// Watch for document changes to initialize/update the editor
watch(() => targetDoc.value?.sequence, (newSeq) => {
  if (newSeq !== undefined) {
    editorState.setSequence(newSeq, '')  // Title is now provided via slot
    // Re-apply persisted zoom now that sequence is loaded (setZoom clamps based on length)
    editorState.setZoom(getInitialZoom())
  }
}, { immediate: true })

// Rich copy/paste overlay storage
const OVERLAY_STORAGE_KEY = 'opengenepool-copy-overlay'

/**
 * Save overlay data for rich paste (annotations with relative positions)
 */
function saveOverlay(sequence, annotations) {
  localStorage.setItem(OVERLAY_STORAGE_KEY, JSON.stringify({ sequence, annotations }))
}

/**
 * Load overlay data from localStorage
 */
function loadOverlay() {
  const data = localStorage.getItem(OVERLAY_STORAGE_KEY)
  return data ? JSON.parse(data) : null
}

/**
 * Clear overlay from localStorage
 */
function clearOverlay() {
  localStorage.removeItem(OVERLAY_STORAGE_KEY)
}

/**
 * Find annotations that overlap with selection ranges and convert to relative positions.
 * For multi-range selections, positions are relative to the concatenated copied sequence.
 * For minus strand selections, positions are reversed and orientations are flipped.
 *
 * @param {Array<Range>} selectionRanges - The selection ranges (ordered)
 * @returns {Array} Annotations with relative positions
 */
function getOverlappingAnnotations(selectionRanges) {
  const result = []

  // Build a mapping from absolute positions to relative positions in the copied sequence
  // For multi-range: ranges are concatenated in order
  let relativeOffset = 0
  const rangeOffsets = selectionRanges.map(range => {
    const offset = relativeOffset
    relativeOffset += range.end - range.start
    return { range, relativeStart: offset }
  })

  for (const ann of localAnnotations.value) {
    const annSpan = ann.span
    if (!annSpan || !annSpan.ranges) continue

    // Check each annotation range against each selection range
    for (const annRange of annSpan.ranges) {
      for (const { range: selRange, relativeStart } of rangeOffsets) {
        // Check if annotation range overlaps with selection range
        if (annRange.end <= selRange.start || annRange.start >= selRange.end) {
          continue // No overlap
        }

        // Calculate the overlapping portion (clip to selection bounds)
        const overlapStart = Math.max(annRange.start, selRange.start)
        const overlapEnd = Math.min(annRange.end, selRange.end)

        // Convert to relative position within the copied sequence
        // For minus strand selections, the sequence is reverse-complemented,
        // so we need to reverse the annotation positions within the range
        const isMinus = selRange.orientation === Orientation.MINUS
        let relStart, relEnd, resultOrientation

        if (isMinus) {
          // Reverse positions: position X in original becomes (rangeLength - X) in reversed
          relStart = relativeStart + (selRange.end - overlapEnd)
          relEnd = relativeStart + (selRange.end - overlapStart)
          // Flip orientation when in minus strand selection
          resultOrientation = annRange.orientation * -1
        } else {
          relStart = relativeStart + (overlapStart - selRange.start)
          relEnd = relativeStart + (overlapEnd - selRange.start)
          resultOrientation = annRange.orientation
        }

        // Check if we already have this annotation in results
        let existing = result.find(r => r.id === ann.id)
        if (!existing) {
          existing = {
            id: ann.id,  // Store original ID for reference, but new ID will be generated on paste
            caption: ann.caption,
            type: ann.type,
            orientation: resultOrientation,
            attributes: ann.attributes ? { ...ann.attributes } : {},
            relativeRanges: []
          }
          result.push(existing)
        }

        existing.relativeRanges.push({
          start: relStart,
          end: relEnd,
          orientation: resultOrientation
        })
      }
    }
  }

  return result
}

// Annotation colors with localStorage persistence
// Uses ANNOTATION_COLORS from annotation.js as the single source of truth.
// Colors are saved to localStorage so users can customize them in the future.
const COLORS_KEY = 'opengenepool-annotation-colors'

// Load annotation colors from localStorage.
// If no colors are stored, save the defaults to localStorage and return them.
// This ensures users always have a baseline that can be customized later.
function loadAnnotationColors() {
  const stored = localStorage.getItem(COLORS_KEY)
  if (stored) {
    try {
      // Merge with defaults to handle any new types added in future versions
      return { ...ANNOTATION_COLORS, ...JSON.parse(stored) }
    } catch {
      // Corrupted data - reset to defaults
      localStorage.setItem(COLORS_KEY, JSON.stringify(ANNOTATION_COLORS))
      return { ...ANNOTATION_COLORS }
    }
  }
  // First load - save defaults to localStorage
  localStorage.setItem(COLORS_KEY, JSON.stringify(ANNOTATION_COLORS))
  return { ...ANNOTATION_COLORS }
}

const annotationColors = ref(loadAnnotationColors())
const configPanelOpen = ref(false)

// Refs to layer components
const annotationLayerRef = ref(null)
const translationLayerRef = ref(null)
const circularViewRef = ref(null)
const sequenceLayerRef = ref(null)

// Collect config items from layers for Toolbar
// In circular mode, collect from CircularView; in linear mode, from linear layers
const collectedConfigItems = computed(() => {
  if (viewMode.value === 'circular') {
    return [
      ...(circularViewRef.value?.configItems ?? []),
      ...(translationLayerRef.value?.configItems ?? [])
    ]
  }
  return [
    ...(annotationLayerRef.value?.configItems ?? []),
    ...(translationLayerRef.value?.configItems ?? [])
  ]
})

// Save colors to localStorage whenever they change
watch(annotationColors, (newColors) => {
  localStorage.setItem(COLORS_KEY, JSON.stringify(newColors))
}, { deep: true })

// Get color for an annotation type, falling back to default
function getTypeColor(type) {
  return annotationColors.value[type] || annotationColors.value._default
}

// Convert plain annotation objects to Annotation class instances
// Note: Filtering by hidden types is now handled by AnnotationLayer internally
const annotationInstances = computed(() => {
  return localAnnotations.value.map(ann => {
    // If already an Annotation instance, return as-is
    if (ann instanceof Annotation) return ann
    // Convert plain object to Annotation
    return new Annotation(ann)
  })
})

// Annotation creation modal
function openAnnotationModal() {
  const domain = selection.domain.value

  // Check if we have a valid selection with non-zero length ranges
  const hasValidSelection = domain && domain.ranges.length > 0 &&
                           domain.ranges.every(r => r.start !== r.end)

  if (hasValidSelection) {
    // Build a Span from all selected ranges
    annotationModalSpan.value = new Span(
      domain.ranges.map(r => new Range(r.start, r.end, r.orientation))
    )
  } else {
    // No selection or zero-length selection - open with blank fields
    annotationModalSpan.value = new Span()
  }
  annotationModalOpen.value = true
}

function closeAnnotationModal() {
  annotationModalOpen.value = false
  editingAnnotation.value = null
}

function openAnnotationModalForEdit(annotation) {
  editingAnnotation.value = annotation
  // Pass the span directly
  annotationModalSpan.value = annotation.span || new Span()
  annotationModalOpen.value = true
}

function handleAnnotationUpdate(data) {
  const annotationId = editingAnnotation.value.id

  // Update annotation in document (handles backend notification)
  targetDoc.value.updateAnnotation({
    id: annotationId,
    caption: data.caption,
    type: data.type,
    span: data.span,
    attributes: data.attributes
  })

  // Emit for parent components
  emit('annotations-update', localAnnotations.value)

  annotationModalOpen.value = false
  editingAnnotation.value = null
}

/**
 * Merge two adjacent ranges within an annotation's span.
 * @param {Object} annotation - The annotation to modify
 * @param {number} leftIndex - Index of the left range to merge
 * @param {number} rightIndex - Index of the right range to merge (must be leftIndex + 1)
 */
function mergeAnnotationRanges(annotation, leftIndex, rightIndex) {
  const ranges = annotation.span.ranges
  const leftRange = ranges[leftIndex]
  const rightRange = ranges[rightIndex]

  // Create merged range (preserves left range's start and right range's end)
  const mergedRange = new Range(
    leftRange.start,
    rightRange.end,
    leftRange.orientation,
    leftRange.startIndefinite,
    rightRange.endIndefinite
  )

  // Build new ranges array with the merge applied
  const newRanges = [
    ...ranges.slice(0, leftIndex),
    mergedRange,
    ...ranges.slice(rightIndex + 1)
  ]

  // Update annotation in document (handles backend notification)
  targetDoc.value.updateAnnotation({
    id: annotation.id,
    span: new Span(newRanges)
  })
  // Emit for parent components
  emit('annotations-update', localAnnotations.value)
}

/**
 * Split a range within an annotation's span at a given position.
 * @param {Object} annotation - The annotation to modify
 * @param {number} rangeIndex - Index of the range to split
 * @param {number} position - Position at which to split the range
 */
function splitAnnotationAtPosition(annotation, rangeIndex, position) {
  const spanRanges = annotation.span.ranges
  const targetRange = spanRanges[rangeIndex]

  // Create two new ranges from the split
  const leftRange = new Range(
    targetRange.start,
    position,
    targetRange.orientation,
    targetRange.startIndefinite,
    false  // split point is definite
  )
  const rightRange = new Range(
    position,
    targetRange.end,
    targetRange.orientation,
    false,  // split point is definite
    targetRange.endIndefinite
  )

  // Build new ranges array with the split
  const newRanges = [
    ...spanRanges.slice(0, rangeIndex),
    leftRange,
    rightRange,
    ...spanRanges.slice(rangeIndex + 1)
  ]

  // Update annotation in document (handles backend notification)
  targetDoc.value.updateAnnotation({
    id: annotation.id,
    span: new Span(newRanges)
  })
  emit('annotations-update', localAnnotations.value)
}

function handleAnnotationCreate(data) {
  // Generate a new UUID for the annotation
  const annotationId = crypto.randomUUID()

  // For CDS annotations, compute the translation string
  const span = data.span
  let attributes = data.attributes || {}
  if (data.type?.toUpperCase() === 'CDS') {
    const seq = editorState.sequence.value
    const result = { aminoAcids: '' }
    const bases = iterateSequence(span, seq)
    // Consume the iterator to populate result.aminoAcids
    for (const _ of iterateCodons(bases, result)) { /* just consume */ }
    attributes = { ...attributes, translation: result.aminoAcids }
  }

  const newAnnotation = {
    id: annotationId,
    caption: data.caption,
    type: data.type,
    span,
    attributes
  }

  // Add annotation to document (handles backend notification)
  targetDoc.value.addAnnotation(newAnnotation)
  // Emit for parent components
  emit('annotations-update', localAnnotations.value)

  annotationModalOpen.value = false
}

// Computed: whether we have a non-zero selection for annotation creation
// All ranges must be non-zero length
const hasNonZeroSelection = computed(() => {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return false
  return domain.ranges.every(r => r.start !== r.end)
})

// Provide state to child components
provide('editorState', editorState)
provide('graphics', graphics)
provide('eventBus', eventBus)
provide('selection', selection)  // Single source of truth for selection
provide('annotationColors', annotationColors)  // Colors persisted to localStorage
provide('showAnnotations', showAnnotations)  // Shared visibility for annotation layers
provide('showTranslation', showTranslation)  // Shared visibility for translation layer

// Extension API for external extensions
// Selection change handlers for extensions
const selectionChangeHandlers = new Set()

const extensionAPI = {
  // State access
  getSequence: () => editorState.sequence.value,
  getTitle: () => editorState.title.value,
  getSelectedSequence: getSelectedSequenceText,
  getAnnotations: () => localAnnotations.value,

  // Actions
  setSelection,
  clearSelection,
  scrollToPosition,

  // Annotation creation
  addAnnotation: (data) => {
    // data: { span: Span, type: string, label: string, color?: string, attributes?: object }
    handleAnnotationCreate(data)
  },

  // Event subscription
  onSelectionChange: (handler) => {
    selectionChangeHandlers.add(handler)
    return () => selectionChangeHandlers.delete(handler)  // Returns unsubscribe fn
  }
}
provide('extensionAPI', extensionAPI)

// Watch selection changes and notify extension handlers
// Use deep: true to detect mutations to range properties (e.g., during handle dragging)
watch(() => selection.domain.value, () => {
  selectionChangeHandlers.forEach(handler => handler())
}, { deep: true })

// Template refs
const containerRef = ref(null)
const svgRef = ref(null)
const circularContainerRef = ref(null)
const measureRef = ref(null)
const selectionLayerRef = ref(null)

// Zoom levels for selector
const zoomLevels = [50, 75, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000]
const zoomStrings = ['50bp', '75bp', '100bp', '200bp', '500bp', '1kbp', '2kbp', '5kbp', '10kbp', '20kbp', '50kbp', '100kbp']

// Available zoom options based on sequence length
const availableZooms = computed(() => {
  const len = editorState.sequenceLength.value
  if (len === 0) return zoomLevels.map((z, i) => ({ value: z, label: zoomStrings[i] }))

  const options = []
  for (let i = 0; i < zoomLevels.length && zoomLevels[i] < len; i++) {
    options.push({ value: zoomLevels[i], label: zoomStrings[i] })
  }
  // Add "full" option
  options.push({ value: len, label: 'full' })
  return options
})

// SVG dimensions
const svgHeight = computed(() => {
  return graphics.getTotalHeight(editorState.lineCount.value)
})

// Cursor position helpers
const cursorLine = computed(() => {
  return editorState.positionToLine(editorState.cursor.value)
})

const cursorX = computed(() => {
  const posInLine = editorState.positionInLine(editorState.cursor.value)
  return graphics.metrics.value.lmargin + posInLine * graphics.metrics.value.charWidth
})

const cursorY = computed(() => {
  return graphics.getLineY(cursorLine.value)
})

// Measure font metrics on mount
function measureFont() {
  if (!measureRef.value) return

  const bbox = measureRef.value.getBBox()
  if (bbox.width > 0) {
    // Measure width of 50 characters to get average (matches OGP teststring)
    graphics.setFontMetrics(bbox.width / 50, bbox.height)
  }
}

// Handle container resize
function handleResize() {
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  graphics.setContainerSize(rect.width, rect.height)
}

// Context menu state
const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuItems = ref([])

// Tooltip state
const tooltipVisible = ref(false)
const tooltipX = ref(0)
const tooltipY = ref(0)
const tooltipContent = ref('')


// Get context menu items from extensions
function getExtensionContextMenuItems(context) {
  const items = []
  for (const ext of props.extensions || []) {
    if (typeof ext.contextMenuItems === 'function') {
      const extItems = ext.contextMenuItems(context, extensionAPI)
      if (Array.isArray(extItems) && extItems.length > 0) {
        items.push(...extItems)
      }
    }
  }
  return items
}

/**
 * Build global context menu items that don't depend on which region was clicked.
 * These include: Copy, Select all/none, Insert/Replace/Delete sequence, Create annotation.
 */
function buildGlobalContextMenuItems() {
  const items = []
  const isSelected = selection.isSelected.value
  const domain = selection.domain.value
  const hasSequence = editorState.sequenceLength.value > 0

  // Special case: no sequence loaded - show Insert sequence option
  if (!hasSequence && !props.readonly) {
    items.push({
      label: 'Insert sequence...',
      action: () => {
        insertModalIsReplace.value = false
        insertModalPosition.value = 0
        insertModalText.value = ''
        insertModalVisible.value = true
      }
    })
    return items
  }

  // Group 1: Copy / Select none / Select all
  if (isSelected && domain && domain.ranges.length > 0) {
    items.push({
      label: 'Copy selection',
      action: () => handleCopy()
    })
    items.push({
      label: 'Select none',
      action: () => selection.unselect()
    })
  }
  items.push({
    label: 'Select all',
    action: () => selection.selectAll()
  })

  // Group 2: Insert / Replace / Delete sequence
  if (isSelected && domain && domain.ranges.length > 0) {
    const firstRange = domain.ranges[0]
    const isZeroLength = firstRange.start === firstRange.end

    if (!props.readonly) {
      items.push({ separator: true })

      // Insert sequence option for zero-length selections (cursor position)
      if (isZeroLength) {
        items.push({
          label: 'Insert sequence...',
          action: () => {
            insertModalIsReplace.value = false
            insertModalPosition.value = firstRange.start
            insertModalText.value = ''
            insertModalVisible.value = true
          }
        })
      }

      // Replace sequence option for single non-zero-length selections only
      if (!isZeroLength && domain.ranges.length === 1) {
        items.push({
          label: 'Replace sequence with...',
          action: () => {
            insertModalIsReplace.value = true
            insertModalPosition.value = firstRange.start
            insertModalSelectionEnd.value = firstRange.end
            insertModalText.value = ''
            insertModalVisible.value = true
          }
        })
      }

      // Delete sequence option for non-zero-length selections
      if (!isZeroLength) {
        items.push({
          label: 'Delete sequence',
          action: () => handleDelete()
        })
      }
    }
  }

  // Create annotation option - always available when not readonly
  if (!props.readonly) {
    items.push({ separator: true })
    items.push({
      label: 'Create Annotation',
      action: () => openAnnotationModal()
    })
  }

  return items
}

/**
 * Build context menu using elementsFromPoint for hit-testing.
 * Combines global items with region-specific items from layers.
 *
 * @param {MouseEvent} event - The contextmenu event
 * @param {Object} context - Additional context (lineIndex, etc.)
 * @returns {Array} Combined menu items
 */
function buildContextMenuFromRegistry(event, context = {}) {
  const items = buildGlobalContextMenuItems()

  // Use elementsFromPoint to find all elements at the click position
  const elements = document.elementsFromPoint(event.clientX, event.clientY)
  const layerItems = []

  // Collect menu items from all layers
  for (const el of elements) {
    if (!el.dataset.layer) continue

    // Check each layer ref for matching items
    const layerMenuItems = [
      ...(annotationLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(selectionLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(sequenceLayerRef.value?.getMenuItemsForElement?.(el.dataset) || [])
    ]

    layerItems.push(...layerMenuItems)
  }

  // Add layer items with separator
  if (layerItems.length > 0) {
    items.push({ separator: true })
    items.push(...layerItems)
  }

  // Extension items
  let extContext = null
  if (selection.isSelected.value && selection.domain.value) {
    const selectedSeq = getSelectedSequenceText()
    extContext = {
      type: 'selection',
      data: { sequence: selectedSeq, domain: selection.domain.value }
    }
  } else if (context.pos !== undefined) {
    extContext = {
      type: 'sequence',
      data: { position: context.pos }
    }
  }

  if (extContext) {
    const extItems = getExtensionContextMenuItems(extContext)
    if (extItems.length > 0) {
      items.push({ separator: true }, ...extItems)
    }
  }

  return items
}

// Build context menu items based on current context
function buildContextMenuItems(context) {
  const items = []
  const isSelected = selection.isSelected.value
  const domain = selection.domain.value
  const hasSequence = editorState.sequenceLength.value > 0

  // Special case: no sequence loaded - show Insert sequence option
  if (!hasSequence && !props.readonly) {
    items.push({
      label: 'Insert sequence...',
      action: () => {
        insertModalIsReplace.value = false
        insertModalPosition.value = 0
        insertModalText.value = ''
        insertModalVisible.value = true
      }
    })
    return items
  }

  // Group 1: Copy / Select none / Select all
  if (isSelected && domain && domain.ranges.length > 0) {
    items.push({
      label: 'Copy selection',
      action: () => {
        handleCopy()
      }
    })
    items.push({
      label: 'Select none',
      action: () => {
        selection.unselect()
      }
    })
  }
  items.push({
    label: 'Select all',
    action: () => {
      selection.selectAll()
    }
  })

  // Group 2: Insert / Replace / Delete sequence
  if (isSelected && domain && domain.ranges.length > 0) {
    const firstRange = domain.ranges[0]
    const isZeroLength = firstRange.start === firstRange.end

    const hasSequenceActions = (isZeroLength && !props.readonly) ||
                               (!isZeroLength && !props.readonly)
    if (hasSequenceActions) {
      items.push({ separator: true })
    }

    // Insert sequence option for zero-length selections (cursor position)
    if (isZeroLength && !props.readonly) {
      items.push({
        label: 'Insert sequence...',
        action: () => {
          insertModalIsReplace.value = false
          insertModalPosition.value = firstRange.start
          insertModalText.value = ''
          insertModalVisible.value = true
        }
      })
    }

    // Replace sequence option for single non-zero-length selections only
    if (!isZeroLength && !props.readonly && domain.ranges.length === 1) {
      items.push({
        label: 'Replace sequence with...',
        action: () => {
          insertModalIsReplace.value = true
          insertModalPosition.value = firstRange.start
          insertModalSelectionEnd.value = firstRange.end
          insertModalText.value = ''
          insertModalVisible.value = true
        }
      })
    }

    // Delete sequence option for non-zero-length selections
    if (!isZeroLength && !props.readonly) {
      items.push({
        label: 'Delete sequence',
        action: () => {
          handleDelete()
        }
      })
    }
  }

  // Group 3: Create / Edit / Delete Annotation
  // Show separator before annotation actions if not readonly
  const hasAnnotationActions = !props.readonly ||
                               (context.source === 'annotation' && context.annotation && !props.readonly)
  if (hasAnnotationActions) {
    items.push({ separator: true })
  }

  // Create annotation option - always available when not readonly
  // If there's a selection with non-zero ranges, use those; otherwise open with blank fields
  if (!props.readonly) {
    items.push({
      label: 'Create Annotation',
      action: () => {
        openAnnotationModal()
      }
    })
  }

  // Annotation-specific items when right-clicking on an annotation
  if (context.source === 'annotation' && context.annotation && !props.readonly) {
    const annotation = context.annotation
    items.push({
      label: 'Edit Annotation',
      action: () => {
        openAnnotationModalForEdit(annotation)
      }
    })
    items.push({
      label: 'Delete Annotation',
      action: () => {
        // Delete annotation from document (handles backend notification)
        targetDoc.value.deleteAnnotation(annotation.id)
        // Emit for parent components
        emit('annotations-update', localAnnotations.value)
      }
    })

    // Subtract from selection option when annotation overlaps selection
    if (isSelected && domain) {
      const annotationSpan = annotation.span
      const hasOverlap = domain.ranges.some(selRange =>
        annotationSpan.ranges.some(annRange => selRange.overlaps(annRange))
      )

      if (hasOverlap) {
        items.push({
          label: 'Subtract from selection',
          action: () => {
            selection.subtractSpan(annotationSpan)
          }
        })
      }
    }

    // Merge segment options for multi-range annotations
    const fragment = context.fragment
    const spanRanges = annotation.span?.ranges
    if (fragment && fragment.rangeIndex !== undefined && spanRanges && spanRanges.length > 1) {
      const rangeIndex = fragment.rangeIndex
      const ranges = spanRanges
      const currentRange = ranges[rangeIndex]

      // Check if can merge with left (previous range)
      if (rangeIndex > 0) {
        const leftRange = ranges[rangeIndex - 1]
        // Adjacent (left.end === current.start) and same orientation
        if (leftRange.end === currentRange.start && leftRange.orientation === currentRange.orientation) {
          items.push({
            label: 'Merge with left segment',
            action: () => {
              mergeAnnotationRanges(annotation, rangeIndex - 1, rangeIndex)
            }
          })
        }
      }

      // Check if can merge with right (next range)
      if (rangeIndex < ranges.length - 1) {
        const rightRange = ranges[rangeIndex + 1]
        // Adjacent (current.end === right.start) and same orientation
        if (currentRange.end === rightRange.start && currentRange.orientation === rightRange.orientation) {
          items.push({
            label: 'Merge with right segment',
            action: () => {
              mergeAnnotationRanges(annotation, rangeIndex, rangeIndex + 1)
            }
          })
        }
      }
    }

    // Split annotation option when cursor is strictly inside a range
    if (selection.isSelected.value) {
      const selRanges = selection.domain.value?.ranges
      if (selRanges?.length === 1 && selRanges[0].start === selRanges[0].end) {
        const cursorPos = selRanges[0].start

        // Get the actual range from the annotation span
        const splitSpanRanges = annotation.span?.ranges

        const frag = context.fragment
        if (frag?.rangeIndex !== undefined && splitSpanRanges[frag.rangeIndex]) {
          const targetRange = splitSpanRanges[frag.rangeIndex]

          // Check if cursor is strictly inside (not at boundaries)
          if (cursorPos > targetRange.start && cursorPos < targetRange.end) {
            items.push({
              label: 'Split annotation',
              action: () => {
                splitAnnotationAtPosition(annotation, frag.rangeIndex, cursorPos)
              }
            })
          }
        }
      }
    }
  }

  // Group 4: Strand and Multi-range operations
  if (context.source === 'selection' && context.range && isSelected && domain) {
    const range = context.range
    const rangeIndex = context.rangeIndex

    items.push({ separator: true })

    // Strand flip options
    if (range.orientation === 1 || range.orientation === -1) {
      items.push({
        label: 'Flip strand',
        action: () => selection.flip(rangeIndex)
      })
      items.push({
        label: 'Make undirected',
        action: () => selection.setOrientation(rangeIndex, 0)
      })
    } else {
      items.push({
        label: 'Set to plus strand',
        action: () => selection.setOrientation(rangeIndex, 1)
      })
      items.push({
        label: 'Set to minus strand',
        action: () => selection.setOrientation(rangeIndex, -1)
      })
    }

    // Multi-range operations
    if (domain.ranges.length > 1) {
      items.push({
        label: 'Delete this range',
        action: () => selection.deleteRange(rangeIndex)
      })
      if (rangeIndex > 0) {
        items.push({
          label: 'Move range up',
          action: () => selection.moveRange(rangeIndex, rangeIndex - 1)
        })
      }
      if (rangeIndex < domain.ranges.length - 1) {
        items.push({
          label: 'Move range down',
          action: () => selection.moveRange(rangeIndex, rangeIndex + 1)
        })
      }
    }
  }

  // Extension context menu items
  let extContext = null
  if (context.source === 'selection' && isSelected && domain) {
    const selectedSeq = getSelectedSequenceText()
    extContext = {
      type: 'selection',
      data: { sequence: selectedSeq, domain }
    }
  } else if (context.source === 'annotation' && context.annotation) {
    const ann = context.annotation
    // Use iterateSequence to handle orientation and multi-part spans correctly
    const span = ann.span
    const seq = editorState.sequence.value
    const annSeq = [...iterateSequence(span, seq)].map(b => b.letter).join('')
    extContext = {
      type: 'annotation',
      data: { annotation: ann, sequence: annSeq, fragment: context.fragment }
    }
  } else if (context.pos !== undefined) {
    // Sequence background right-click
    extContext = {
      type: 'sequence',
      data: { position: context.pos }
    }
  }

  if (extContext) {
    const extItems = getExtensionContextMenuItems(extContext)
    if (extItems.length > 0) {
      items.push({ separator: true }, ...extItems)
    }
  }

  return items
}

// Show context menu
function showContextMenu(event, context) {
  contextMenuItems.value = buildContextMenuItems(context)
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

// Hide context menu
function hideContextMenu() {
  contextMenuVisible.value = false
}

// Handle clicks on SVG background (null space) - clears selection
function handleBackgroundClick(event) {
  if (event.button !== 0) return // Left click only
  selection.unselect()
}

/**
 * Unified click handler for the SVG.
 * Routes clicks through layers using elementsFromPoint with priority order:
 * Annotation > Selection > Sequence.
 * If no layer handles the click, clears selection (background click).
 *
 * @param {MouseEvent} event - The click event
 */
function handleSvgClick(event) {
  // Skip if not left-click
  if (event.button !== 0) return

  // Focus the SVG so keyboard shortcuts work
  focusSvg()

  // Use elementsFromPoint to find all elements at the click position
  const elements = document.elementsFromPoint(event.clientX, event.clientY)

  // Priority order: Annotation > Selection > Sequence
  for (const el of elements) {
    if (!el.dataset.layer) continue

    // Try each layer in priority order
    if (annotationLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (selectionLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (sequenceLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
  }

  // No layer handled it - clear selection (background click)
  selection.unselect()
}

// Adapter for SequenceLayer context menu events
function handleSequenceLayerContextMenu(data) {
  handleContextMenu(data.event, data.lineIndex)
}

// Selection layer event handlers
function handleSelectionChange(data) {
  // selection.source is now set automatically by SequenceLayer when starting selection

  // Focus the appropriate container so keyboard shortcuts work
  if (viewMode.value === 'circular') {
    circularContainerRef.value?.focus()
  }
  emit('select', data)
}

function handleSelectionContextMenu(data) {
  // Add selection-specific context menu items
  const items = buildContextMenuItems({
    source: 'selection',
    rangeIndex: data.rangeIndex,
    range: data.range
  })
  contextMenuItems.value = items
  contextMenuX.value = data.event.clientX
  contextMenuY.value = data.event.clientY
  contextMenuVisible.value = true
}

function handleSelectionMouseDown(data) {
  // Ctrl+click on selection path - add a new range
  const { event } = data
  if (!event.ctrlKey) return

  // Get position from the event
  const svgRect = svgRef.value.getBoundingClientRect()
  const y = event.clientY - svgRect.top
  const x = event.clientX - svgRect.left
  const lineIndex = graphics.pixelToLineIndex(y, editorState.lineCount.value)
  const linePos = graphics.pixelToLinePosition(x)
  const pos = editorState.lineToPosition(lineIndex, linePos)

  if (pos === null) return

  // Start a new range (extend=true to add to existing selection)
  selection.startSelection(pos, true)

  // Local handlers for this drag operation
  function onMove(e) {
    window.getSelection()?.removeAllRanges()
    const rect = svgRef.value.getBoundingClientRect()
    const moveY = e.clientY - rect.top
    const moveX = e.clientX - rect.left
    const moveLine = graphics.pixelToLineIndex(moveY, editorState.lineCount.value)
    const moveLinePos = graphics.pixelToLinePosition(moveX)
    const movePos = editorState.lineToPosition(moveLine, moveLinePos)
    if (movePos !== null) {
      selection.updateSelection(movePos)
    }
  }

  function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    selection.endSelection()
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

// Handle context menu on selection handles (for extend functionality)
function handleHandleContextMenu(data) {
  const { event, rangeIndex, range, handleType, isCursor } = data
  const items = []

  if (isCursor) {
    // Cursor - offer both directions
    items.push({
      label: 'Extend negative (left)',
      action: () => openExtendModal(rangeIndex, 'start', 'negative')
    })
    items.push({
      label: 'Extend positive (right)',
      action: () => openExtendModal(rangeIndex, 'end', 'positive')
    })
  } else if (handleType === 'start') {
    // Start handle - extend negative (leftward)
    items.push({
      label: 'Extend negative (left)',
      action: () => openExtendModal(rangeIndex, 'start', 'negative')
    })
  } else {
    // End handle - extend positive (rightward)
    items.push({
      label: 'Extend positive (right)',
      action: () => openExtendModal(rangeIndex, 'end', 'positive')
    })
  }

  // Extension context menu items for handle
  const extItems = getExtensionContextMenuItems({
    type: 'handle',
    data: { range, position: handleType || (isCursor ? 'cursor' : 'start') }
  })
  if (extItems.length > 0) {
    items.push({ separator: true }, ...extItems)
  }

  contextMenuItems.value = items
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

function openExtendModal(rangeIndex, handleType, direction) {
  extendModalRangeIndex.value = rangeIndex
  extendModalHandleType.value = handleType
  extendModalDirection.value = direction
  extendModalVisible.value = true
}

function handleExtendSubmit(bases) {
  const rangeIndex = extendModalRangeIndex.value
  const handleType = extendModalHandleType.value
  const direction = extendModalDirection.value
  const domain = selection.domain.value

  if (!domain || rangeIndex >= domain.ranges.length) {
    extendModalVisible.value = false
    return
  }

  const range = domain.ranges[rangeIndex]
  const seqLen = editorState.sequenceLength.value
  const docIsCircular = isCircular.value

  if (direction === 'negative') {
    // Extend leftward - decrease start
    const newStart = range.start - bases

    if (newStart < 0 && docIsCircular) {
      // Wrapping around origin - create two ranges
      const overflow = -newStart  // how much we went past 0
      range.start = 0  // Current range now starts at 0

      // Add wrapped range at end of sequence
      domain.ranges.push({
        start: seqLen - overflow,
        end: seqLen,
        orientation: range.orientation
      })
    } else {
      range.start = Math.max(0, newStart)
    }
  } else {
    // Extend rightward - increase end
    const newEnd = range.end + bases

    if (newEnd > seqLen && docIsCircular) {
      // Wrapping around origin - create two ranges
      const overflow = newEnd - seqLen  // how much we went past seqLen
      range.end = seqLen  // Current range now ends at seqLen

      // Add wrapped range at start of sequence
      domain.ranges.push({
        start: 0,
        end: overflow,
        orientation: range.orientation
      })
    } else {
      range.end = Math.min(seqLen, newEnd)
    }
  }

  // Trigger reactivity
  selection.domain.value = selection.domain.value

  extendModalVisible.value = false
}

function handleExtendCancel() {
  extendModalVisible.value = false
}

function handleAnnotationContextMenu(data) {
  // Show the same context menu as selection
  const items = buildContextMenuItems({
    source: 'annotation',
    annotation: data.annotation,
    fragment: data.fragment
  })

  // Also get layer-specific items from AnnotationLayer (e.g., clip primer binding)
  // Only when not readonly - these are edit actions
  if (!props.readonly) {
    const dataset = {
      layer: 'annotation',
      annotationId: String(data.annotation.id),
      rangeIndex: String(data.fragment?.rangeIndex ?? 0)
    }
    const layerItems = annotationLayerRef.value?.getMenuItemsForElement?.(dataset) || []
    if (layerItems.length > 0) {
      items.push({ separator: true })
      items.push(...layerItems)
    }
  }

  contextMenuItems.value = items
  contextMenuX.value = data.event.clientX
  contextMenuY.value = data.event.clientY
  contextMenuVisible.value = true

  // Also emit for parent components
  emit('annotation-contextmenu', data)
}

// Annotation click handler - select the annotation's span with its orientation
function handleAnnotationClick(data) {
  const { annotation, event } = data

  // Create a selection from the annotation's span
  if (annotation.span) {
    if (event?.shiftKey) {
      // Shift-click: extend selection if one exists, otherwise show context menu
      if (selection.isSelected.value) {
        selection.extendToSpan(annotation.span)
      } else {
        // No selection - trigger context menu (Mac-friendly right-click alternative)
        handleAnnotationContextMenu(data)
        return
      }
    } else if (event?.ctrlKey) {
      // Ctrl-click adds/merges annotation to existing selection
      const newDomain = new SelectionDomain(annotation.span)
      selection.extendSelection(newDomain)
    } else {
      // Regular click replaces selection with annotation
      const newDomain = new SelectionDomain(annotation.span)
      selection.select(newDomain)
    }
  }

  // Also emit for parent components
  emit('annotation-click', data)
}

// Annotation hover handler - show/hide tooltip
function handleAnnotationHover(data) {
  const { event, annotation, entering } = data

  if (entering) {
    // Build tooltip content
    const parts = []

    if (annotation.caption) {
      parts.push(annotation.caption)
    }

    if (annotation.type && annotation.type !== annotation.caption) {
      parts.push(`[${annotation.type}]`)
    }

    if (annotation.span) {
      parts.push(annotation.span.toGenBank())
    }

    // Add attributes (except translation which is too long, and underscore-prefixed internal attrs)
    if (annotation.attributes) {
      const entries = Object.entries(annotation.attributes)
        .filter(([key]) => key !== 'translation' && !key.startsWith('_'))
      if (entries.length > 0) {
        parts.push('')
        for (const [key, value] of entries) {
          let displayValue = Array.isArray(value) ? value.join(', ') : String(value)
          if (displayValue.length > 100) {
            displayValue = displayValue.substring(0, 100) + '...'
          }
          parts.push(`${key}: ${displayValue}`)
        }
      }
    }

    tooltipContent.value = parts.join('\n')
    tooltipX.value = event.clientX + 12
    tooltipY.value = event.clientY + 12
    tooltipVisible.value = true
  } else {
    tooltipVisible.value = false
  }

  // Also emit for parent components
  emit('annotation-hover', data)
}

/**
 * Handle request to edit an annotation (opens modal).
 * Called from AnnotationLayer when user wants to edit an annotation.
 */
function handleEditAnnotation(data) {
  const { annotation } = data
  editingAnnotation.value = annotation
  annotationModalSpan.value = annotation.span?.toJSON?.() || annotation.span || '0..0'
  annotationModalOpen.value = true
}

/**
 * Handle annotation deletion from AnnotationLayer.
 * This is a fallback when AnnotationLayer doesn't have a document.
 * Normally, AnnotationLayer calls document.deleteAnnotation directly.
 */
function handleDeleteAnnotation(data) {
  const { id } = data
  targetDoc.value.deleteAnnotation(id)
  emit('annotations-update', localAnnotations.value)
}

function handleTranslationHover(data) {
  const { event, tooltipText, entering } = data

  if (entering) {
    tooltipContent.value = tooltipText
    tooltipX.value = event.clientX + 12
    tooltipY.value = event.clientY + 12
    tooltipVisible.value = true
  } else {
    tooltipVisible.value = false
  }
}

function handleTranslationClick(data) {
  const { event, element, codonStart, codonEnd } = data

  // Create span for the codon with correct orientation
  const orientation = element.orientation === -1 ? Orientation.MINUS : Orientation.PLUS
  const codonSpan = new Span([new Range(codonStart, codonEnd, orientation)])

  if (event?.shiftKey) {
    // Shift-click extends existing selection to include codon
    selection.extendToPosition(codonStart)
    selection.extendToPosition(codonEnd)
  } else if (event?.ctrlKey) {
    // Ctrl-click adds codon to existing selection
    const newDomain = new SelectionDomain(codonSpan)
    selection.extendSelection(newDomain)
  } else {
    // Regular click replaces selection with codon
    const newDomain = new SelectionDomain(codonSpan)
    selection.select(newDomain)
  }
}

function handleTranslationContextMenu(data) {
  const { event, element, translation } = data

  const items = [{
    label: 'Copy translation',
    action: async () => {
      try {
        await navigator.clipboard.writeText(translation)
      } catch (err) {
        console.error('Failed to copy translation:', err)
      }
    }
  }]

  // Extension context menu items for translation
  const annotation = localAnnotations.value.find(a => a.id === element.annotationId)
  const extItems = getExtensionContextMenuItems({
    type: 'translation',
    data: { translation, annotation }
  })
  if (extItems.length > 0) {
    items.push({ separator: true }, ...extItems)
  }

  contextMenuItems.value = items
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

function handleContextMenu(event, lineIndex) {
  event.preventDefault()

  const pos = getPositionFromEvent(event, lineIndex)
  const context = {
    line: lineIndex,
    linepos: pos !== null ? editorState.positionInLine(pos) : 0,
    pos: pos
  }

  // Broadcast contextmenu event (for plugin communication)
  eventBus.emit('contextmenu', context)

  // Show the context menu
  showContextMenu(event, context)

  emit('contextmenu', {
    event,
    position: pos,
    line: lineIndex,
    selection: selection.domain.value?.ranges[0] ?? null
  })
}

function handleBackgroundContextMenu(event) {
  event.preventDefault()

  // Show context menu (e.g., for empty state with no sequence)
  const context = { source: 'background' }
  showContextMenu(event, context)
}

function getPositionFromEvent(event, lineIndex) {
  if (!svgRef.value) return null

  const svgRect = svgRef.value.getBoundingClientRect()
  const x = event.clientX - svgRect.left
  const linePos = graphics.pixelToLinePosition(x)

  return editorState.lineToPosition(lineIndex, linePos)
}

// Zoom handling
function handleZoomChange(event) {
  editorState.setZoom(Number(event))
}

// Clear native browser text selection (SVG text selection is hard to disable via CSS)
function clearNativeSelection() {
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
  }
}

// Copy/Cut handlers
function getSelectedSequenceText() {
  const domain = selection.domain.value

  if (domain && domain.ranges && domain.ranges.length > 0) {
    const span = new Span(domain.ranges)
    const seq = editorState.sequence.value
    // Use iterateSequence to handle coding order and complementation
    return [...iterateSequence(span, seq)].map(b => b.letter).join('')
  }

  return ''
}

async function handleCopy() {
  const selectedSeq = getSelectedSequenceText()
  if (!selectedSeq) return

  // Get selection ranges for overlay calculation
  const domain = selection.domain.value
  const selectionRanges = domain?.ranges?.filter(r => r.start !== r.end) || []

  // Find overlapping annotations and save overlay for rich paste
  if (selectionRanges.length > 0) {
    const overlappingAnnotations = getOverlappingAnnotations(selectionRanges)
    saveOverlay(selectedSeq, overlappingAnnotations)
  }

  await copyText(selectedSeq, {
    selection: selection.domain.value
  })
}

async function handlePaste() {
  // Only allow paste with cursor (zero-width) or single range selection
  const domain = selection.domain.value
  if (!domain || domain.ranges.length !== 1) return

  try {
    const clipboardText = await readText()

    if (clipboardText) {
      // Check for overlay (rich paste with annotations)
      const overlay = loadOverlay()

      if (overlay && overlay.sequence === clipboardText && overlay.annotations?.length > 0) {
        // Rich paste - store pending annotations to create after paste
        pendingOverlayAnnotations.value = overlay.annotations
      } else if (overlay && overlay.sequence !== clipboardText) {
        // Clipboard text changed externally - clear stale overlay
        clearOverlay()
        pendingOverlayAnnotations.value = null
      } else {
        pendingOverlayAnnotations.value = null
      }

      showInsertModal(clipboardText)
    }
  } catch (err) {
    console.warn('Clipboard/paste operation failed:', err)
  }
}

/**
 * Delete the currently selected ranges (if non-zero).
 * In alignment mode, routes deletion to the correct document based on selection.source.
 * Ranges are deleted from highest position first to avoid shifting issues.
 */
function deleteSelectedRange() {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return false

  // Filter to non-zero ranges and sort by start position descending
  // (delete from end first to avoid position shifting)
  const rangesToDelete = domain.ranges
    .filter(r => r.start !== r.end)
    .sort((a, b) => b.start - a.start)

  if (rangesToDelete.length === 0) return false

  // Check if ranges are contiguous/adjacent (for cursor placement after deletion)
  const sortedAsc = [...rangesToDelete].sort((a, b) => a.start - b.start)
  const docIsCircular = isCircular.value
  const seqLen = editorState.sequenceLength.value

  // Check standard linear contiguity
  let isContiguous = sortedAsc.every((range, i) => {
    if (i === 0) return true
    return sortedAsc[i - 1].end >= range.start  // Adjacent or overlapping
  })

  // For circular sequences, also check wrap-around contiguity
  if (!isContiguous && docIsCircular && sortedAsc.length >= 2) {
    const firstRange = sortedAsc[0]
    const lastRange = sortedAsc[sortedAsc.length - 1]

    if (firstRange.start === 0 && lastRange.end === seqLen) {
      isContiguous = sortedAsc.every((range, i) => {
        if (i === 0) return true
        if (i === sortedAsc.length - 1 && sortedAsc[i - 1].end < range.start) {
          return true
        }
        return sortedAsc[i - 1].end >= range.start
      })
    }
  }

  const cursorPosition = sortedAsc[0].start

  // Apply delete to the document
  const doc = targetDoc.value

  if (doc) {
    // Delete via document (handles sequence mutation, annotation adjustment, and backend notification)
    doc.delete(rangesToDelete)
    // Notify parent of annotation changes (tested by annotation tests)
    emit('annotations-update', doc.annotations)
  } else {
    // For non-document mode (string sequence prop), apply to editorState directly
    for (const range of rangesToDelete) {
      editorState.deleteRange(range.start, range.end)
    }
  }

  // Leave cursor at deletion point if contiguous, otherwise clear selection
  if (isContiguous) {
    selection.select([new Range(cursorPosition, cursorPosition)])
  } else {
    selection.unselect()
  }

  return true
}

function handleBackspace() {
  handleDelete()
}

function handleDelete() {
  // Calculate total length to delete for confirmation message
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return

  const totalLength = domain.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
  if (totalLength === 0) return

  deleteConfirmLength.value = totalLength
  deleteConfirmVisible.value = true
}

function confirmDelete() {
  deleteConfirmVisible.value = false
  // Capture selection data before deleteSelectedRange() clears it
  const domain = selection.domain.value
  const ranges = domain?.ranges?.map(r => ({ start: r.start, end: r.end })) || []

  if (deleteSelectedRange()) {
    emit('edit', {
      type: 'delete',
      ranges
    })
  }
}

function cancelDelete() {
  deleteConfirmVisible.value = false
}

// Insert/Replace modal functions
function showInsertModal(initialChar) {
  const domain = selection.domain.value
  const range = domain?.ranges?.[0]

  // Check if there's a selection (range) or just a cursor position (zero-width)
  insertModalIsReplace.value = range && range.start !== range.end
  insertModalPosition.value = range?.start ?? 0
  insertModalSelectionEnd.value = range?.end ?? 0
  insertModalOrientation.value = domain?.orientation ?? Orientation.PLUS
  insertModalText.value = initialChar
  insertModalVisible.value = true
}

function handleInsertSubmit(text, extendStartIds = [], extendEndIds = []) {
  const insertionSite = insertModalPosition.value
  const doc = targetDoc.value

  // Apply to document (handles sequence mutation, annotation adjustment, and backend notification)
  if (doc) {
    doc.insert(insertionSite, text, { extendStartIds, extendEndIds })
    // Notify parent of annotation changes (tested by backend tests)
    emit('annotations-update', doc.annotations)
  } else {
    // For non-document mode (string sequence prop), apply to editorState directly
    editorState.insertAt(insertionSite, text)
  }

  // Emit for standalone mode / parent components
  emit('edit', {
    type: 'insert',
    position: insertionSite,
    text
  })

  // 4. Create overlay annotations (rich paste)
  if (pendingOverlayAnnotations.value) {
    createOverlayAnnotations(insertionSite, pendingOverlayAnnotations.value)
    pendingOverlayAnnotations.value = null
  }
}

/**
 * Create annotations from overlay data at the paste position.
 * Each overlay annotation has relative positions that need to be converted
 * to absolute positions based on where the paste occurred.
 *
 * @param {number} pastePosition - The position where the sequence was pasted
 * @param {Array} overlayAnnotations - Annotations with relative positions
 */
function createOverlayAnnotations(pastePosition, overlayAnnotations) {
  for (const overlay of overlayAnnotations) {
    const absoluteRanges = overlay.relativeRanges.map(relRange => {
      const absStart = pastePosition + relRange.start
      const absEnd = pastePosition + relRange.end
      return new Range(absStart, absEnd, relRange.orientation)
    })

    // Remove translation attribute if present - it will be recalculated
    const attributes = { ...overlay.attributes }
    delete attributes.translation

    // Create the annotation (generates new UUID)
    handleAnnotationCreate({
      caption: overlay.caption,
      type: overlay.type,
      span: new Span(absoluteRanges),
      attributes
    })
  }
}

function handleReplaceSubmit(text, preserveAnnotations = false) {
  const selStart = insertModalPosition.value
  const selEnd = insertModalSelectionEnd.value

  // Reverse complement the text if selection was on minus strand
  const insertText = insertModalOrientation.value === Orientation.MINUS
    ? reverseComplement(text)
    : text

  const doc = targetDoc.value

  // Apply to document (handles sequence mutation, annotation adjustment, and backend notification)
  if (doc) {
    doc.replace(selStart, selEnd, insertText, { adjustAnnotations: !preserveAnnotations })
    // Notify parent of annotation changes (only when annotations were adjusted)
    if (!preserveAnnotations) {
      emit('annotations-update', doc.annotations)
    }
  } else {
    // For non-document mode (string sequence prop), apply to editorState directly
    editorState.replaceRange(selStart, selEnd, insertText)
  }

  // 2. Update selection to cover the newly inserted text, preserving orientation
  const newEnd = selStart + insertText.length
  selection.select([new Range(selStart, newEnd, insertModalOrientation.value)])

  // 4. Emit for standalone mode / parent components
  emit('edit', {
    type: 'delete',
    ranges: [{ start: selStart, end: selEnd }]
  })
  emit('edit', {
    type: 'insert',
    position: selStart,
    text: insertText
  })

  // Create overlay annotations (rich paste)
  if (pendingOverlayAnnotations.value) {
    createOverlayAnnotations(selStart, pendingOverlayAnnotations.value)
    pendingOverlayAnnotations.value = null
  }
}

function handleModalSubmit(text, annotationMode = 'default', extendSelections = []) {
  insertModalVisible.value = false
  if (!text) {
    // Clear pending overlay if modal submitted with no text
    pendingOverlayAnnotations.value = null
    svgRef.value?.focus()
    return
  }

  // Clear overlay annotations unless mode is 'include'
  if (annotationMode !== 'include') {
    pendingOverlayAnnotations.value = null
  }

  if (insertModalIsReplace.value) {
    handleReplaceSubmit(text, annotationMode === 'preserve')
  } else {
    // Parse extend selections (keys like 'ann1:start', 'ann2:end') into separate arrays
    const extendStartIds = []
    const extendEndIds = []
    for (const key of extendSelections) {
      const [id, side] = key.split(':')
      if (side === 'start') {
        extendStartIds.push(id)
      } else if (side === 'end') {
        extendEndIds.push(id)
      }
    }
    handleInsertSubmit(text, extendStartIds, extendEndIds)
  }

  svgRef.value?.focus()
}

function handleInsertCancel() {
  insertModalVisible.value = false
  // Clear pending overlay on cancel
  pendingOverlayAnnotations.value = null
  // Return focus to editor
  svgRef.value?.focus()
}

function focusSvg() {
  svgRef.value?.focus()
}

function focusCircular() {
  circularContainerRef.value?.focus()
}

// Keyboard handling
function handleKeyDown(event) {
  const key = event.key

  // Handle Ctrl/Cmd shortcuts first
  if (event.ctrlKey || event.metaKey) {
    switch (key.toLowerCase()) {
      case 'c':
        event.preventDefault()
        handleCopy()
        return
      case 'a':
        event.preventDefault()
        selection.selectAll()
        return
      case 'v':
        if (props.readonly) return
        event.preventDefault()
        handlePaste()
        return
    }
  }

  // DNA base input - show modal (disabled in readonly mode and multi-range selections)
  if (DNA_BASES.has(key) && !props.readonly) {
    const domain = selection.domain.value
    // Only show modal for single range or no selection
    if (!domain || domain.ranges.length <= 1) {
      event.preventDefault()
      showInsertModal(key.toUpperCase())
      return
    }
  }

  // Editing keys (disabled in readonly mode)
  switch (key) {
    case 'Backspace':
      if (props.readonly) break
      event.preventDefault()
      handleBackspace()
      break

    case 'Delete':
      if (props.readonly) break
      event.preventDefault()
      handleDelete()
      break

    case 'Escape':
      event.preventDefault()
      selection.unselect()
      break
  }
}

// Public API
// Note: setSequence is for initial load only - it does NOT notify the backend.
// For user edits, use the insert/delete/replace operations which properly notify the backend.
function setSequence(seq, title = '') {
  editorState.setSequence(seq, title)
}

function getSequence() {
  return editorState.sequence.value
}

function setZoom(level) {
  editorState.setZoom(level)
}

function getSelection() {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return null
  const range = domain.ranges[0]
  return { start: range.start, end: range.end }
}

/**
 * Scroll the editor to make a position visible.
 * @param {number} position - The sequence position to scroll to
 */
function scrollToPosition(position) {
  const editorContainer = containerRef.value?.querySelector('.editor-container')
  if (!editorContainer) return

  const lineIndex = editorState.positionToLine(position)
  const lineY = graphics.getLineY(lineIndex)
  const lineHeight = graphics.lineHeight.value

  const containerRect = editorContainer.getBoundingClientRect()
  const scrollTop = editorContainer.scrollTop
  const viewportTop = scrollTop
  const viewportBottom = scrollTop + containerRect.height

  // Check if line is already visible
  if (lineY >= viewportTop && lineY + lineHeight <= viewportBottom) {
    return // Already visible
  }

  // Scroll so the line is near the top with some padding
  editorContainer.scrollTo({
    top: Math.max(0, lineY - 20),
    behavior: 'smooth'
  })
}

/**
 * Set the selection programmatically.
 * @param {Span|Range[]} spec - Selection specification (Span or array of Range objects)
 */
function setSelection(spec) {
  const span = spec instanceof Span ? spec : new Span(spec)
  selection.select(span)
  // Scroll to selection start
  const bounds = span.bounds
  if (bounds) {
    scrollToPosition(bounds.start)
  }
}

/**
 * Set the selection to an annotation's span.
 * @param {string} annotationId - The annotation ID to select
 */
function selectAnnotation(annotationId) {
  const annotation = localAnnotations.value.find(ann => ann.id === annotationId)
  if (annotation && annotation.span) {
    selection.select(annotation.span)
    const bounds = annotation.span.bounds
    if (bounds) {
      scrollToPosition(bounds.start)
    }
  }
}

/**
 * Clear the current selection.
 */
function clearSelection() {
  selection.unselect()
}

/**
 * Set cursor position (zero-width selection).
 * @param {number} position - The position to place the cursor
 */
function setCursor(position) {
  selection.select([new Range(position, position)])
  scrollToPosition(position)
}

// Click outside handler for config panel
function handleClickOutside(event) {
  if (configPanelOpen.value) {
    const container = containerRef.value?.querySelector('.config-container')
    if (container && !container.contains(event.target)) {
      configPanelOpen.value = false
    }
  }
}

// Lifecycle
onMounted(() => {
  handleResize()
  measureFont()

  // Set up resize observer
  const resizeObserver = new ResizeObserver(handleResize)
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }

  // Set up click-outside handler for config panel
  document.addEventListener('click', handleClickOutside)

  emit('ready')

  onUnmounted(() => {
    resizeObserver.disconnect()
    document.removeEventListener('click', handleClickOutside)
  })
})

// Expose public API
defineExpose({
  setSequence,
  getSequence,
  setZoom,
  getSelection,
  setSelection,
  selectAnnotation,
  clearSelection,
  setCursor,
  scrollToPosition,
  editorState,
  graphics,
  eventBus,
  // Document access
  targetDoc,
  getSelectedSequence: getSelectedSequenceText,
  selectionStatusText,
  selection
})

const toolbarHelpText = `Selection Controls:
• Click: Set cursor / clear selection
• Click+Drag: Select range
• Shift+Click: Extend selection
• Ctrl+Click: Add range
• Escape: Clear selection
• Drag handles: Resize selection`
</script>

<template>
  <div class="sequence-editor" ref="containerRef">
    <Toolbar
      :zoom-level="editorState.zoomLevel.value"
      :available-zooms="availableZooms"
      :title-visible="editorState.sequenceLength.value > 0"
      :show-zoom="viewMode === 'linear'"
      :show-view-mode-toggle="showViewModeToggle"
      :view-mode="viewMode"
      :help-text="toolbarHelpText"
      :config-panel-open="configPanelOpen"
      :config-items="collectedConfigItems"
      :extensions="renderExtensions"
      @zoom-change="handleZoomChange"
      @update:view-mode="viewMode = $event"
      @toggle-config="configPanelOpen = !configPanelOpen"
    >
      <template #title>
        <slot name="title">
          {{ editorState.sequenceLength.value.toLocaleString() }} bp
        </slot>
      </template>

      <template v-if="$slots.info" #info>
        <slot name="info"></slot>
      </template>

      <template #toolbar>
        <slot name="toolbar"></slot>
      </template>

      <template #config>
        <slot name="config"></slot>
      </template>
    </Toolbar>

    <!-- Circular View (only shown when viewMode is circular) -->
    <div v-if="viewMode === 'circular'" class="editor-wrapper">
      <div
        ref="circularContainerRef"
        class="editor-container circular-container"
        tabindex="0"
        @keydown="handleKeyDown"
        @click="focusCircular"
        @paste.prevent
      >
        <CircularView
          ref="circularViewRef"
          :annotations="annotationInstances"
          :show-annotation-captions="showAnnotationCaptions"
          :extensions="props.extensions"
          @select="handleSelectionChange"
          @contextmenu="showContextMenu($event.event, $event)"
          @handle-contextmenu="handleHandleContextMenu"
          @annotation-click="handleAnnotationClick"
          @annotation-contextmenu="handleAnnotationContextMenu"
          @annotation-hover="handleAnnotationHover"
        />
      </div>

      <!-- Selection Status Display -->
      <Indicator :text="selectionStatusText" />
    </div>

    <!-- Linear SVG Editor (default view) -->
    <div v-else class="editor-wrapper">
      <div class="editor-container">
        <svg
        ref="svgRef"
        class="editor-svg"
        :width="graphics.metrics.value.fullWidth"
        :height="svgHeight"
        tabindex="0"
        @keydown="handleKeyDown"
        @click="handleSvgClick"
        @selectstart.prevent
        @dragstart.prevent
        @contextmenu.prevent
        @paste.prevent
        onselectstart="return false"
        ondragstart="return false"
      >
        <!-- Background rect to capture clicks on null space (clears selection) -->
        <rect
          x="0"
          y="0"
          :width="graphics.metrics.value.fullWidth"
          :height="svgHeight"
          class="svg-background"
          @mousedown="handleBackgroundClick"
          @contextmenu="handleBackgroundContextMenu"
        />

        <!-- Hidden text for measuring font metrics (50 chars like OGP) -->
        <text
          ref="measureRef"
          x="-1000"
          y="-1000"
          class="sequence-text"
        >aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</text>

        <!-- Empty state -->
        <text
          v-if="editorState.sequenceLength.value === 0"
          :x="graphics.metrics.value.fullWidth / 2"
          y="50"
          text-anchor="middle"
          class="empty-state"
        >
          No sequence loaded
        </text>

        <!-- Sequence Layer -->
        <SequenceLayer
          v-if="editorState.sequenceLength.value > 0"
          ref="sequenceLayerRef"
          :document="targetDoc"
          @select="handleSelectionChange"
          @contextmenu="handleSequenceLayerContextMenu"
        />

        <!-- Selection Layer (behind annotations) -->
        <SelectionLayer
          ref="selectionLayerRef"
          :line-height="graphics.lineHeight.value"
          @select="handleSelectionChange"
          @contextmenu="handleSelectionContextMenu"
          @mousedown="handleSelectionMouseDown"
          @handle-contextmenu="handleHandleContextMenu"
        />

        <!-- Translation Layer (rendered below annotations, above sequence) -->
        <TranslationLayer
          ref="translationLayerRef"
          :annotations="annotationInstances"
          :annotation-delta-y-by-line="annotationLayerRef?.annotationDeltaYByLine"
          @hover="handleTranslationHover"
          @click="handleTranslationClick"
          @contextmenu="handleTranslationContextMenu"
        />

        <!-- Annotation Layer -->
        <AnnotationLayer
          ref="annotationLayerRef"
          :document="targetDoc"
          :annotations="annotationInstances"
          :show-captions="showAnnotationCaptions"
          :show-translation="translationLayerRef?.visible ?? false"
          :offset-y="graphics.lineHeight.value"
          @click="handleAnnotationClick"
          @contextmenu="handleAnnotationContextMenu"
          @hover="handleAnnotationHover"
          @edit-annotation="handleEditAnnotation"
          @delete-annotation="handleDeleteAnnotation"
        />

        <!-- Extension graphics layers -->
        <component
          v-for="ext in renderExtensions.filter(e => e.graphicsLayer)"
          :key="ext.id + '-layer'"
          :is="ext.graphicsLayer"
        />

      </svg>
      </div>

      <!-- Selection Status Display -->
      <Indicator :text="selectionStatusText" />
    </div>

    <!-- Context Menu -->
    <ContextMenu
      :visible="contextMenuVisible"
      :x="contextMenuX"
      :y="contextMenuY"
      :items="contextMenuItems"
      @close="hideContextMenu"
    />

    <!-- Annotation Tooltip -->
    <div
      v-if="tooltipVisible"
      class="annotation-tooltip"
      :style="{ left: tooltipX + 'px', top: tooltipY + 'px' }"
    >{{ tooltipContent }}</div>

    <!-- Insert/Replace Modal -->
    <InsertModal
      :visible="insertModalVisible"
      :initial-text="insertModalText"
      :is-replace="insertModalIsReplace"
      :position="insertModalPosition"
      :orientation="insertModalOrientation"
      :overlay-annotation-count="pendingOverlayAnnotations?.length || 0"
      :selection-length="insertModalSelectionEnd - insertModalPosition"
      :affected-annotation-count="affectedAnnotationCount"
      :touching-annotations="touchingAnnotations"
      @submit="handleModalSubmit"
      @cancel="handleInsertCancel"
    />

    <!-- Annotation Creation/Edit Modal -->
    <AnnotationModal
      :open="annotationModalOpen"
      :span="annotationModalSpan"
      :sequence-length="editorState.sequence.value.length"
      :readonly="props.readonly"
      :annotation="editingAnnotation"
      :additional-fields="props.annotationFields"
      @close="closeAnnotationModal"
      @create="handleAnnotationCreate"
      @update="handleAnnotationUpdate"
    />

    <!-- Extend Selection Modal -->
    <ExtendModal
      :visible="extendModalVisible"
      :direction="extendModalDirection"
      :max-bases="extendModalMaxBases"
      @submit="handleExtendSubmit"
      @cancel="handleExtendCancel"
    />

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      :visible="deleteConfirmVisible"
      title="Delete Sequence"
      :message="`Are you sure you want to delete ${deleteConfirmLength.toLocaleString()} bp?`"
      confirm-label="Delete"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- Extension panels/overlays -->
    <component
      v-for="ext in renderExtensions.filter(e => e.panel)"
      :key="ext.id + '-panel'"
      :is="ext.panel"
    />
  </div>
</template>

<style scoped>
.sequence-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
  user-select: none;
}

.toolbar {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  border-bottom: 1px solid #ddd;
  background: #f8f8f8;
  align-items: center;
  flex-shrink: 0;
}

.zoom-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.zoom-control select {
  padding: 0.25rem 0.5rem;
  min-width: 80px;
  font-size: 14px;
  border: 1px solid #ccc;
  border-radius: 4px;
  background: white;
  cursor: pointer;
}

.info {
  color: #666;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.title-display {
  cursor: default;
}

.title-editable {
  cursor: pointer;
}

.title-editable:hover {
  text-decoration: underline;
  text-decoration-style: dotted;
}

.title-edit-container {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

.title-input {
  font-size: 14px;
  font-weight: bold;
  padding: 2px 6px;
  border: 1px solid #4a90d9;
  border-radius: 3px;
  outline: none;
  min-width: 150px;
}

.title-input:focus {
  box-shadow: 0 0 0 2px rgba(74, 144, 217, 0.2);
}

.title-edit-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 3px;
  cursor: pointer;
  padding: 0;
}

.title-edit-confirm {
  background: #22c55e;
  color: white;
}

.title-edit-confirm:hover {
  background: #16a34a;
}

.title-edit-cancel {
  background: #ef4444;
  color: white;
}

.title-edit-cancel:hover {
  background: #dc2626;
}

.icon-sm {
  width: 14px;
  height: 14px;
}

.editor-wrapper {
  flex: 1;
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.editor-container {
  flex: 1;
  overflow: auto;
  background: white;
}

.editor-svg {
  display: block;
  min-width: 100%;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}

/* Invisible background to capture clicks on null space */
.svg-background {
  fill: transparent;
  pointer-events: all;
}

/* Prevent any SVG text from being selected by the browser */
.editor-svg text {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
}

.editor-svg text::selection {
  background: transparent;
}

.editor-svg text::-moz-selection {
  background: transparent;
}

.sequence-line {
  cursor: text;
}

/* Use :deep() to style elements inside child components (SequenceLayer, AlignmentTicksLayer) */
:deep(.position-label) {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 10px;
  fill: #888;
  text-anchor: end;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}

:deep(.sequence-text) {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 16px;
  fill: #000;
  pointer-events: none;
  text-anchor: start;
}

:deep(.sequence-overlay) {
  fill: transparent;
  cursor: text;
}

/* Hide native browser text selection highlight */
:deep(.sequence-text)::selection {
  background: transparent;
}

:deep(.sequence-text)::-moz-selection {
  background: transparent;
}

:deep(.sequence-bar) {
  fill: #333;
  stroke: #000;
  stroke-width: 1px;
}

/* Selection highlighting - matches original plugin_selection.css */
.selection-highlight {
  pointer-events: none;
}

.selection-highlight.plus {
  fill: rgba(0, 255, 0, 0.5);
  stroke: rgba(0, 128, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.selection-highlight.minus {
  fill: rgba(255, 0, 0, 0.5);
  stroke: rgba(255, 0, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

.selection-highlight.undirected {
  fill: rgba(192, 192, 192, 0.5);
  stroke: rgba(0, 0, 0, 1);
  stroke-width: 2px;
  stroke-linejoin: round;
}

/* Default selection highlight (when no strand info) */
.selection-highlight {
  fill: rgba(66, 133, 244, 0.3);
}

/* Selection handles */
.sel_handle {
  cursor: col-resize;
}

.sel_handle.plus {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(0, 128, 0, 1);
}

.sel_handle.minus {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(255, 0, 0, 1);
}

.sel_handle.undirected {
  fill: rgba(200, 200, 200, 1);
  stroke: rgba(64, 64, 64, 1);
}

/* Selection tags */
.sel_tag_text {
  text-anchor: middle;
  fill: black;
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 10px;
}

.sel_tag_box {
  fill: white;
  stroke: black;
  stroke-width: 1px;
}

.empty-state {
  fill: #999;
  font-size: 16px;
}

.cursor {
  stroke: #333;
  stroke-width: 2;
  pointer-events: none;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  50% {
    opacity: 0;
  }
}

.editor-svg:focus {
  outline: 2px solid #4285f4;
  outline-offset: -2px;
}

/* Config panel styles */
.toolbar-spacer {
  flex: 1;
}

.help-button {
  background: none;
  border: none;
  cursor: help;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #666;
  margin-right: 8px;
  padding: 2px;
}

.help-button:hover {
  color: #333;
}

.config-container {
  position: relative;
}

.toolbar-button {
  background: #4CAF50;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.toolbar-button:hover {
  background: #45a049;
}

.config-button {
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  color: #666;
}

.config-button:hover {
  background: #eee;
  color: #333;
}

.config-panel {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #ddd;
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  min-width: 180px;
  z-index: 100;
}

.config-header {
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid #eee;
}

.config-header-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid #eee;
  cursor: pointer;
}

.config-header-toggle input[type="checkbox"] {
  margin: 0;
}

.config-types {
  padding: 8px 12px;
  max-height: 300px;
  overflow-y: auto;
}

.config-empty {
  padding: 8px 12px;
  color: #999;
  font-size: 13px;
}

.config-section {
  border-top: 1px solid #eee;
}

.config-section .config-header {
  border-bottom: none;
}

.config-section .type-row {
  padding: 4px 12px 8px 12px;
}

.type-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  cursor: pointer;
}

.type-row input[type="checkbox"] {
  margin: 0;
}

/* Color swatch - fill color comes from inline style (persisted to localStorage) */
.type-swatch {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.type-name {
  flex: 1;
  font-size: 13px;
}

.config-actions {
  padding: 8px 12px;
  border-top: 1px solid #eee;
  display: flex;
  gap: 8px;
}

.config-actions button {
  flex: 1;
  padding: 4px 8px;
  font-size: 12px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #f8f8f8;
  cursor: pointer;
}

.config-actions button:hover {
  background: #eee;
}

/* Heroicon sizes for toolbar */
.icon-toolbar {
  width: 16px;
  height: 16px;
}

.icon-toolbar-lg {
  width: 18px;
  height: 18px;
}

/* Info button in toolbar */
.info-button {
  background: none;
  border: none;
  padding: 2px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #666;
  margin-left: 6px;
  vertical-align: middle;
}

.info-button:hover {
  color: #333;
}

/* Annotation tooltip */
.annotation-tooltip {
  position: fixed;
  z-index: 2000;
  background: #333;
  color: white;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
  font-family: system-ui, -apple-system, sans-serif;
  white-space: pre-line;
  max-width: 350px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  pointer-events: none;
}

/* View mode toggle */
.view-mode-toggle {
  display: flex;
  border: 1px solid #ddd;
  border-radius: 4px;
  overflow: hidden;
}

.view-mode-btn {
  padding: 4px 12px;
  border: none;
  background: white;
  font-size: 13px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.view-mode-btn:hover {
  background: #f0f0f0;
}

.view-mode-btn.active {
  background: #4a90d9;
  color: white;
}

.view-mode-btn:first-child {
  border-right: 1px solid #ddd;
}

/* Circular container fills available space */
.circular-container {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  outline: none;
}

.circular-container:focus {
  outline: 2px solid #4285f4;
  outline-offset: -2px;
}

/* Selection status display in lower right corner */
.selection-status {
  position: absolute;
  bottom: 8px;
  right: 8px;
  background: rgba(255, 255, 255, 0.95);
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 4px 8px;
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 12px;
  color: #333;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  pointer-events: none;
  z-index: 10;
}

/* Mobile responsive styles */
@media (max-width: 768px) {
  .toolbar {
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.5rem;
  }

  .toolbar-spacer {
    display: none;
  }

  .info {
    width: 100%;
    order: -1;
    justify-content: center;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid #eee;
  }

  .zoom-control {
    font-size: 13px;
  }

  .view-mode-toggle {
    order: 1;
  }

  .help-button {
    margin-right: 0;
  }
}

/* Alignment mode styles */
.alignment-block {
  /* Container for query + match + target rows */
}

/* Use :deep() for styles targeting elements inside SequenceLayer/AlignmentTicksLayer */
:deep(.alignment-query-text) {
  fill: #333;
}

:deep(.alignment-target-text) {
  fill: #333;
}

:deep(.alignment-match-text) {
  fill: #666;
}

.query-label {
  fill: #666;
}

.target-label {
  fill: #666;
}
</style>
