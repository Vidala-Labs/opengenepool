<script setup>
import { ref, shallowRef, computed, markRaw, onMounted, onUnmounted, provide, watch, watchEffect, nextTick } from 'vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { usePersistedZoom } from '../composables/usePersistedZoom.js'
import { useClipboard } from '../composables/useClipboard.js'
import { useSelection, SelectionDomain } from '../composables/useSelection.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Span, Range, Orientation, iterateSequence, reverseComplement, calculateTm } from '../utils/dna.js'
import { align, buildReverseCoordinateMap, mapAnnotationThroughAlignment, extractGaps } from '../utils/alignment.js'
import SelectionLayer from './SelectionLayer.vue'
import AnnotationLayer from './AnnotationLayer.vue'
import ContextMenu from './ContextMenu.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import AnnotationModal from './AnnotationModal.vue'
import InsertModal from './InsertModal.vue'
import SequenceLayer from './SequenceLayer.vue'
import AlignmentTicksLayer from './AlignmentTicksLayer.vue'
import TranslationLayer from './TranslationLayer.vue'
import Toolbar from './Toolbar.vue'
import Indicator from './Indicator.vue'

const props = defineProps({
  /**
   * Target SequenceDocument (the main sequence being viewed/edited)
   */
  target: {
    type: Object,
    required: true
  },
  /**
   * Query SequenceDocument (the sequence to align against target)
   */
  query: {
    type: Object,
    required: true
  },
  /** Initial zoom level (bases per line) */
  initialZoom: {
    type: Number,
    default: 100
  },
  /** Whether the editor is read-only (disables editing, allows selection/copy) */
  readonly: {
    type: Boolean,
    default: false
  },
  /**
   * Clipboard backend for copy/paste operations.
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
  }
})

const emit = defineEmits([
  'select',
  'contextmenu',
  'ready',
  'edit',
  'annotations-update',
  'edit-annotation'
])

// Effective clipboard backend - returns null when readonly to prevent copy/paste
const effectiveClipboardBackend = computed(() => props.readonly ? null : props.clipboardBackend)
const { copyText } = useClipboard(effectiveClipboardBackend)
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
// Document Access
// ============================================

// Direct access to documents from props
const targetDoc = computed(() => props.target)
const queryDoc = computed(() => props.query)

// Is the sequence circular? (from target document)
const isCircular = computed(() => targetDoc.value?.circular ?? false)

// Default Tm calculator - uses built-in SantaLucia 1998 method
function defaultTmCalculator(sequence) {
  if (!sequence || sequence.length < 2 || sequence.length > 80) return null
  const tm = calculateTm(sequence)
  if (tm === null) return null
  return `Tm: ${tm}°C`
}

// Valid DNA bases for input (IUPAC codes)
const DNA_BASES = new Set([
  'A', 'T', 'C', 'G', 'N', 'R', 'Y', 'S', 'W', 'K', 'M', 'B', 'D', 'H', 'V',
  'a', 't', 'c', 'g', 'n', 'r', 'y', 's', 'w', 'k', 'm', 'b', 'd', 'h', 'v'
])

// Delete confirmation dialog state
const deleteConfirmVisible = ref(false)
const deleteConfirmLength = ref(0)

// Initialize composables
const editorState = useEditorState()
const graphics = useGraphics(editorState)
const eventBus = createEventBus()

// Selection is owned here and provided to children (single source of truth)
const selection = useSelection(editorState, graphics, eventBus)

// ============================================
// Alignment Computation
// ============================================

// Alignment computation - use sequenceRef for proper Vue reactivity tracking
// When the document's sequence changes via doc.delete() or doc.insert(),
// Vue will see the dependency and recompute alignmentResult
const alignmentResult = computed(() => {
  const target = targetDoc.value
  const query = queryDoc.value
  // Access sequenceRef (public API) for proper Vue reactivity tracking
  const targetSeq = target?.sequenceRef?.value
  const querySeq = query?.sequenceRef?.value
  if (!targetSeq || !querySeq) return null
  return align(querySeq, targetSeq)
})

// Check if alignment found a match
const hasAlignment = computed(() => {
  return alignmentResult.value && alignmentResult.value.score > 0
})

// Update gaps on documents when alignment changes
watch(alignmentResult, (result) => {
  if (!result || result.score === 0) {
    // No alignment - clear gaps
    targetDoc.value?.clearGaps?.()
    queryDoc.value?.clearGaps?.()
    return
  }

  // Extract and set gaps for target document
  const targetGaps = extractGaps(result.targetAligned, result.targetStart)
  targetDoc.value?.setGaps?.(targetGaps)

  // Extract and set gaps for query document
  const queryGaps = extractGaps(result.queryAligned, result.queryStart)
  queryDoc.value?.setGaps?.(queryGaps)
}, { immediate: true })

// Aligned sequences with gaps inserted
const alignedQuerySequence = computed(() => {
  if (!hasAlignment.value) return ''
  return alignmentResult.value.queryAligned
})

const alignedTargetSequence = computed(() => {
  if (!hasAlignment.value) return ''
  return alignmentResult.value.targetAligned
})

// Build match line (| for match, space for mismatch/gap)
const alignmentMatchLine = computed(() => {
  if (!hasAlignment.value) return ''
  const query = alignedQuerySequence.value
  const target = alignedTargetSequence.value
  let line = ''
  for (let i = 0; i < query.length; i++) {
    const q = query[i].toUpperCase()
    const t = target[i].toUpperCase()
    if (q === '-' || t === '-') {
      line += ' '
    } else if (q === t) {
      line += '|'
    } else {
      line += ' '
    }
  }
  return line
})

// Position mapping: aligned index -> original position for query
const queryPositionMap = computed(() => {
  if (!hasAlignment.value) return []
  const map = []
  let origPos = alignmentResult.value.queryStart
  for (let i = 0; i < alignedQuerySequence.value.length; i++) {
    if (alignedQuerySequence.value[i] !== '-') {
      map.push(origPos)
      origPos++
    } else {
      map.push(null) // Gap position
    }
  }
  return map
})

// Position mapping: aligned index -> original position for target
const targetPositionMap = computed(() => {
  if (!hasAlignment.value) return []
  const map = []
  let origPos = alignmentResult.value.targetStart
  for (let i = 0; i < alignedTargetSequence.value.length; i++) {
    if (alignedTargetSequence.value[i] !== '-') {
      map.push(origPos)
      origPos++
    } else {
      map.push(null) // Gap position
    }
  }
  return map
})

// Alignment lines - similar to editorState.lines but for alignment mode
const alignmentLines = computed(() => {
  if (!hasAlignment.value) return []

  const zoomLevel = editorState.zoomLevel.value
  const querySeq = alignedQuerySequence.value
  const targetSeq = alignedTargetSequence.value
  const matchLine = alignmentMatchLine.value
  const lines = []

  for (let i = 0; i < querySeq.length; i += zoomLevel) {
    const end = Math.min(i + zoomLevel, querySeq.length)

    // Find the first non-gap position for the label
    let queryLabelPos = null
    let targetLabelPos = null
    for (let j = i; j < end; j++) {
      if (queryLabelPos === null && queryPositionMap.value[j] !== null) {
        queryLabelPos = queryPositionMap.value[j]
      }
      if (targetLabelPos === null && targetPositionMap.value[j] !== null) {
        targetLabelPos = targetPositionMap.value[j]
      }
      if (queryLabelPos !== null && targetLabelPos !== null) break
    }

    lines.push({
      index: lines.length,
      start: i,
      end: end,
      queryText: querySeq.slice(i, end),
      targetText: targetSeq.slice(i, end),
      matchText: matchLine.slice(i, end),
      queryPosition: queryLabelPos,
      targetPosition: targetLabelPos
    })
  }

  return lines
})

// Reverse coordinate maps for mapping annotations through alignment
const targetReverseMap = computed(() => {
  if (!hasAlignment.value) return {}
  return buildReverseCoordinateMap(alignedTargetSequence.value, alignmentResult.value.targetStart)
})

const queryReverseMap = computed(() => {
  if (!hasAlignment.value) return {}
  return buildReverseCoordinateMap(alignedQuerySequence.value, alignmentResult.value.queryStart)
})

// Active reverse coordinate map based on selection source
// This is used by SelectionLayer to convert original positions to aligned positions for rendering
const activeReverseCoordinateMap = computed(() => {
  if (!hasAlignment.value) return null
  if (selection.source.value === 'query') {
    return queryReverseMap.value
  }
  // Default to target (for both 'target' and null/undefined)
  return targetReverseMap.value
})

// Local copy of annotations for display
const localAnnotations = computed(() => targetDoc.value?.annotations ?? [])

// Aligned target annotations - map main sequence annotations through alignment
const alignedTargetAnnotations = computed(() => {
  if (!hasAlignment.value || !localAnnotations.value) return []

  const result = alignmentResult.value
  const mapped = []

  for (const ann of localAnnotations.value) {
    const mappedAnn = mapAnnotationThroughAlignment(
      ann,
      targetReverseMap.value,
      result.targetStart,
      result.targetEnd
    )
    if (mappedAnn) {
      // Tag with alignment mode for context menu routing
      mappedAnn.attributes._alignmentMode = 'target'
      mapped.push(mappedAnn)
    }
  }

  return mapped
})

// Aligned query annotations - map alignment sequence annotations through alignment
const alignedQueryAnnotations = computed(() => {
  const queryAnnotations = queryDoc.value?.annotations
  if (!hasAlignment.value || !queryAnnotations) return []

  const result = alignmentResult.value
  const mapped = []

  for (const ann of queryAnnotations) {
    const mappedAnn = mapAnnotationThroughAlignment(
      ann,
      queryReverseMap.value,
      result.queryStart,
      result.queryEnd
    )
    if (mappedAnn) {
      // Tag with alignment mode for context menu routing
      mappedAnn.attributes._alignmentMode = 'query'
      mapped.push(mappedAnn)
    }
  }

  return mapped
})

// CDS annotations for translation display - use ALIGNED annotations for correct positioning
const alignedTargetCdsAnnotations = computed(() => {
  return alignedTargetAnnotations.value.filter(ann => ann.type?.toUpperCase() === 'CDS')
})

const alignedQueryCdsAnnotations = computed(() => {
  return alignedQueryAnnotations.value.filter(ann => ann.type?.toUpperCase() === 'CDS')
})

// Show translation toggle
const showTranslation = ref(true)

// Minimum codon width needed to display amino acid letter (matches TranslationLayer)
const MIN_CODON_WIDTH = 8

// Effective show translation - only true when user wants it AND zoom allows readable text
// This mirrors TranslationLayer's visibility logic to keep annotation spacing in sync
const effectiveShowTranslation = computed(() => {
  if (!showTranslation.value) return false
  const codonWidth = 3 * graphics.metrics.value.charWidth
  return codonWidth >= MIN_CODON_WIDTH
})

// Show annotations toggle
const showAnnotations = ref(true)

// Hidden annotation types (stored per session, not persisted)
const hiddenTypes = ref(new Set())

// Annotation colors - shared with SequenceEditor via localStorage
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
  mutation: '#F44336',       // red (alignment diff)
  insertion: '#FFEB3B',      // yellow (alignment diff)
  deletion: '#FFEB3B',       // yellow (alignment diff)
  _default: '#607D8B'        // default blue-gray for unknown types
}

function loadAnnotationColors() {
  const stored = localStorage.getItem(COLORS_KEY)
  if (stored) {
    try {
      return { ...DEFAULT_ANNOTATION_COLORS, ...JSON.parse(stored) }
    } catch {
      return { ...DEFAULT_ANNOTATION_COLORS }
    }
  }
  return { ...DEFAULT_ANNOTATION_COLORS }
}

const annotationColors = ref(loadAnnotationColors())

// Extract unique annotation types from both target and query
const annotationTypes = computed(() => {
  const targetTypes = localAnnotations.value.map(a => a.type || 'misc_feature')
  const queryTypes = (queryDoc.value?.annotations || []).map(a => a.type || 'misc_feature')
  const types = new Set([...targetTypes, ...queryTypes])
  return [...types].sort()
})

// Toggle visibility of an annotation type
function toggleAnnotationType(type) {
  const newSet = new Set(hiddenTypes.value)
  if (newSet.has(type)) {
    newSet.delete(type)
  } else {
    newSet.add(type)
  }
  hiddenTypes.value = newSet
}

// Check if a type is hidden
function isTypeHidden(type) {
  return hiddenTypes.value.has(type)
}

// Get color for annotation type
function getTypeColor(type) {
  return annotationColors.value[type] || annotationColors.value._default
}

// Filter aligned annotations based on visibility settings
const visibleAlignedTargetAnnotations = computed(() => {
  if (!showAnnotations.value) return []
  return alignedTargetAnnotations.value.filter(ann => !hiddenTypes.value.has(ann.type || 'misc_feature'))
})

const visibleAlignedQueryAnnotations = computed(() => {
  if (!showAnnotations.value) return []
  return alignedQueryAnnotations.value.filter(ann => !hiddenTypes.value.has(ann.type || 'misc_feature'))
})

// CDS annotations for translation (filtered by visibility)
const visibleAlignedTargetCdsAnnotations = computed(() => {
  return visibleAlignedTargetAnnotations.value.filter(ann => ann.type?.toUpperCase() === 'CDS')
})

const visibleAlignedQueryCdsAnnotations = computed(() => {
  return visibleAlignedQueryAnnotations.value.filter(ann => ann.type?.toUpperCase() === 'CDS')
})

// ============================================
// Gap Annotation Feature Detection and Creation
// ============================================

/**
 * Detect what type of alignment feature is at an aligned position.
 * @param {number} alignedPos - Position in the aligned sequence
 * @returns {Object|null} Feature object with type and bases, or null if match
 */
function detectAlignmentFeatureAt(alignedPos) {
  if (!alignmentResult.value) return null

  const queryChar = alignmentResult.value.queryAligned[alignedPos]
  const targetChar = alignmentResult.value.targetAligned[alignedPos]

  if (!queryChar || !targetChar) return null

  // Gap in query = deletion from query perspective
  if (queryChar === '-' && targetChar !== '-') {
    return { type: 'deletion', targetBase: targetChar }
  }

  // Gap in target = insertion in query
  if (targetChar === '-' && queryChar !== '-') {
    return { type: 'insertion', queryBase: queryChar }
  }

  // Both are bases - check for mutation
  if (queryChar !== '-' && targetChar !== '-') {
    if (queryChar.toUpperCase() !== targetChar.toUpperCase()) {
      return { type: 'mutation', targetBase: targetChar, queryBase: queryChar }
    }
  }

  return null // Match - no annotation needed
}

/**
 * Create annotation for deletion (gap in query).
 * Annotates the flanking bases around the gap.
 * Caption format: Δ(genbank_pos) or Δ(genbank_start..genbank_end)
 * @param {number} alignedStart - Start position of the gap in aligned sequence
 * @param {number} alignedEnd - End position of the gap in aligned sequence (exclusive)
 */
function createDeletionAnnotation(alignedStart, alignedEnd) {
  if (!alignmentResult.value || !queryDoc.value) return

  // Find flanking bases in query (for span)
  let leftPos = alignedStart - 1
  let rightPos = alignedEnd

  // Walk left to find non-gap base
  while (leftPos >= 0 && alignmentResult.value.queryAligned[leftPos] === '-') {
    leftPos--
  }
  // Walk right to find non-gap base
  const len = alignmentResult.value.queryAligned.length
  while (rightPos < len && alignmentResult.value.queryAligned[rightPos] === '-') {
    rightPos++
  }

  if (leftPos < 0 || rightPos >= len) return // Edge case: gap at sequence boundary

  // Map to original query coordinates for span
  const origLeft = queryPositionMap.value[leftPos]
  const origRight = queryPositionMap.value[rightPos]

  if (origLeft === null || origRight === null) return

  // Get target positions for caption (GenBank 1-indexed)
  const targetStart = targetPositionMap.value[alignedStart]
  const targetEnd = targetPositionMap.value[alignedEnd - 1]

  if (targetStart === null || targetEnd === null) return

  // GenBank is 1-indexed
  const genbankStart = targetStart + 1
  const genbankEnd = targetEnd + 1

  // Caption format: Δ(pos) or Δ(start..end)
  const caption = genbankStart === genbankEnd
    ? `Δ(${genbankStart})`
    : `Δ(${genbankStart}..${genbankEnd})`

  const span = Span.parse(`${origLeft}..${origRight + 1}`)

  queryDoc.value.addAnnotation({
    type: 'deletion',
    caption,
    span
  })
}

/**
 * Create annotation for insertion (gap in target).
 * Annotates the inserted bases in the query.
 * Caption format: +sequence (e.g., +A, +ATCG)
 * Stores full sequence in attributes.sequence
 * @param {number} alignedStart - Start position in aligned sequence
 * @param {number} alignedEnd - End position in aligned sequence
 */
function createInsertionAnnotation(alignedStart, alignedEnd) {
  if (!alignmentResult.value || !queryDoc.value) return

  // The inserted bases in query
  const insertedBases = alignmentResult.value.queryAligned.slice(alignedStart, alignedEnd)

  // Map to original query coordinates
  const origStart = queryPositionMap.value[alignedStart]
  const origEnd = queryPositionMap.value[alignedEnd - 1]

  if (origStart === null || origEnd === null) return

  const caption = `+${insertedBases}`
  const span = Span.parse(`${origStart}..${origEnd + 1}`)

  queryDoc.value.addAnnotation({
    type: 'insertion',
    caption,
    span,
    attributes: {
      sequence: insertedBases
    }
  })
}

/**
 * Create annotation for mutation (base mismatch).
 * Annotates the mutated bases in the query.
 * Caption format: A5T (single base) or ATCG(5..8)TGAA (multi-base)
 * @param {number} alignedStart - Start position in aligned sequence
 * @param {number} alignedEnd - End position in aligned sequence
 */
function createMutationAnnotation(alignedStart, alignedEnd) {
  if (!alignmentResult.value || !queryDoc.value) return

  const targetBases = alignmentResult.value.targetAligned.slice(alignedStart, alignedEnd)
  const queryBases = alignmentResult.value.queryAligned.slice(alignedStart, alignedEnd)

  // Map to original query coordinates for span
  const origStart = queryPositionMap.value[alignedStart]
  const origEnd = queryPositionMap.value[alignedEnd - 1]

  if (origStart === null || origEnd === null) return

  // Get target positions for caption (GenBank 1-indexed)
  const targetStart = targetPositionMap.value[alignedStart]
  const targetEnd = targetPositionMap.value[alignedEnd - 1]

  if (targetStart === null || targetEnd === null) return

  // GenBank is 1-indexed
  const genbankStart = targetStart + 1
  const genbankEnd = targetEnd + 1

  // Caption format: A5T (single) or ATCG(5..8)TGAA (multi)
  let caption
  if (alignedEnd - alignedStart === 1) {
    // Single base: A5T
    caption = `${targetBases}${genbankStart}${queryBases}`
  } else {
    // Multi-base: ATCG(5..8)TGAA
    caption = `${targetBases}(${genbankStart}..${genbankEnd})${queryBases}`
  }

  const span = Span.parse(`${origStart}..${origEnd + 1}`)

  queryDoc.value.addAnnotation({
    type: 'mutation',
    caption,
    span
  })
}

/**
 * Find the contiguous region of the same feature type around a position.
 * @param {number} alignedPos - Starting position
 * @param {string} featureType - 'deletion', 'insertion', or 'mutation'
 * @returns {{start: number, end: number}} Range of the contiguous region
 */
function findContiguousFeatureRegion(alignedPos, featureType) {
  if (!alignmentResult.value) return { start: alignedPos, end: alignedPos + 1 }

  const queryAligned = alignmentResult.value.queryAligned
  const targetAligned = alignmentResult.value.targetAligned
  const len = queryAligned.length

  // Helper to check if position matches the feature type
  const matchesFeatureType = (pos) => {
    if (pos < 0 || pos >= len) return false
    const feature = detectAlignmentFeatureAt(pos)
    return feature && feature.type === featureType
  }

  // Find start of contiguous region
  let start = alignedPos
  while (start > 0 && matchesFeatureType(start - 1)) {
    start--
  }

  // Find end of contiguous region
  let end = alignedPos + 1
  while (end < len && matchesFeatureType(end)) {
    end++
  }

  return { start, end }
}

/**
 * Get alignment-specific context menu items for a position.
 * @param {number} alignedPos - Position in aligned sequence
 * @param {string} mode - 'target' or 'query'
 * @returns {Array} Menu items for this position
 */
function getAlignmentMenuItems(alignedPos, mode) {
  if (mode !== 'query' && mode !== 'target') return []

  const feature = detectAlignmentFeatureAt(alignedPos)
  if (!feature) return []

  const items = []

  if (feature.type === 'deletion') {
    // Find the full contiguous deletion region
    const region = findContiguousFeatureRegion(alignedPos, 'deletion')
    items.push({
      label: 'Annotate deletion',
      action: () => createDeletionAnnotation(region.start, region.end)
    })
  } else if (feature.type === 'insertion') {
    // Find the full contiguous insertion region
    const region = findContiguousFeatureRegion(alignedPos, 'insertion')
    items.push({
      label: 'Annotate insertion',
      action: () => createInsertionAnnotation(region.start, region.end)
    })
  } else if (feature.type === 'mutation') {
    // For mutations, just annotate the single base (user can select range for multi-base)
    items.push({
      label: 'Annotate mutation',
      action: () => createMutationAnnotation(alignedPos, alignedPos + 1)
    })
  }

  return items
}

// ============================================
// Selection Status
// ============================================

// Get selected sequence text for alignment mode
function getSelectedAlignmentSequenceText() {
  if (!hasAlignment.value) return ''
  if (!selection.source.value) return ''

  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return ''

  const range = domain.ranges[0]
  if (range.start === range.end) return ''

  // Get the appropriate sequence based on source
  const seq = selection.source.value === 'query'
    ? queryDoc.value?.sequence
    : editorState.sequence.value
  if (!seq) return ''

  // Extract the selected portion
  const start = Math.max(0, range.start)
  const end = Math.min(seq.length, range.end)
  let text = seq.slice(start, end)

  // Handle minus strand - reverse complement
  if (range.orientation === Orientation.MINUS) {
    text = reverseComplement(text)
  }

  return text
}

// Helper to convert a range to GenBank notation (1-based)
function rangeToGenBank(range) {
  const start = range.start + 1
  const end = range.end
  const baseStr = `${start}..${end}`
  if (range.orientation === Orientation.MINUS) {
    return `complement(${baseStr})`
  }
  return baseStr
}

// Computed property for selection status text displayed in lower right corner
// Only shows selection info - alignment stats should be displayed via #info slot
const selectionStatusText = computed(() => {
  if (!hasAlignment.value) return null

  // Check for selection in alignment mode
  if (selection.isSelected.value && selection.domain.value?.ranges?.length > 0) {
    const range = selection.domain.value.ranges[0]
    if (range.start !== range.end) {
      const selectedText = getSelectedAlignmentSequenceText()
      const length = selectedText.length
      const baseWord = length === 1 ? 'base' : 'bases'
      const rowLabel = selection.source.value === 'target' ? 'Target' : 'Query'
      return `${rowLabel} selected: ${range.start + 1}..${range.end} (${length} ${baseWord})`
    }
  }

  return null
})

// Set initial zoom from localStorage (fallback to prop)
const { getInitialZoom, saveZoom } = usePersistedZoom(props.initialZoom)
editorState.setZoom(getInitialZoom())

// Persist zoom changes to localStorage
watch(editorState.zoomLevel, (newZoom) => {
  saveZoom(newZoom)
})

// Watch for target document changes to initialize/update the editor
watch(() => targetDoc.value?.sequence, (newSeq) => {
  if (newSeq !== undefined) {
    editorState.setSequence(newSeq, '')
    editorState.setZoom(getInitialZoom())
  }
}, { immediate: true })

// Config panel state
const configPanelOpen = ref(false)

// ============================================
// Provide state to child components
// ============================================

provide('editorState', editorState)
provide('graphics', graphics)
provide('eventBus', eventBus)
provide('selection', selection)
// Alignment mode state - provided for SequenceLayer and AlignmentTicksLayer
const isAlignmentMode = computed(() => true)  // Always true for this component
provide('isAlignmentMode', isAlignmentMode)
provide('alignmentLines', alignmentLines)

// Layout constants for alignment view
const TOP_PADDING = 30  // Space at top of SVG (similar to SequenceEditor's vmargin + tooltipMargin)
const ANNOTATION_HEIGHT = 18  // Height of a single annotation bar
const TRANSLATION_HEIGHT = 18  // Height reserved for translation display

/**
 * Compute stacked annotation height for a set of annotations on a given line.
 * Simulates the collision detection/stacking algorithm.
 */
function computeStackedHeight(annotations, line, zoom, showTrans) {
  const lineAnnotations = []

  for (const ann of annotations) {
    if (!ann.span?.ranges) continue

    const isCDS = ann.type?.toUpperCase() === 'CDS'
    const height = isCDS && showTrans
      ? ANNOTATION_HEIGHT + TRANSLATION_HEIGHT
      : ANNOTATION_HEIGHT

    for (const range of ann.span.ranges) {
      const startLine = Math.floor(range.start / zoom)
      const endLine = Math.floor((range.end - 1) / zoom)

      if (line >= startLine && line <= endLine) {
        lineAnnotations.push({ start: range.start, end: range.end, height })
      }
    }
  }

  if (lineAnnotations.length === 0) return 0

  // Sort by width (widest first) to simulate stacking order
  lineAnnotations.sort((a, b) => (b.end - b.start) - (a.end - a.start))

  // Simple overlap detection: count rows needed
  const rows = []
  for (const ann of lineAnnotations) {
    let placed = false
    for (let i = 0; i < rows.length; i++) {
      const canFit = rows[i].every(r => r.end <= ann.start || r.start >= ann.end)
      if (canFit) {
        rows[i].push(ann)
        placed = true
        break
      }
    }
    if (!placed) {
      rows.push([ann])
    }
  }

  // Calculate total height
  let totalHeight = 0
  for (const row of rows) {
    const rowHeight = Math.max(...row.map(a => a.height))
    totalHeight += rowHeight + 2  // 2px padding between rows
  }

  return totalHeight
}

// Compute per-line annotation heights for target (stacking up) and query (stacking down)
const lineAnnotationHeights = computed(() => {
  const zoom = editorState.zoomLevel.value
  if (!zoom) return { target: new Map(), query: new Map() }

  const numLines = alignmentLines.value.length
  const targetHeights = new Map()
  const queryHeights = new Map()
  const showTrans = effectiveShowTranslation.value

  for (let line = 0; line < numLines; line++) {
    targetHeights.set(line, computeStackedHeight(alignedTargetAnnotations.value, line, zoom, showTrans))
    queryHeights.set(line, computeStackedHeight(alignedQueryAnnotations.value, line, zoom, showTrans))
  }

  return { target: targetHeights, query: queryHeights }
})

/**
 * Get the Y position for a given alignment line.
 * Accounts for cumulative annotation heights from previous rows.
 *
 * Formula for row R (0-indexed):
 * Y[R] = (R + 1) * PADDING
 *      + sum(TARGET_HEIGHT[r] for r in 0..R)      // inclusive of current row
 *      + sum(QUERY_HEIGHT[r] for r in 0..R-1)     // exclusive of current row
 *      + R * 3 * lineHeight                       // previous rows' sequence content
 */
function getAlignmentLineY(lineIndex) {
  const lineHeight = graphics.lineHeight.value
  const heights = lineAnnotationHeights.value

  // (R + 1) * PADDING - consistent padding before each row
  let y = (lineIndex + 1) * TOP_PADDING

  // sum(TARGET_HEIGHT[r] for r in 0..R) - target annotations including current row
  for (let r = 0; r <= lineIndex; r++) {
    y += heights.target.get(r) || 0
  }

  // sum(QUERY_HEIGHT[r] for r in 0..R-1) - query annotations from previous rows only
  for (let r = 0; r < lineIndex; r++) {
    y += heights.query.get(r) || 0
  }

  // R * 3 * lineHeight - previous rows' sequence content (target + match + query)
  y += lineIndex * 3 * lineHeight

  return y
}

/**
 * Get the block height for a specific line.
 */
function getBlockHeightForLine(lineIndex) {
  const lineHeight = graphics.lineHeight.value
  const heights = lineAnnotationHeights.value
  const targetH = heights.target.get(lineIndex) || 0
  const queryH = heights.query.get(lineIndex) || 0
  return lineHeight * 3 + targetH + queryH
}

// For backwards compatibility, provide a default block height (max of all lines)
const alignmentBlockHeight = computed(() => {
  const lineHeight = graphics.lineHeight.value
  const heights = lineAnnotationHeights.value
  let maxHeight = lineHeight * 3

  for (let i = 0; i < alignmentLines.value.length; i++) {
    const targetH = heights.target.get(i) || 0
    const queryH = heights.query.get(i) || 0
    const blockH = lineHeight * 3 + targetH + queryH
    maxHeight = Math.max(maxHeight, blockH)
  }

  return maxHeight
})
provide('alignmentBlockHeight', alignmentBlockHeight)
provide('alignmentTopPadding', TOP_PADDING)
provide('getAlignmentLineY', getAlignmentLineY)
provide('lineAnnotationHeights', lineAnnotationHeights)

// Extension API - provides interface for extension panels
const selectionChangeHandlers = new Set()

// Notify selection change handlers when selection changes
watch(selection.domain, () => {
  for (const handler of selectionChangeHandlers) {
    handler()
  }
}, { deep: true })

const extensionAPI = {
  // State access
  getSequence: () => targetDoc.value?.sequence ?? '',
  getTitle: () => targetDoc.value?.name ?? '',
  getSelectedSequence: () => {
    if (!selection.isSelected.value || !selection.domain.value) return ''
    const seq = targetDoc.value?.sequence ?? ''
    const ranges = selection.domain.value.ranges
    if (ranges.length === 0) return ''
    const range = ranges[0]
    return seq.slice(range.start, range.end)
  },
  getAnnotations: () => targetDoc.value?.annotations ?? [],

  // Actions
  setSelection: (spec) => selection.select(spec),
  clearSelection: () => selection.unselect(),
  scrollToPosition: () => {}, // Not implemented for alignment view

  // Annotation creation (not fully supported in alignment mode)
  addAnnotation: () => {},

  // Event subscription
  onSelectionChange: (handler) => {
    selectionChangeHandlers.add(handler)
    return () => selectionChangeHandlers.delete(handler)
  }
}
provide('extensionAPI', extensionAPI)
provide('showTranslation', showTranslation)
provide('showAnnotations', showAnnotations)

// ============================================
// Template refs and layout
// ============================================

const containerRef = ref(null)
const svgRef = ref(null)
const measureRef = ref(null)
const selectionLayerRef = ref(null)
const targetSequenceLayerRef = ref(null)
const querySequenceLayerRef = ref(null)
const targetAnnotationLayerRef = ref(null)
const queryAnnotationLayerRef = ref(null)
const alignmentTicksLayerRef = ref(null)

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
  options.push({ value: len, label: 'full' })
  return options
})

