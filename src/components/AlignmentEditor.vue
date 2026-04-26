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
import { align, buildReverseCoordinateMap, mapAnnotationThroughAlignment } from '../utils/alignment.js'
import SelectionLayer from './SelectionLayer.vue'
import ContextMenu from './ContextMenu.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import SequenceLayer from './SequenceLayer.vue'
import AlignmentTicksLayer from './AlignmentTicksLayer.vue'
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
  'annotations-update'
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
      mapped.push(mappedAnn)
    }
  }

  return mapped
})

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

// Alignment block height (query + match + target + annotation space)
const alignmentBlockHeight = computed(() => {
  return graphics.lineHeight.value * 3 + 40
})
provide('alignmentBlockHeight', alignmentBlockHeight)

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

// ============================================
// Template refs and layout
// ============================================

const containerRef = ref(null)
const svgRef = ref(null)
const measureRef = ref(null)
const selectionLayerRef = ref(null)
const targetSequenceLayerRef = ref(null)
const querySequenceLayerRef = ref(null)

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
    const lineHeight = graphics.lineHeight.value
    const blockHeight = lineHeight * 3 + 40
    return alignmentLines.value.length * blockHeight + 40
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

// Build context menu items
function buildContextMenuItems(context) {
  const items = []
  const isSelected = selection.isSelected.value
  const domain = selection.domain.value

  // Copy option
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

  // Delete sequence option
  if (isSelected && domain && domain.ranges.length > 0 && !props.readonly) {
    const range = domain.ranges[0]
    if (range.start !== range.end) {
      items.push({ separator: true })
      items.push({
        label: 'Delete sequence',
        action: () => handleDelete()
      })
    }
  }

  return items
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
      ...(selectionLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(targetSequenceLayerRef.value?.getMenuItemsForElement?.(el.dataset) || []),
      ...(querySequenceLayerRef.value?.getMenuItemsForElement?.(el.dataset) || [])
    ]

    layerItems.push(...layerMenuItems)
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

  // Priority order: Selection > TargetSequence > QuerySequence
  for (const el of elements) {
    if (!el.dataset.layer) continue

    // Try each layer in priority order
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
  selectionStatusText,
  selection,
  // Layer refs for testing
  targetSequenceLayerRef,
  querySequenceLayerRef,
  // For testing context menu building
  buildContextMenuItems
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
          </template>

          <!-- Alignment Ticks Layer - renders match lines -->
          <AlignmentTicksLayer />

          <!-- Selection Layer -->
          <SelectionLayer
            ref="selectionLayerRef"
            :alignment-mode="selection.source.value"
            :alignment-block-height="alignmentBlockHeight"
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
