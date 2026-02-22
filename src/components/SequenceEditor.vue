<script setup>
import { ref, computed, onMounted, onUnmounted, provide, watch, nextTick } from 'vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { usePersistedZoom } from '../composables/usePersistedZoom.js'
import { useSelection, SelectionDomain } from '../composables/useSelection.js'
import { Annotation } from '../utils/annotation.js'
import { Span, Range, Orientation, iterateSequence } from '../utils/dna.js'
import { iterateCodons } from '../utils/translation.js'
import { InformationCircleIcon, Cog6ToothIcon, QuestionMarkCircleIcon, CheckIcon, XMarkIcon } from '@heroicons/vue/24/outline'
import AnnotationLayer from './AnnotationLayer.vue'
import TranslationLayer from './TranslationLayer.vue'
import SelectionLayer from './SelectionLayer.vue'
import CircularView from './CircularView.vue'
import ContextMenu from './ContextMenu.vue'
import InsertModal from './InsertModal.vue'
import MetadataModal from './MetadataModal.vue'
import AnnotationModal from './AnnotationModal.vue'
import ExtendModal from './ExtendModal.vue'

const props = defineProps({
  /** DNA sequence string to display */
  sequence: {
    type: String,
    default: ''
  },
  /** Title for the sequence */
  title: {
    type: String,
    default: ''
  },
  /** Initial zoom level (bases per line) */
  initialZoom: {
    type: Number,
    default: 100
  },
  /** Array of Annotation objects to display */
  annotations: {
    type: Array,
    default: () => []
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
  /** Sequence metadata (molecule_type, definition, etc.) */
  metadata: {
    type: Object,
    default: () => ({})
  },
  /** Backend adapter for server communication (LiveView, IndexedDB, etc.) */
  backend: {
    type: Object,
    default: null
  },
  /** Array of extension objects */
  extensions: {
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

// Effective backend - returns null when readonly to prevent any edits
// This is a safety measure in addition to UI disabling
const effectiveBackend = computed(() => props.readonly ? null : props.backend)

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

// Rich paste state - holds overlay annotations to create after paste
const pendingOverlayAnnotations = ref(null)

// Annotation modal state
const annotationModalOpen = ref(false)
const annotationModalSpan = ref('0..0')
const editingAnnotation = ref(null)  // null = create mode, annotation object = edit mode

// Extend modal state
const extendModalVisible = ref(false)
const extendModalDirection = ref('positive')
const extendModalRangeIndex = ref(0)
const extendModalHandleType = ref('end')  // 'start' or 'end'

// Computed max bases for extend modal
const extendModalMaxBases = computed(() => {
  if (!extendModalVisible.value) return null

  const domain = selection.domain.value
  if (!domain || extendModalRangeIndex.value >= domain.ranges.length) return null

  const range = domain.ranges[extendModalRangeIndex.value]
  const seqLen = editorState.sequenceLength.value
  const direction = extendModalDirection.value
  const isCircular = props.metadata?.circular === true

  if (direction === 'negative') {
    if (isCircular) {
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
    if (isCircular) {
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

// Title editing state
const editingTitle = ref(false)
const editTitleValue = ref('')
const titleInputRef = ref(null)

// View mode state ('linear' | 'circular')
// Only circular sequences can switch to circular view
const viewMode = ref('linear')

// Computed: whether to show the view mode toggle
const showViewModeToggle = computed(() => props.metadata?.circular === true)

// Initialize composables
const editorState = useEditorState()
const graphics = useGraphics(editorState)
const eventBus = createEventBus()

// Selection is owned here and provided to children (single source of truth)
const selection = useSelection(editorState, graphics, eventBus)

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

// Computed property for selection status text displayed in lower right corner
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
  return `selected: ${genbankStr} (${totalLength} ${baseWord})`
})

// Set initial zoom from localStorage (fallback to prop)
const { getInitialZoom, saveZoom } = usePersistedZoom(props.initialZoom)
editorState.setZoom(getInitialZoom())

// Persist zoom changes to localStorage
watch(editorState.zoomLevel, (newZoom) => {
  saveZoom(newZoom)
})

// Watch for sequence prop changes to initialize/update the editor
watch(() => props.sequence, (newSeq) => {
  if (newSeq) {
    editorState.setSequence(newSeq, props.title)
    // Re-apply persisted zoom now that sequence is loaded (setZoom clamps based on length)
    editorState.setZoom(getInitialZoom())
  }
}, { immediate: true })

// Watch for title changes
watch(() => props.title, (newTitle) => {
  if (editorState.sequence.value) {
    editorState.title.value = newTitle
  }
})

// Local copy of annotations for optimistic UI updates
// This allows us to adjust annotation positions locally before server confirmation
const localAnnotations = ref([...props.annotations])

// Watch for annotation prop changes (from server)
watch(() => props.annotations, (newAnnotations) => {
  localAnnotations.value = [...newAnnotations]
}, { deep: true })

// Annotation filtering state with localStorage persistence
const HIDDEN_TYPES_KEY = 'opengenepool-hidden-annotation-types'
const DEFAULT_HIDDEN_TYPES = ['source']  // Hide source annotations by default

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
    const annSpan = typeof ann.span === 'string' ? Span.parse(ann.span) : ann.span
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
// These default colors match annotation.js ANNOTATION_COLORS.
// Colors are saved to localStorage so users can customize them in the future.
// When first loaded, defaults are written to localStorage if not present.
const COLORS_KEY = 'opengenepool-annotation-colors'
const DEFAULT_ANNOTATION_COLORS = {
  gene: '#4CAF50',           // green
  CDS: '#2196F3',            // blue
  promoter: '#FF9800',       // orange
  terminator: '#F44336',     // red
  misc_feature: '#9E9E9E',   // gray
  rep_origin: '#9C27B0',     // purple
  origin: '#9C27B0',         // purple (alias)
  primer_bind: '#00BCD4',    // cyan
  protein_bind: '#795548',   // brown
  regulatory: '#FFEB3B',     // yellow
  source: '#B0BEC5',         // light blue-gray
  _default: '#607D8B'        // default blue-gray for unknown types
}

function loadHiddenTypes() {
  const stored = localStorage.getItem(HIDDEN_TYPES_KEY)
  if (stored) {
    try {
      return new Set(JSON.parse(stored))
    } catch {
      return new Set(DEFAULT_HIDDEN_TYPES)
    }
  }
  return new Set(DEFAULT_HIDDEN_TYPES)
}

// Load annotation colors from localStorage.
// If no colors are stored, save the defaults to localStorage and return them.
// This ensures users always have a baseline that can be customized later.
function loadAnnotationColors() {
  const stored = localStorage.getItem(COLORS_KEY)
  if (stored) {
    try {
      // Merge with defaults to handle any new types added in future versions
      return { ...DEFAULT_ANNOTATION_COLORS, ...JSON.parse(stored) }
    } catch {
      // Corrupted data - reset to defaults
      localStorage.setItem(COLORS_KEY, JSON.stringify(DEFAULT_ANNOTATION_COLORS))
      return { ...DEFAULT_ANNOTATION_COLORS }
    }
  }
  // First load - save defaults to localStorage
  localStorage.setItem(COLORS_KEY, JSON.stringify(DEFAULT_ANNOTATION_COLORS))
  return { ...DEFAULT_ANNOTATION_COLORS }
}

const hiddenTypes = ref(loadHiddenTypes())
const annotationColors = ref(loadAnnotationColors())
const configPanelOpen = ref(false)

// Shared visibility state for layers (used by both linear and circular views)
const showAnnotations = ref(true)
const showTranslation = ref(true)

// Refs to layer components
const annotationLayerRef = ref(null)
const translationLayerRef = ref(null)

// Save colors to localStorage whenever they change
watch(annotationColors, (newColors) => {
  localStorage.setItem(COLORS_KEY, JSON.stringify(newColors))
}, { deep: true })

// Get color for an annotation type, falling back to default
function getTypeColor(type) {
  return annotationColors.value[type] || annotationColors.value._default
}

// Save to localStorage whenever hiddenTypes changes
watch(hiddenTypes, (newValue) => {
  localStorage.setItem(HIDDEN_TYPES_KEY, JSON.stringify([...newValue]))
}, { deep: true })

// Extract unique types from annotations for the filter UI
const annotationTypes = computed(() => {
  const types = new Set(localAnnotations.value.map(a => a.type || 'misc_feature'))
  return [...types].sort()
})

// Convert plain annotation objects to Annotation class instances, filtering hidden types
const annotationInstances = computed(() => {
  return localAnnotations.value
    .filter(ann => !hiddenTypes.value.has(ann.type || 'misc_feature'))
    .map(ann => {
      // If already an Annotation instance, return as-is
      if (ann instanceof Annotation) return ann
      // Convert plain object to Annotation
      return new Annotation(ann)
    })
})

// CDS annotations for translation display (only visible CDS annotations)
const cdsAnnotations = computed(() => {
  return annotationInstances.value.filter(ann => ann.type?.toUpperCase() === 'CDS')
})

// Metadata display helpers
const hasMetadata = computed(() => {
  const m = props.metadata
  return m && (m.molecule_type || m.definition)
})

const metadataModalOpen = ref(false)

function openMetadataModal() {
  metadataModalOpen.value = true
}

function closeMetadataModal() {
  metadataModalOpen.value = false
}

// Title editing
function startEditingTitle() {
  if (props.readonly) return
  editTitleValue.value = editorState.title.value || ''
  editingTitle.value = true
  // Focus input after DOM update
  nextTick(() => {
    titleInputRef.value?.focus()
    titleInputRef.value?.select()
  })
}

function cancelEditingTitle() {
  editingTitle.value = false
  editTitleValue.value = ''
}

function confirmEditingTitle() {
  const newTitle = editTitleValue.value.trim()
  if (newTitle && newTitle !== editorState.title.value) {
    editorState.title.value = newTitle
    effectiveBackend.value?.titleUpdate?.({
      id: crypto.randomUUID(),
      title: newTitle
    })
  }
  editingTitle.value = false
  editTitleValue.value = ''
}

function handleTitleKeydown(event) {
  if (event.key === 'Enter') {
    event.preventDefault()
    confirmEditingTitle()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditingTitle()
  }
}

// Annotation creation modal
function openAnnotationModal() {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return

  // Don't open if any range is zero-length
  if (!domain.ranges.every(r => r.start !== r.end)) return

  // Build span string from all ranges (join with +)
  const spanStr = domain.ranges
    .map(r => new Range(r.start, r.end, r.orientation).toString())
    .join(' + ')
  annotationModalSpan.value = spanStr
  annotationModalOpen.value = true
}

function closeAnnotationModal() {
  annotationModalOpen.value = false
  editingAnnotation.value = null
}

function openAnnotationModalForEdit(annotation) {
  editingAnnotation.value = annotation
  // Set span from annotation (for display purposes, though AnnotationModal will parse from annotation)
  const spanStr = typeof annotation.span === 'string'
    ? annotation.span
    : annotation.span?.toString() || '0..0'
  annotationModalSpan.value = spanStr
  annotationModalOpen.value = true
}

function handleAnnotationUpdate(data) {
  const annotationId = editingAnnotation.value.id

  effectiveBackend.value?.annotationUpdate?.({
    id: crypto.randomUUID(),
    annotationId,
    caption: data.caption,
    type: data.type,
    span: data.span,
    attributes: data.attributes
  })

  // Update local state for optimistic UI
  localAnnotations.value = localAnnotations.value.map(ann =>
    ann.id === annotationId
      ? { ...ann, caption: data.caption, type: data.type, span: data.span, attributes: data.attributes }
      : ann
  )
  // Emit for parent components (standalone mode)
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

  // Create new span string
  const newSpanStr = newRanges.map(r => r.toString()).join(' + ')

  // Send update to backend
  effectiveBackend.value?.annotationUpdate?.({
    id: crypto.randomUUID(),
    annotationId: annotation.id,
    caption: annotation.caption,
    type: annotation.type,
    span: newSpanStr,
    attributes: annotation.attributes
  })

  // Update local state for optimistic UI
  localAnnotations.value = localAnnotations.value.map(ann =>
    ann.id === annotation.id
      ? { ...ann, span: newSpanStr }
      : ann
  )
  // Emit for parent components (standalone mode)
  emit('annotations-update', localAnnotations.value)
}

/**
 * Split a range within an annotation's span at a given position.
 * @param {Object} annotation - The annotation to modify
 * @param {number} rangeIndex - Index of the range to split
 * @param {number} position - Position at which to split the range
 */
function splitAnnotationAtPosition(annotation, rangeIndex, position) {
  const spanRanges = annotation.span?.ranges || Span.parse(annotation.span).ranges
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

  const newSpanStr = newRanges.map(r => r.toString()).join(' + ')

  // Update backend
  effectiveBackend.value?.annotationUpdate?.({
    id: crypto.randomUUID(),
    annotationId: annotation.id,
    caption: annotation.caption,
    type: annotation.type,
    span: newSpanStr,
    attributes: annotation.attributes
  })

  // Update local state
  const updatedAnnotations = localAnnotations.value.map(a => {
    if (a.id === annotation.id) {
      return { ...a, span: newSpanStr }
    }
    return a
  })
  localAnnotations.value = updatedAnnotations
  emit('annotations-update', updatedAnnotations)
}

function handleAnnotationCreate(data) {
  // Generate a new UUID for the annotation
  const annotationId = crypto.randomUUID()

  // For CDS annotations, compute the translation string
  let attributes = data.attributes || {}
  if (data.type?.toUpperCase() === 'CDS') {
    const span = Span.parse(data.span)
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
    span: data.span,
    attributes
  }

  // Send to backend
  effectiveBackend.value?.annotationCreated?.(newAnnotation)

  // Update local state for optimistic UI
  localAnnotations.value = [...localAnnotations.value, newAnnotation]
  // Emit for parent components (standalone mode)
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

// Annotation filter handlers
function toggleAnnotationType(type) {
  const newSet = new Set(hiddenTypes.value)
  if (newSet.has(type)) {
    newSet.delete(type)
  } else {
    newSet.add(type)
  }
  hiddenTypes.value = newSet
}

function isTypeHidden(type) {
  return hiddenTypes.value.has(type)
}

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
  getSelectedSequence: getSelectedSequenceText,
  getAnnotations: () => localAnnotations.value,

  // Actions
  setSelection,
  clearSelection,
  scrollToPosition,

  // Annotation creation
  addAnnotation: (data) => {
    // data: { span: string, type: string, label: string, color?: string, attributes?: object }
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

// Selection state
const isDragging = ref(false)
const dragStart = ref(null)

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

// Build context menu items based on current context
function buildContextMenuItems(context) {
  const items = []
  const isSelected = selection.isSelected.value
  const domain = selection.domain.value

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
  const hasAnnotationActions = (isSelected && domain && domain.ranges.length > 0 &&
                                domain.ranges.every(r => r.start !== r.end) && !props.readonly) ||
                               (context.source === 'annotation' && context.annotation && !props.readonly)
  if (hasAnnotationActions) {
    items.push({ separator: true })
  }

  // Create annotation option when all ranges have non-zero length
  if (isSelected && domain && domain.ranges.length > 0) {
    const allRangesNonZero = domain.ranges.every(r => r.start !== r.end)
    if (allRangesNonZero && !props.readonly) {
      items.push({
        label: 'Create Annotation',
        action: () => {
          openAnnotationModal()
        }
      })
    }
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
        effectiveBackend.value?.annotationDeleted?.({
          id: crypto.randomUUID(),
          annotationId: annotation.id
        })

        // Update local state for optimistic UI
        localAnnotations.value = localAnnotations.value.filter(ann => ann.id !== annotation.id)
        // Emit for parent components (standalone mode)
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
        const splitSpanRanges = annotation.span?.ranges ||
          (typeof annotation.span === 'string' ? Span.parse(annotation.span).ranges : [])

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
    // Handle both Span objects and string spans
    const spanBounds = ann.span?.bounds ?? null
    const annSeq = spanBounds ? editorState.sequence.value.slice(spanBounds.start, spanBounds.end) : ''
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

function handleMouseDown(event, lineIndex) {
  if (event.button !== 0) return // Left click only

  // Prevent native text selection
  event.preventDefault()
  clearNativeSelection()

  const pos = getPositionFromEvent(event, lineIndex)
  if (pos === null) return

  isDragging.value = true
  dragStart.value = pos

  // Shift-click extends existing selection to position
  if (event.shiftKey && selection.isSelected.value) {
    selection.extendToPosition(pos)
    return  // Don't start a new drag
  }

  // Start a new selection (or add range with Ctrl)
  selection.startSelection(pos, event.ctrlKey)

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event) {
  if (!isDragging.value || dragStart.value === null) return

  // Clear any native text selection that the browser creates
  clearNativeSelection()

  // Find which line we're over
  const svgRect = svgRef.value.getBoundingClientRect()
  const y = event.clientY - svgRect.top
  const lineIndex = graphics.pixelToLineIndex(y, editorState.lineCount.value)

  const pos = getPositionFromEvent(event, lineIndex)
  if (pos !== null) {
    selection.updateSelection(pos)
  }
}

function handleMouseUp() {
  isDragging.value = false
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)

  selection.endSelection()

  // Emit select event if there's a non-zero selection
  const domain = selection.domain.value
  if (domain && domain.ranges.length > 0) {
    const range = domain.ranges[0]
    if (range.start !== range.end) {
      const seq = editorState.sequence.value.slice(range.start, range.end)
      emit('select', { start: range.start, end: range.end, sequence: seq })
    }
  }
}

// Selection layer event handlers
function handleSelectionChange(data) {
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

  // Set up drag handling
  isDragging.value = true
  dragStart.value = pos

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
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
  const isCircular = props.metadata?.circular === true

  if (direction === 'negative') {
    // Extend leftward - decrease start
    const newStart = range.start - bases

    if (newStart < 0 && isCircular) {
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

    if (newEnd > seqLen && isCircular) {
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
        const bounds = annotation.span.bounds
        selection.extendToPosition(bounds.start)
        selection.extendToPosition(bounds.end)
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
      parts.push(annotation.span.toString())
    }

    // Add attributes (except translation which is too long)
    if (annotation.attributes) {
      const entries = Object.entries(annotation.attributes)
        .filter(([key]) => key !== 'translation')
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
  // Minus strand uses parentheses: (start..end)
  const isMinus = element.orientation === -1
  const spanStr = isMinus
    ? `(${codonStart}..${codonEnd})`
    : `${codonStart}..${codonEnd}`

  if (event?.shiftKey) {
    // Shift-click extends existing selection to include codon
    selection.extendToPosition(codonStart)
    selection.extendToPosition(codonEnd)
  } else if (event?.ctrlKey) {
    // Ctrl-click adds codon to existing selection
    const codonSpan = Span.parse(spanStr)
    const newDomain = new SelectionDomain(codonSpan)
    selection.extendSelection(newDomain)
  } else {
    // Regular click replaces selection with codon
    const codonSpan = Span.parse(spanStr)
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

function getPositionFromEvent(event, lineIndex) {
  if (!svgRef.value) return null

  const svgRect = svgRef.value.getBoundingClientRect()
  const x = event.clientX - svgRect.left
  const linePos = graphics.pixelToLinePosition(x)

  return editorState.lineToPosition(lineIndex, linePos)
}

// Zoom handling
function handleZoomChange(event) {
  editorState.setZoom(Number(event.target.value))
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

  if (effectiveBackend.value?.copy) {
    // Backend handles copy (may do additional processing)
    await effectiveBackend.value.copy({
      text: selectedSeq,
      selection: selection.domain.value
    })
  } else {
    // Default: write to system clipboard
    await navigator.clipboard.writeText(selectedSeq)
  }
}

async function handleCut() {
  const selectedSeq = getSelectedSequenceText()
  if (selectedSeq && selection.isSelected.value) {
    await handleCopy()  // Use the copy logic (backend or default)
    deleteSelectedRange()
    emit('edit', { type: 'cut', text: selectedSeq })
  }
}

async function handlePaste() {
  // Only allow paste with cursor (zero-width) or single range selection
  const domain = selection.domain.value
  if (!domain || domain.ranges.length !== 1) return

  try {
    let clipboardText

    if (effectiveBackend.value?.paste) {
      // Backend provides paste content (may transform or fetch from server)
      clipboardText = await effectiveBackend.value.paste()
    } else {
      // Default: read from system clipboard
      clipboardText = await navigator.clipboard.readText()
    }

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
 * Sends delete operations to backend for each range and clears selection.
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
  // Sort ascending to check adjacency
  const sortedAsc = [...rangesToDelete].sort((a, b) => a.start - b.start)
  const isCircular = props.metadata?.circular === true
  const seqLen = editorState.sequenceLength.value

  // Check standard linear contiguity
  let isContiguous = sortedAsc.every((range, i) => {
    if (i === 0) return true
    return sortedAsc[i - 1].end >= range.start  // Adjacent or overlapping
  })

  // For circular sequences, also check wrap-around contiguity
  // e.g., ranges [0..10, 90..100] on a 100bp circular sequence are adjacent at the origin
  if (!isContiguous && isCircular && sortedAsc.length >= 2) {
    const firstRange = sortedAsc[0]
    const lastRange = sortedAsc[sortedAsc.length - 1]

    // Check if ranges wrap around: first starts at 0, last ends at seqLen
    if (firstRange.start === 0 && lastRange.end === seqLen) {
      // Check that all ranges except the wrap point are contiguous
      isContiguous = sortedAsc.every((range, i) => {
        if (i === 0) return true
        // Skip the gap between last (by position) and first - that's the wrap point
        if (i === sortedAsc.length - 1 && sortedAsc[i - 1].end < range.start) {
          // This is the wrap gap - allowed for circular
          return true
        }
        return sortedAsc[i - 1].end >= range.start
      })
    }
  }

  const cursorPosition = sortedAsc[0].start

  for (const range of rangesToDelete) {
    const editId = crypto.randomUUID()

    // 1. Apply locally (optimistic UI)
    editorState.deleteRange(range.start, range.end)

    // 2. Adjust annotations (delete is a replace with 0-length text)
    adjustAnnotationsForReplace(range.start, range.end, 0)

    // 3. Send to backend if connected
    if (effectiveBackend.value?.delete) {
      effectiveBackend.value.delete({ id: editId, start: range.start, end: range.end })
    }
  }

  // Leave cursor at deletion point if contiguous, otherwise clear selection
  if (isContiguous) {
    selection.select(`${cursorPosition}..${cursorPosition}`)
  } else {
    selection.unselect()
  }

  return true
}

function handleBackspace() {
  if (deleteSelectedRange()) {
    emit('edit', { type: 'backspace' })
  }
}

function handleDelete() {
  if (deleteSelectedRange()) {
    emit('edit', { type: 'delete' })
  }
}

// Insert/Replace modal functions
function showInsertModal(initialChar) {
  const domain = selection.domain.value
  const range = domain?.ranges?.[0]

  // Check if there's a selection (range) or just a cursor position (zero-width)
  insertModalIsReplace.value = range && range.start !== range.end
  insertModalPosition.value = range?.start ?? 0
  insertModalSelectionEnd.value = range?.end ?? 0
  insertModalText.value = initialChar
  insertModalVisible.value = true
}

/**
 * Adjust annotations for a pure insertion at a position.
 * Algorithm: if start > site, start += length; if end > site, end += length
 */
function adjustAnnotationsForInsert(insertionSite, insertionLength) {
  if (localAnnotations.value.length === 0) return

  const updatedAnnotations = localAnnotations.value.map(ann => {
    const span = Span.parse(ann.span)
    let modified = false

    for (let i = 0; i < span.ranges.length; i++) {
      const range = span.ranges[i]
      let newStart = range.start
      let newEnd = range.end

      if (range.start > insertionSite) {
        newStart += insertionLength
      }
      if (range.end > insertionSite) {
        newEnd += insertionLength
      }

      if (newStart !== range.start || newEnd !== range.end) {
        span.ranges[i] = new Range(newStart, newEnd, range.orientation)
        modified = true
      }
    }

    if (modified) {
      return { ...ann, span: span.toString() }
    }
    return ann
  })

  // Update local state for optimistic UI
  localAnnotations.value = updatedAnnotations
  // Emit for parent components (standalone mode)
  emit('annotations-update', updatedAnnotations)
}

/**
 * Adjust annotations for a replacement (delete + insert).
 */
function adjustAnnotationsForReplace(selStart, selEnd, insertionLength) {
  if (localAnnotations.value.length === 0) return

  const deletionLength = selEnd - selStart
  const netChange = insertionLength - deletionLength

  const updatedAnnotations = localAnnotations.value.map(ann => {
    const span = Span.parse(ann.span)
    let modified = false

    for (let i = 0; i < span.ranges.length; i++) {
      const range = span.ranges[i]
      let newStart = range.start
      let newEnd = range.end

      // Entirely before selection - no change
      if (range.end <= selStart) {
        // No change
      }
      // Entirely after selection - shift by net change
      else if (range.start >= selEnd) {
        newStart = range.start + netChange
        newEnd = range.end + netChange
      }
      // Contains selection (annotation spans across replaced region)
      else if (range.start <= selStart && range.end >= selEnd) {
        newEnd = range.end + netChange
      }
      // Contained by selection (annotation is within replaced region)
      else if (range.start >= selStart && range.end <= selEnd) {
        newStart = selStart
        newEnd = selStart
      }
      // Overlaps left (starts before, ends inside selection)
      else if (range.start < selStart && range.end > selStart && range.end < selEnd) {
        newEnd = selStart
      }
      // Overlaps right (starts inside selection, ends after)
      else if (range.start > selStart && range.start < selEnd && range.end > selEnd) {
        newStart = selStart + insertionLength
        newEnd = range.end + netChange
      }

      if (newStart !== range.start || newEnd !== range.end) {
        span.ranges[i] = new Range(newStart, newEnd, range.orientation)
        modified = true
      }
    }

    if (modified) {
      return { ...ann, span: span.toString() }
    }
    return ann
  })

  // Update local state for optimistic UI
  localAnnotations.value = updatedAnnotations
  // Emit for parent components (standalone mode)
  emit('annotations-update', updatedAnnotations)
}

function handleInsertSubmit(text) {
  const insertionSite = insertModalPosition.value
  const editId = crypto.randomUUID()

  // 1. Apply locally (optimistic UI)
  editorState.insertAt(insertionSite, text)
  adjustAnnotationsForInsert(insertionSite, text.length)

  // 2. Send to backend if connected
  if (effectiveBackend.value?.insert) {
    effectiveBackend.value.insert({ id: editId, position: insertionSite, text })
  }

  // 3. Emit for standalone mode / parent components
  emit('edit', { type: 'insert', position: insertionSite, text })

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
    // Build span string from relative ranges converted to absolute positions
    const absoluteRanges = overlay.relativeRanges.map(relRange => {
      const absStart = pastePosition + relRange.start
      const absEnd = pastePosition + relRange.end
      return new Range(absStart, absEnd, relRange.orientation)
    })

    // Create span string
    const spanStr = absoluteRanges.map(r => r.toString()).join(' + ')

    // Remove translation attribute if present - it will be recalculated
    const attributes = { ...overlay.attributes }
    delete attributes.translation

    // Create the annotation (generates new UUID)
    handleAnnotationCreate({
      caption: overlay.caption,
      type: overlay.type,
      span: spanStr,
      attributes
    })
  }
}

function handleReplaceSubmit(text) {
  const selStart = insertModalPosition.value
  const selEnd = insertModalSelectionEnd.value

  // 1. Apply locally (optimistic UI)
  editorState.replaceRange(selStart, selEnd, text)
  adjustAnnotationsForReplace(selStart, selEnd, text.length)

  // 2. Send to backend if connected (delete + insert)
  if (effectiveBackend.value?.delete) {
    effectiveBackend.value.delete({
      id: crypto.randomUUID(),
      start: selStart,
      end: selEnd
    })
  }

  if (effectiveBackend.value?.insert) {
    effectiveBackend.value.insert({
      id: crypto.randomUUID(),
      position: selStart,
      text: text
    })
  }

  // 3. Update selection to cover the newly inserted text
  selection.select(`${selStart}..${selStart + text.length}`)

  // 4. Emit for standalone mode / parent components
  emit('edit', { type: 'replace', text })

  // Create overlay annotations (rich paste)
  if (pendingOverlayAnnotations.value) {
    createOverlayAnnotations(selStart, pendingOverlayAnnotations.value)
    pendingOverlayAnnotations.value = null
  }
}

function handleModalSubmit(text, includeAnnotations = true) {
  insertModalVisible.value = false
  if (!text) {
    // Clear pending overlay if modal submitted with no text
    pendingOverlayAnnotations.value = null
    svgRef.value?.focus()
    return
  }

  // Clear overlay annotations if user unchecked the toggle
  if (!includeAnnotations) {
    pendingOverlayAnnotations.value = null
  }

  if (insertModalIsReplace.value) {
    handleReplaceSubmit(text)
  } else {
    handleInsertSubmit(text)
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
      case 'x':
        if (props.readonly) return
        event.preventDefault()
        handleCut()
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
 * @param {string} spec - Selection specification:
 *   - Span format: "10..20" or "10..20 + 30..40"
 *   - Annotation reference: "a:<annotation_id>"
 */
function setSelection(spec) {
  // Check for annotation reference format "a:<id>"
  if (spec.startsWith('a:')) {
    const annotationId = spec.slice(2)
    const annotation = localAnnotations.value.find(ann => ann.id === annotationId)
    if (annotation && annotation.span) {
      selection.select(annotation.span)
      // Scroll to annotation start
      const startMatch = annotation.span.match(/^(\d+)/)
      if (startMatch) {
        scrollToPosition(parseInt(startMatch[1], 10))
      }
    }
    return
  }
  selection.select(spec)
  // Scroll to selection start
  const startMatch = spec.match(/^(\d+)/)
  if (startMatch) {
    scrollToPosition(parseInt(startMatch[1], 10))
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
  selection.select(`${position}..${position}`)
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

// Selection highlight helpers
function isLineSelected(line) {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return false
  const sel = domain.ranges[0]
  return sel.start < line.end && sel.end > line.start
}

function getSelectionX(line) {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return 0
  const sel = domain.ranges[0]
  const start = Math.max(sel.start, line.start)
  const linePos = start - line.start
  return graphics.metrics.value.lmargin + linePos * graphics.metrics.value.charWidth
}

function getSelectionWidth(line) {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return 0
  const sel = domain.ranges[0]
  const start = Math.max(sel.start, line.start)
  const end = Math.min(sel.end, line.end)
  return (end - start) * graphics.metrics.value.charWidth
}

// Expose public API
defineExpose({
  setSequence,
  getSequence,
  setZoom,
  getSelection,
  setSelection,
  clearSelection,
  setCursor,
  scrollToPosition,
  editorState,
  graphics,
  eventBus,
  openMetadataModal
})
</script>

<template>
  <div class="sequence-editor" ref="containerRef">
    <!-- Toolbar -->
    <div class="toolbar">
      <label v-if="viewMode === 'linear'" class="zoom-control">
        Zoom:
        <select :value="editorState.zoomLevel.value" @change="handleZoomChange">
          <option
            v-for="opt in availableZooms"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </option>
        </select>
      </label>

      <span v-if="editorState.sequenceLength.value > 0" class="info">
        <!-- Title editing mode -->
        <span v-if="editingTitle" class="title-edit-container">
          <input
            ref="titleInputRef"
            v-model="editTitleValue"
            type="text"
            class="title-input"
            @keydown="handleTitleKeydown"
            @blur="cancelEditingTitle"
          />
          <button
            class="title-edit-btn title-edit-confirm"
            @mousedown.prevent="confirmEditingTitle"
            title="Save"
          >
            <CheckIcon class="icon-sm" />
          </button>
          <button
            class="title-edit-btn title-edit-cancel"
            @mousedown.prevent="cancelEditingTitle"
            title="Cancel"
          >
            <XMarkIcon class="icon-sm" />
          </button>
        </span>
        <!-- Title display mode -->
        <strong
          v-else
          class="title-display"
          :class="{ 'title-editable': !props.readonly }"
          @dblclick="startEditingTitle"
        >{{ editorState.title.value || 'Untitled' }}</strong>
        &mdash; {{ editorState.sequenceLength.value.toLocaleString() }} bp
        <button
          v-if="hasMetadata"
          class="info-button"
          @click="openMetadataModal"
          title="Sequence info"
        >
          <InformationCircleIcon class="icon-toolbar" />
        </button>
      </span>

      <!-- View mode toggle (only for circular sequences) -->
      <div v-if="showViewModeToggle" class="view-mode-toggle">
        <button
          :class="['view-mode-btn', { active: viewMode === 'linear' }]"
          @click="viewMode = 'linear'"
          title="Linear view"
        >
          Linear
        </button>
        <button
          :class="['view-mode-btn', { active: viewMode === 'circular' }]"
          @click="viewMode = 'circular'"
          title="Circular view"
        >
          Circular
        </button>
      </div>

      <!-- Spacer to push config to right -->
      <div class="toolbar-spacer"></div>

      <!-- Extension toolbar buttons -->
      <component
        v-for="ext in props.extensions.filter(e => e.toolbarButton)"
        :key="ext.id"
        :is="ext.toolbarButton"
      />

      <!-- Slot for external toolbar content (appears left of help button) -->
      <slot name="toolbar"></slot>

      <!-- Help button with selection instructions tooltip -->
      <button
        class="help-button"
        title="Selection Controls:
• Click: Set cursor / clear selection
• Click+Drag: Select range
• Shift+Click: Extend selection
• Ctrl+Click: Add range
• Escape: Clear selection
• Drag handles: Resize selection"
      >
        <QuestionMarkCircleIcon class="icon-toolbar-lg" />
      </button>

      <!-- Config gear -->
      <div class="config-container">
        <button class="config-button" @click.stop="configPanelOpen = !configPanelOpen" title="Settings">
          <Cog6ToothIcon class="icon-toolbar-lg" />
        </button>

        <!-- Dropdown panel -->
        <div v-if="configPanelOpen" class="config-panel" @click.stop>
          <!-- Annotations section -->
          <label class="config-header-toggle">
            <input
              type="checkbox"
              v-model="showAnnotations"
            >
            <span>Annotations</span>
          </label>
          <div v-if="showAnnotations && annotationTypes.length > 0" class="config-types">
            <label v-for="type in annotationTypes" :key="type" class="type-row">
              <input type="checkbox" :checked="!isTypeHidden(type)" @change="toggleAnnotationType(type)">
              <svg class="type-swatch" viewBox="0 0 14 14" width="14" height="14">
                <rect
                  x="0" y="0" width="14" height="14" rx="2"
                  :fill="getTypeColor(type)"
                  stroke="black"
                  stroke-width="1"
                />
              </svg>
              <span class="type-name">{{ type }}</span>
            </label>
          </div>

          <!-- Translation section (only in linear mode) -->
          <label v-if="cdsAnnotations.length > 0 && viewMode === 'linear'" class="config-header-toggle">
            <input
              type="checkbox"
              v-model="showTranslation"
            >
            <span>Translation</span>
          </label>
        </div>
      </div>
    </div>

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
          :annotations="annotationInstances"
          :show-annotation-captions="showAnnotationCaptions"
          @select="handleSelectionChange"
          @contextmenu="showContextMenu($event.event, $event)"
          @handle-contextmenu="handleHandleContextMenu"
          @annotation-click="handleAnnotationClick"
          @annotation-contextmenu="handleAnnotationContextMenu"
          @annotation-hover="handleAnnotationHover"
        />
      </div>

      <!-- Selection Status Display -->
      <div
        v-if="selectionStatusText"
        class="selection-status"
      >{{ selectionStatusText }}</div>
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
        @click="focusSvg"
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
          @contextmenu.prevent
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

        <!-- Sequence lines -->
        <g
          v-for="line in editorState.lines.value"
          :key="line.index"
          :transform="`translate(0, ${graphics.getLineY(line.index)})`"
          class="sequence-line"
        >
          <!-- Position label -->
          <text
            :x="graphics.metrics.value.lmargin - 8"
            :y="graphics.lineHeight.value / 2"
            text-anchor="end"
            dominant-baseline="middle"
            class="position-label"
          >
            {{ line.position }}
          </text>

          <!-- Sequence content (text or bar) -->
          <g :transform="`translate(${graphics.metrics.value.lmargin}, 0)`">
            <!-- Text mode -->
            <text
              v-if="graphics.metrics.value.textMode"
              x="0"
              :y="graphics.lineHeight.value / 2"
              dominant-baseline="middle"
              class="sequence-text"
              :style="{ letterSpacing: `${graphics.metrics.value.charWidth - graphics.metrics.value.blockWidth}px` }"
            >
              {{ line.text }}
            </text>

            <!-- Bar mode - thin bar above center (matches original proportions) -->
            <rect
              v-else
              x="0"
              :y="graphics.lineHeight.value * 3 / 8"
              :width="(line.end - line.start) * graphics.metrics.value.charWidth"
              :height="graphics.lineHeight.value / 4"
              class="sequence-bar"
            />

            <!-- Invisible overlay to capture mouse events and prevent text selection -->
            <rect
              x="0"
              y="0"
              :width="(line.end - line.start) * graphics.metrics.value.charWidth"
              :height="graphics.lineHeight.value"
              class="sequence-overlay"
              @mousedown="handleMouseDown($event, line.index)"
              @contextmenu="handleContextMenu($event, line.index)"
            />
          </g>

          <!-- Selection highlight -->
          <rect
            v-if="isLineSelected(line)"
            :x="getSelectionX(line)"
            y="0"
            :width="getSelectionWidth(line)"
            :height="graphics.lineHeight.value"
            class="selection-highlight"
          />
        </g>

        <!-- Selection Layer (behind annotations) -->
        <SelectionLayer
          ref="selectionLayerRef"
          @select="handleSelectionChange"
          @contextmenu="handleSelectionContextMenu"
          @mousedown="handleSelectionMouseDown"
          @handle-contextmenu="handleHandleContextMenu"
        />

        <!-- Translation Layer (rendered below annotations, above sequence) -->
        <TranslationLayer
          v-if="cdsAnnotations.length > 0"
          ref="translationLayerRef"
          :annotations="cdsAnnotations"
          :annotation-delta-y-by-line="annotationLayerRef?.annotationDeltaYByLine"
          @hover="handleTranslationHover"
          @click="handleTranslationClick"
          @contextmenu="handleTranslationContextMenu"
        />

        <!-- Annotation Layer -->
        <AnnotationLayer
          v-if="annotationInstances.length > 0"
          ref="annotationLayerRef"
          :annotations="annotationInstances"
          :show-captions="showAnnotationCaptions"
          :show-translation="translationLayerRef?.visible ?? false"
          :offset-y="graphics.lineHeight.value"
          @click="handleAnnotationClick"
          @contextmenu="handleAnnotationContextMenu"
          @hover="handleAnnotationHover"
        />

      </svg>
      </div>

      <!-- Selection Status Display -->
      <div
        v-if="selectionStatusText"
        class="selection-status"
      >{{ selectionStatusText }}</div>
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
      :overlay-annotation-count="pendingOverlayAnnotations?.length || 0"
      @submit="handleModalSubmit"
      @cancel="handleInsertCancel"
    />

    <!-- Metadata Modal -->
    <MetadataModal
      :open="metadataModalOpen"
      :metadata="props.metadata"
      :readonly="props.readonly"
      :backend="effectiveBackend"
      @close="closeMetadataModal"
    />

    <!-- Annotation Creation/Edit Modal -->
    <AnnotationModal
      :open="annotationModalOpen"
      :span="annotationModalSpan"
      :sequence-length="editorState.sequence.value.length"
      :readonly="props.readonly"
      :annotation="editingAnnotation"
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

    <!-- Extension panels/overlays -->
    <component
      v-for="ext in props.extensions.filter(e => e.panel)"
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

.position-label {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 10px;
  fill: #888;
  text-anchor: end;
  user-select: none;
  -webkit-user-select: none;
  pointer-events: none;
}

.sequence-text {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 16px;
  fill: #000;
  pointer-events: none;
  text-anchor: start;
}

.sequence-overlay {
  fill: transparent;
  cursor: text;
}

/* Hide native browser text selection highlight */
.sequence-text::selection {
  background: transparent;
}

.sequence-text::-moz-selection {
  background: transparent;
}

.sequence-bar {
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
</style>