// SVG dimensions for alignment mode
const svgHeight = computed(() => {
  if (hasAlignment.value) {
    // Use cumulative heights: sum of all block heights for all lines
    const numLines = alignmentLines.value.length
    if (numLines === 0) return 100
    // Get Y position of last line and add its block height
    const lastLineY = getAlignmentLineY(numLines - 1)
    const lastBlockHeight = getBlockHeightForLine(numLines - 1)
    return lastLineY + lastBlockHeight + 40
  }
  return 100 // Minimal height when no alignment
})

// ============================================
// Event handlers
// ============================================

function handleZoomChange(event) {
  editorState.setZoom(Number(event))
}

// Measure font metrics on mount
function measureFont() {
  if (!measureRef.value) return

  const bbox = measureRef.value.getBBox()
  if (bbox.width > 0) {
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

// Annotation modal state
const annotationModalOpen = ref(false)
const annotationModalSpan = ref('0..0')
const editingAnnotation = ref(null)  // null = create mode, annotation object = edit mode
const annotationModalMode = ref('target')  // Track which document to add annotation to

// Insert modal state
const insertModalVisible = ref(false)
const insertModalIsReplace = ref(false)
const insertModalPosition = ref(0)
const insertModalSelectionEnd = ref(0)
const insertModalText = ref('')

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

// Build context menu items
function buildContextMenuItems(context) {
  const items = []
  const isSelected = selection.isSelected.value
  const domain = selection.domain.value

  // Group 1: Copy / Select none
  if (isSelected && domain && domain.ranges.length > 0) {
    const range = domain.ranges[0]
    if (range.start !== range.end) {
      items.push({
        label: 'Copy selection',
        action: () => handleCopy()
      })
    }
    items.push({
      label: 'Select none',
      action: () => selection.unselect()
    })
  }

  // Note: "Select all" is provided by SequenceLayer via getMenuItemsForElement
  // This ensures it only appears when clicking on a sequence layer (not background)

  // Group 2: Insert / Replace / Delete sequence
  if (isSelected && domain && domain.ranges.length > 0 && !props.readonly) {
    const firstRange = domain.ranges[0]
    const isZeroLength = firstRange.start === firstRange.end

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

  // Group 3: Create / Edit / Delete Annotation
  if (!props.readonly) {
    // Only add separator if there are preceding items
    if (items.length > 0) {
      items.push({ separator: true })
    }

    // Create annotation option - always available when not readonly
    items.push({
      label: 'Create Annotation',
      action: () => openAnnotationModal()
    })
  }

  // Annotation-specific items when right-clicking on an annotation
  if (context.source === 'annotation' && context.annotation && !props.readonly) {
    const annotation = context.annotation
    const mode = annotation.attributes?._alignmentMode || 'target'

    items.push({
      label: 'Edit Annotation',
      action: () => openAnnotationModalForEdit(annotation, mode)
    })

    items.push({
      label: 'Delete Annotation',
      action: () => {
        if (mode === 'query' && props.query) {
          props.query.deleteAnnotation(annotation.id)
        } else if (props.target) {
          props.target.deleteAnnotation(annotation.id)
        }
        emit('annotations-update')
      }
    })

    // Copy to other document option (only if annotation maps to non-gap positions)
    const mappedSpan = computeMappedSpanForCopy(annotation, mode)
    if (mappedSpan) {
      if (mode === 'query') {
        items.push({
          label: 'Copy annotation to target',
          action: () => copyAnnotationToDocument(annotation, 'target', mappedSpan)
        })
      } else {
        items.push({
          label: 'Copy annotation to query',
          action: () => copyAnnotationToDocument(annotation, 'query', mappedSpan)
        })
      }
    }

    // Subtract from selection option when annotation overlaps selection
    if (isSelected && domain) {
      const annotationSpan = annotation.span
      const hasOverlap = annotationSpan?.ranges && domain.ranges.some(selRange =>
        annotationSpan.ranges.some(annRange => selRange.overlaps?.(annRange))
      )

      if (hasOverlap) {
        items.push({
          label: 'Subtract from selection',
          action: () => selection.subtractSpan(annotationSpan)
        })
      }
    }
  }

  // Extension context menu items
  let extContext = null
  if (context.source === 'annotation' && context.annotation) {
    // Annotation right-click - extract annotation sequence
    const ann = context.annotation
    const mode = ann.attributes?._alignmentMode || 'target'
    const seq = mode === 'query' ? queryDoc.value?.sequence : editorState.sequence.value
    // Use the original annotation's span (not the aligned one) to extract sequence
    const originalAnn = ann.attributes?._originalAnnotation || ann
    const annSeq = originalAnn.span ? [...iterateSequence(originalAnn.span, seq)].map(b => b.letter).join('') : ''
    extContext = {
      type: 'annotation',
      data: { annotation: originalAnn, sequence: annSeq, fragment: context.fragment }
    }
  } else if (isSelected && domain) {
    const selectedSeq = getSelectedAlignmentSequenceText()
    extContext = {
      type: 'selection',
      data: { sequence: selectedSeq, domain }
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

/**
 * Calculate the aligned position from click coordinates.
 * @param {MouseEvent} event - The click/contextmenu event
 * @param {number} lineStart - The start position of the line in aligned coordinates
 * @returns {number|null} The aligned position, or null if not calculable
 */
function getAlignedPositionFromEvent(event, lineStart) {
  const svgEl = svgRef.value
  if (!svgEl) return null

  const svgRect = svgEl.getBoundingClientRect()
  const x = event.clientX - svgRect.left - graphics.metrics.value.lmargin
  const charWidth = graphics.metrics.value.charWidth
  const charIndex = Math.max(0, Math.floor(x / charWidth))

  return lineStart + charIndex
}

function showContextMenu(event, context = {}) {
  event.preventDefault()
  const items = buildContextMenuItems(context)

  // Use elementsFromPoint to find all elements at the click position
  const elements = document.elementsFromPoint(event.clientX, event.clientY)
  const layerItems = []

  // Collect menu items from all layers
  for (const el of elements) {
    if (!el.dataset.layer) continue

    // Check each layer ref for matching items
    const layerMenuItems = [
      ...(targetAnnotationLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(queryAnnotationLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(selectionLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(targetSequenceLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(querySequenceLayerRef.value?.getMenuItemsForElement?.(el.dataset) || [])
    ]

    layerItems.push(...layerMenuItems)

    // Add alignment-specific menu items (for gap/mutation annotations) - only from ticks layer
    if (el.dataset.layer === 'alignment-match' && el.dataset.lineStart !== undefined) {
      const alignedPos = getAlignedPositionFromEvent(event, parseInt(el.dataset.lineStart))
      if (alignedPos !== null) {
        const alignmentItems = getAlignmentMenuItems(alignedPos, 'query')
        layerItems.push(...alignmentItems)
      }
    }
  }

  // Add layer items with separator
  if (layerItems.length > 0) {
    items.push({ separator: true })
    items.push(...layerItems)
  }

  contextMenuItems.value = items
  if (contextMenuItems.value.length === 0) return

  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuVisible.value = true
}

function hideContextMenu() {
  contextMenuVisible.value = false
}

// Annotation modal functions
function openAnnotationModal() {
  const domain = selection.domain.value

  // Set the mode based on current selection source
  annotationModalMode.value = selection.source.value || 'target'

  if (domain && domain.ranges.length > 0 && domain.ranges[0].start !== domain.ranges[0].end) {
    // Convert selection ranges to span string for annotation
    // In alignment mode, we need to use the reverse coordinate map to get original positions
    const reverseMap = annotationModalMode.value === 'query' ? queryReverseMap.value : targetReverseMap.value

    const spanStr = domain.ranges
      .map(r => {
        // Map aligned coordinates back to original coordinates
        const origStart = reverseMap ? reverseMap[r.start] : r.start
        const origEnd = reverseMap ? reverseMap[r.end] : r.end
        if (origStart !== undefined && origEnd !== undefined) {
          return new Range(origStart, origEnd, r.orientation).toFencedString()
        }
        return null
      })
      .filter(s => s !== null)
      .join(' + ')
    annotationModalSpan.value = spanStr || ''
  } else {
    annotationModalSpan.value = ''
  }
  editingAnnotation.value = null
  annotationModalOpen.value = true
}

function closeAnnotationModal() {
  annotationModalOpen.value = false
  editingAnnotation.value = null
}

function openAnnotationModalForEdit(annotation, mode = 'target') {
  editingAnnotation.value = annotation
  annotationModalMode.value = mode
  const spanStr = annotation.span?.toJSON?.() || '0..0'
  annotationModalSpan.value = spanStr
  annotationModalOpen.value = true
}

function handleAnnotationCreate(data) {
  const doc = annotationModalMode.value === 'query' ? props.query : props.target
  if (!doc) return

  // Add annotation to the appropriate document
  doc.addAnnotation({
    span: data.span,
    type: data.type,
    label: data.label,
    color: data.color,
    orientation: data.orientation,
    attributes: data.attributes || {}
  })

  emit('annotations-update')
  annotationModalOpen.value = false
}

function handleAnnotationUpdate(data) {
  const annotationId = editingAnnotation.value.id
  const doc = annotationModalMode.value === 'query' ? props.query : props.target
  if (!doc) return

  // Update annotation in the appropriate document
  doc.updateAnnotation({
    id: annotationId,
    span: data.span,
    type: data.type,
    label: data.label,
    color: data.color,
    orientation: data.orientation,
    attributes: data.attributes || {}
  })

  emit('annotations-update')
  annotationModalOpen.value = false
  editingAnnotation.value = null
}

function handleEditAnnotation(data) {
  const { annotation } = data
  // Determine which document this annotation belongs to
  const mode = annotation.attributes?._alignmentMode || 'target'
  openAnnotationModalForEdit(annotation, mode)
}

/**
 * Compute the mapped span for copying an annotation to the other document.
 * Returns null if the annotation is entirely within a gap region.
 *
 * @param {Annotation} annotation - The annotation (with _originalAnnotation attribute)
 * @param {string} sourceMode - Where the annotation comes from: 'query' or 'target'
 * @returns {Span|null} The mapped span for the destination, or null if entirely in gap
 */
function computeMappedSpanForCopy(annotation, sourceMode) {
  const originalAnn = annotation.attributes?._originalAnnotation || annotation
  if (!originalAnn.span?.ranges) return null

  const result = alignmentResult.value
  if (!result) return null

  // Get the source's reverse map (original -> aligned position)
  const sourceReverseMap = sourceMode === 'query' ? queryReverseMap.value : targetReverseMap.value
  // Get the destination's aligned sequence to check for gaps
  const destAligned = sourceMode === 'query' ? alignedTargetSequence.value : alignedQuerySequence.value
  // Get the destination's alignment start for computing original positions
  const destStart = sourceMode === 'query' ? result.targetStart : result.queryStart

  // Track the min/max destination positions that have non-gap bases
  let minDestPos = Infinity
  let maxDestPos = -Infinity

  // For each range in the annotation span
  for (const range of originalAnn.span.ranges) {
    for (let origPos = range.start; origPos < range.end; origPos++) {
      const alignedPos = sourceReverseMap[origPos]
      if (alignedPos === undefined) continue

      // Check if the destination has a base (not a gap) at this aligned position
      if (destAligned[alignedPos] && destAligned[alignedPos] !== '-') {
        // Compute the destination's original position from the aligned position
        // Count non-gap characters up to this position
        let destOrigPos = destStart
        for (let i = 0; i < alignedPos; i++) {
          if (destAligned[i] !== '-') destOrigPos++
        }
        minDestPos = Math.min(minDestPos, destOrigPos)
        maxDestPos = Math.max(maxDestPos, destOrigPos + 1) // +1 for exclusive end
      }
    }
  }

  // If no positions mapped, annotation is entirely in a gap
  if (minDestPos === Infinity) return null

  return new Span([new Range(minDestPos, maxDestPos)])
}

/**
 * Copy an annotation from one document to another.
 * @param {Annotation} annotation - The annotation to copy (may have aligned coordinates)
 * @param {string} destMode - The destination: 'query' or 'target'
 * @param {Span} mappedSpan - The pre-computed mapped span for the destination
 */
function copyAnnotationToDocument(annotation, destMode, mappedSpan) {
  const doc = destMode === 'query' ? props.query : props.target
  if (!doc || !mappedSpan) return

  // Get the original annotation for other properties
  const originalAnn = annotation.attributes?._originalAnnotation || annotation

  // Create copy with mapped span and new ID (document will assign)
  doc.addAnnotation({
    span: mappedSpan,
    type: originalAnn.type,
    caption: originalAnn.caption,
    orientation: originalAnn.orientation,
    attributes: { ...originalAnn.attributes, _originalAnnotation: undefined }
  })

  emit('annotations-update')
}

// Handle selection change events
function handleSelectionChange(data) {
  emit('select', data)
}

// Background click - clear selection
function handleBackgroundClick(event) {
  if (event.button !== 0) return
  selection.unselect()
}

/**
 * Unified click handler for the SVG.
 * Routes clicks through layers using elementsFromPoint with priority order:
 * Selection > TargetSequence > QuerySequence.
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
    if (targetAnnotationLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (queryAnnotationLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (selectionLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (targetSequenceLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (querySequenceLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
  }

  // No layer handled it - clear selection (background click)
  selection.unselect()
}

function handleBackgroundContextMenu(event) {
  showContextMenu(event, { source: 'background' })
}

function handleSequenceLayerContextMenu({ event, lineIndex, mode }) {
  showContextMenu(event, { source: 'sequence', lineIndex, mode })
}

function handleSelectionContextMenu(data) {
  showContextMenu(data.event, { source: 'selection', rangeIndex: data.rangeIndex, range: data.range })
}

function handleSelectionMouseDown(event) {
  // Handled by SelectionLayer
}

function handleHandleContextMenu(data) {
  showContextMenu(data.event, { source: 'handle', rangeIndex: data.rangeIndex, range: data.range, handleType: data.handleType })
}

function handleAnnotationContextMenu(data) {
  showContextMenu(data.event, { source: 'annotation', annotation: data.annotation, fragment: data.fragment })
}

function handleTicksLayerContextMenu({ event, lineIndex }) {
  showContextMenu(event, { source: 'alignment-ticks', lineIndex })
}

// Translation layer event handlers
function handleTranslationHover(data) {
  // TODO: Add tooltip support for translation hover
  // For now, just ignore hover events
}

function handleTranslationClick(data) {
  const { event, element, codonStart, codonEnd } = data

  // Create span for the codon with correct orientation
  const isMinus = element.orientation === -1
  const spanStr = isMinus
    ? `(${codonStart}..${codonEnd})`
    : `${codonStart}..${codonEnd}`

  if (event?.shiftKey) {
    selection.extendToPosition(codonStart)
    selection.extendToPosition(codonEnd)
  } else if (event?.ctrlKey) {
    const codonSpan = Span.parse(spanStr)
    const newDomain = new SelectionDomain(codonSpan)
    selection.extendSelection(newDomain)
  } else {
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
  const annotations = element.annotationId
    ? [...(localAnnotations.value || []), ...(queryDoc.value?.annotations || [])]
    : []
  const annotation = annotations.find(a => a.id === element.annotationId)
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

// Focus the SVG element
function focusSvg() {
  svgRef.value?.focus()
}

// ============================================
// Edit operations
// ============================================

function deleteSelectedRange() {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return false

  const rangesToDelete = domain.ranges
    .filter(r => r.start !== r.end)
    .sort((a, b) => b.start - a.start)

  if (rangesToDelete.length === 0) return false

  // Determine which document to modify based on selection source
  const isQueryEdit = selection.source.value === 'query'
  const doc = isQueryEdit ? queryDoc.value : targetDoc.value

  if (doc) {
    // Delete via document
    doc.delete(rangesToDelete)
    emit('annotations-update', doc.annotations)
  }

  // Calculate cursor position
  const sortedAsc = [...rangesToDelete].sort((a, b) => a.start - b.start)
  const cursorPosition = sortedAsc[0].start

  selection.select(`${cursorPosition}..${cursorPosition}`)

  return true
}

function handleDelete() {
  const domain = selection.domain.value
  if (!domain || domain.ranges.length === 0) return

  const totalLength = domain.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
  if (totalLength === 0) return

  deleteConfirmLength.value = totalLength
  deleteConfirmVisible.value = true
}

function confirmDelete() {
  deleteConfirmVisible.value = false
  const sourceValue = selection.source.value
  const domain = selection.domain.value
  const ranges = domain?.ranges?.map(r => ({ start: r.start, end: r.end })) || []

  if (deleteSelectedRange()) {
    emit('edit', {
      type: 'delete',
      ranges,
      to: sourceValue
    })
  }
}

function cancelDelete() {
  deleteConfirmVisible.value = false
}

// Insert/Replace handler
function handleInsert(text) {
  if (!text) return

  // Determine which document to modify based on selection source
  const isQueryEdit = selection.source.value === 'query'
  const doc = isQueryEdit ? queryDoc.value : targetDoc.value

  if (!doc) return

  if (insertModalIsReplace.value) {
    // Replace mode: delete selected range then insert
    const range = { start: insertModalPosition.value, end: insertModalSelectionEnd.value }
    doc.delete([range])
    doc.insert(insertModalPosition.value, text)
    emit('edit', {
      type: 'replace',
      range,
      text,
      to: selection.source.value
    })
  } else {
    // Insert mode
    doc.insert(insertModalPosition.value, text)
    emit('edit', {
      type: 'insert',
      position: insertModalPosition.value,
      text,
      to: selection.source.value
    })
  }

  emit('annotations-update')
  insertModalVisible.value = false

  // Place cursor after inserted text
  const newCursorPos = insertModalPosition.value + text.length
  selection.select(`${newCursorPos}..${newCursorPos}`)
}

// Copy handler
async function handleCopy() {
  const alignmentSeq = getSelectedAlignmentSequenceText()
  if (alignmentSeq) {
    await copyText(alignmentSeq, {
      selection: selection.domain.value
    })
  }
}

// Keyboard handler
function handleKeyDown(event) {
  // Escape clears selection
  if (event.key === 'Escape') {
    selection.unselect()
    return
  }

  // Copy: Cmd/Ctrl+C
  if ((event.metaKey || event.ctrlKey) && event.key === 'c') {
    event.preventDefault()
    handleCopy()
    return
  }

  // Select all: Cmd/Ctrl+A
  if ((event.metaKey || event.ctrlKey) && event.key === 'a') {
    event.preventDefault()
    // Select all on the currently selected row type, or target by default
    const seqLength = selection.source.value === 'query'
      ? queryDoc.value?.sequence?.length || 0
      : editorState.sequenceLength.value
    selection.select(`0..${seqLength}`)
    return
  }

  // Delete/Backspace
  if ((event.key === 'Delete' || event.key === 'Backspace') && !props.readonly) {
    event.preventDefault()
    handleDelete()
    return
  }
}

// Close config panel when clicking outside
function handleClickOutside(event) {
  if (configPanelOpen.value && !event.target.closest('.config-container')) {
    configPanelOpen.value = false
  }
}

// ResizeObserver for container size changes
let resizeObserver = null

onMounted(async () => {
  await nextTick()
  measureFont()
  handleResize()

  resizeObserver = new ResizeObserver(handleResize)
  if (containerRef.value) {
    resizeObserver.observe(containerRef.value)
  }

  document.addEventListener('click', handleClickOutside)

  emit('ready')
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  document.removeEventListener('click', handleClickOutside)
})

// ============================================
// Expose for parent components
// ============================================

defineExpose({
  targetDoc,
  queryDoc,
  hasAlignment,
  alignmentResult,
  alignmentLines,
  getSelectedAlignmentSequenceText,
  alignedTargetAnnotations,
  alignedQueryAnnotations,
  alignedTargetSequence,
  alignedQuerySequence,
  selectionStatusText,
  selection,
  // Layer refs for testing
  targetSequenceLayerRef,
  querySequenceLayerRef,
  // For testing context menu building
  buildContextMenuItems,
  // Gap annotation feature
  detectAlignmentFeatureAt,
  createDeletionAnnotation,
  createInsertionAnnotation,
  createMutationAnnotation,
  getAlignmentMenuItems,
  findContiguousFeatureRegion,
  // For delete testing
  deleteConfirmVisible,
  confirmDelete
})

const toolbarHelpText = `Selection Controls:
- Click: Set cursor / clear selection
- Click+Drag: Select range
- Shift+Click: Extend selection
- Escape: Clear selection`
</script>

<template>
  <div class="alignment-editor" ref="containerRef">
    <Toolbar
      :zoom-level="editorState.zoomLevel.value"
      :available-zooms="availableZooms"
      :title-visible="editorState.sequenceLength.value > 0"
      :help-text="toolbarHelpText"
      :config-panel-open="configPanelOpen"
      :extensions="renderExtensions"
      @zoom-change="handleZoomChange"
      @toggle-config="configPanelOpen = !configPanelOpen"
    >
      <template #title>
        <slot name="title">
          Alignment · {{ editorState.sequenceLength.value.toLocaleString() }} bp
        </slot>
      </template>

      <template v-if="$slots.info" #info>
        <slot name="info"></slot>
      </template>

      <template #toolbar>
        <slot name="toolbar"></slot>
      </template>

      <template #config>
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

        <label v-if="visibleAlignedTargetCdsAnnotations.length > 0 || visibleAlignedQueryCdsAnnotations.length > 0" class="config-header-toggle">
          <input
            type="checkbox"
            v-model="showTranslation"
          >
          <span>Translation</span>
        </label>

        <slot name="config"></slot>
      </template>
    </Toolbar>

    <!-- Linear SVG Editor -->
    <div class="editor-wrapper">
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
          <!-- Background rect to capture clicks -->
          <rect
            x="0"
            y="0"
            :width="graphics.metrics.value.fullWidth"
            :height="svgHeight"
            class="svg-background"
            @mousedown="handleBackgroundClick"
            @contextmenu="handleBackgroundContextMenu"
          />

          <!-- Hidden text for measuring font metrics -->
          <text
            ref="measureRef"
            x="-1000"
            y="-1000"
            class="sequence-text"
          >aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa</text>

          <!-- No alignment found state -->
          <text
            v-if="!hasAlignment"
            :x="graphics.metrics.value.fullWidth / 2"
            y="50"
            text-anchor="middle"
            class="empty-state"
          >
            No alignment found
          </text>

          <!-- Sequence Layers - alignment mode (two separate layers for target and query) -->
          <template v-if="hasAlignment">
            <SequenceLayer
              ref="targetSequenceLayerRef"
              mode="target"
              :document="targetDoc"
              :lines="alignmentLines"
              :position-map="targetPositionMap"
              :y-offset="0"
              :block-height="alignmentBlockHeight"
              :original-sequence-length="editorState.sequenceLength.value"
              @select="handleSelectionChange"
              @contextmenu="handleSequenceLayerContextMenu"
            />
            <SequenceLayer
              ref="querySequenceLayerRef"
              mode="query"
              :document="queryDoc"
              :lines="alignmentLines"
              :position-map="queryPositionMap"
              :y-offset="graphics.lineHeight.value * 2"
              :block-height="alignmentBlockHeight"
              :original-sequence-length="queryDoc?.sequence?.length || 0"
              @select="handleSelectionChange"
              @contextmenu="handleSequenceLayerContextMenu"
            />

            <!-- Annotation Layers for alignment mode -->
            <!-- Target annotations above target sequence (paths extend upward with negative Y) -->
            <AnnotationLayer
              v-if="visibleAlignedTargetAnnotations.length > 0"
              ref="targetAnnotationLayerRef"
              mode="target"
              :document="targetDoc"
              :annotations="visibleAlignedTargetAnnotations"
              :y-offset="0"
              :block-height="alignmentBlockHeight"
              :show-captions="true"
              :show-translation="effectiveShowTranslation"
              @contextmenu="handleAnnotationContextMenu"
            />
            <!-- Translation Layers for CDS annotations -->
            <!-- Target translations above target sequence -->
            <TranslationLayer
              v-if="visibleAlignedTargetCdsAnnotations.length > 0"
              ref="targetTranslationLayerRef"
              mode="target"
              :annotations="visibleAlignedTargetCdsAnnotations"
              :sequence="alignedTargetSequence"
              :y-offset="0"
              :block-height="alignmentBlockHeight"
              @hover="handleTranslationHover"
              @click="handleTranslationClick"
              @contextmenu="handleTranslationContextMenu"
            />
            <!-- Query annotations below query sequence (mirrors target positioning) -->
            <AnnotationLayer
              v-if="visibleAlignedQueryAnnotations.length > 0"
              ref="queryAnnotationLayerRef"
              mode="query"
              :document="queryDoc"
              :annotations="visibleAlignedQueryAnnotations"
              :y-offset="graphics.lineHeight.value * 3"
              :block-height="alignmentBlockHeight"
              :show-captions="true"
              :show-translation="effectiveShowTranslation"
              stack-direction="down"
              @contextmenu="handleAnnotationContextMenu"
            />
            <!-- Query translations below query sequence, above CDS annotation -->
            <TranslationLayer
              v-if="visibleAlignedQueryCdsAnnotations.length > 0"
              ref="queryTranslationLayerRef"
              mode="query"
              :annotations="visibleAlignedQueryCdsAnnotations"
              :sequence="alignedQuerySequence"
              :y-offset="graphics.lineHeight.value * 3"
              :block-height="alignmentBlockHeight"
              stack-direction="down"
              @hover="handleTranslationHover"
              @click="handleTranslationClick"
              @contextmenu="handleTranslationContextMenu"
            />
          </template>

          <!-- Alignment Ticks Layer - renders match lines with clickable overlay for gap annotation -->
          <AlignmentTicksLayer
            ref="alignmentTicksLayerRef"
            @contextmenu="handleTicksLayerContextMenu"
          />

          <!-- Selection Layer -->
          <SelectionLayer
            ref="selectionLayerRef"
            :alignment-mode="selection.source.value"
            :alignment-block-height="alignmentBlockHeight"
            :alignment-top-padding="TOP_PADDING"
            :line-height="graphics.lineHeight.value"
            :reverse-coordinate-map="activeReverseCoordinateMap"
            @select="handleSelectionChange"
            @contextmenu="handleSelectionContextMenu"
            @mousedown="handleSelectionMouseDown"
            @handle-contextmenu="handleHandleContextMenu"
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

    <!-- Delete Confirmation Dialog -->
    <ConfirmDialog
      :visible="deleteConfirmVisible"
      title="Delete Sequence"
      :message="`Are you sure you want to delete ${deleteConfirmLength.toLocaleString()} bp?`"
      confirm-label="Delete"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- Annotation Creation/Edit Modal -->
    <AnnotationModal
      :open="annotationModalOpen"
      :span="annotationModalSpan"
      :sequence-length="editorState.sequenceLength.value"
      :readonly="props.readonly"
      :annotation="editingAnnotation"
      @close="closeAnnotationModal"
      @create="handleAnnotationCreate"
      @update="handleAnnotationUpdate"
    />

    <!-- Insert/Replace Modal -->
    <InsertModal
      :visible="insertModalVisible"
      :initial-text="insertModalText"
      :is-replace="insertModalIsReplace"
      :position="insertModalPosition"
      :selection-length="insertModalSelectionEnd - insertModalPosition"
      @submit="handleInsert"
      @cancel="insertModalVisible = false"
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
.alignment-editor {
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

.svg-background {
  fill: transparent;
  pointer-events: all;
}

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

/* Use :deep() to style elements inside child components */
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

:deep(.alignment-match-overlay) {
  fill: transparent;
  cursor: default;
  pointer-events: all;
}

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

/* Selection highlighting */
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

/* Heroicon sizes for toolbar */
.icon-toolbar {
  width: 16px;
  height: 16px;
}

.icon-toolbar-lg {
  width: 18px;
  height: 18px;
}

/* Selection status display */
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

  .help-button {
    margin-right: 0;
  }
}

/* Alignment mode styles */
:deep(.alignment-query-text) {
  fill: #333;
}

:deep(.alignment-target-text) {
  fill: #333;
}

:deep(.alignment-match-text) {
  fill: #666;
}
</style>
