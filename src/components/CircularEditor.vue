<script setup>
import { ref, shallowRef, computed, markRaw, onMounted, onUnmounted, provide, watch, watchEffect, nextTick } from 'vue'
import { useEditorState } from '../composables/useEditorState.js'
import { useGraphics } from '../composables/useGraphics.js'
import { createEventBus } from '../composables/useEventBus.js'
import { useClipboard } from '../composables/useClipboard.js'
import { useSelection, SelectionDomain } from '../composables/useSelection.js'
import { useCircularGraphics } from '../composables/useCircularGraphics.js'
import { SequenceDocument } from '../composables/SequenceDocument.js'
import { Annotation, OGP_HIDDEN_ATTR } from '../utils/annotation.js'
import { useContextMenu } from '../composables/useContextMenu.js'
import { Span, Range, Orientation, reverseComplement } from '../utils/dna.js'
import { getArcPath, polarToCartesian, circularDragOffset, offsetToSegments } from '../utils/circular.js'
import CircularAnnotationLayer from './CircularAnnotationLayer.vue'
import CircularSelectionLayer from './CircularSelectionLayer.vue'
import CircularSequenceLayer from './CircularSequenceLayer.vue'
import ContextMenu from './ContextMenu.vue'
import InsertModal from './InsertModal.vue'
import AnnotationModal from './AnnotationModal.vue'
import ExtendModal from './ExtendModal.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import Toolbar from './Toolbar.vue'
import Indicator from './Indicator.vue'

const props = defineProps({
  /**
   * SequenceDocument instance to edit.
   */
  sequence: {
    type: [Object, SequenceDocument],
    default: null
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
   */
  clipboardBackend: {
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

// Effective clipboard backend
const effectiveClipboardBackend = computed(() => props.readonly ? null : props.clipboardBackend)
const { copyText, readText } = useClipboard(effectiveClipboardBackend)

// Extension processing
const renderExtensions = shallowRef([])
watchEffect(() => {
  renderExtensions.value = props.extensions.map(ext => markRaw({
    ...ext,
    toolbarButton: ext.toolbarButton ? markRaw(ext.toolbarButton) : null,
    circularGraphicsLayer: ext.circularGraphicsLayer ? markRaw(ext.circularGraphicsLayer) : null,
    panel: ext.panel ? markRaw(ext.panel) : null
  }))
})

// ============================================
// Document Access
// ============================================

const targetDoc = computed(() => props.sequence)

// ============================================
// Editor State & Graphics
// ============================================

const editorState = useEditorState()
const graphics = useGraphics(editorState)
const eventBus = createEventBus()
const selection = useSelection(editorState, graphics, eventBus)
const circularGraphics = useCircularGraphics(editorState)

// Provide state to child components
provide('editorState', editorState)
provide('graphics', graphics)
provide('eventBus', eventBus)
provide('selection', selection)
provide('circularGraphics', circularGraphics)
provide('annotationColors', ref(null))

// ============================================
// Context-menu contributor service (circular)
// ============================================
// The circular layers self-register the SAME contributors as the linear editor,
// so the circular menu now matches linear (Edit/Delete/Hide/Subtract + Copy/
// Select/Insert/Replace/Delete/Create). mode is 'circular'. See CLICK_CHANGES.md.
const contextMenu = useContextMenu()
provide('contextMenu', contextMenu)

provide('annotationMenuActions', {
  onCreateAnnotation: () => openAnnotationModal(),
  onEdit: (annotation) => openAnnotationModalForEdit(annotation),
  onDelete: (annotation) => { targetDoc.value?.deleteAnnotation?.(annotation.id); emit('annotations-update') },
  onToggleHidden: (annotation, hidden) => {
    const attributes = { ...(annotation.attributes || {}) }
    if (hidden) attributes[OGP_HIDDEN_ATTR] = true
    else delete attributes[OGP_HIDDEN_ATTR]
    targetDoc.value?.updateAnnotation?.({ id: annotation.id, attributes })
    emit('annotations-update')
  },
  onSubtract: (annotation) => selection.subtractSpan(annotation.span),
  onMergeLeft: () => {}, onMergeRight: () => {}, onSplit: () => {},
  onClipPrimer: (primer, primerBind) => {
    targetDoc.value?.updateAnnotation?.({ id: primer.id, attributes: { ...primer.attributes, primer_bind: primerBind } })
    emit('annotations-update')
  }
})
provide('selectionMenuActions', {
  onCopy: () => handleCopy(),
  onSelectNone: () => selection.unselect(),
  onReplace: () => openInsertModal(true),
  onDelete: () => handleDelete(),
  onFlip: (rangeIndex) => selection.flip(rangeIndex),
  onSetOrientation: (rangeIndex, orientation) => selection.setOrientation(rangeIndex, orientation),
  onDeleteRange: (rangeIndex) => selection.deleteRange(rangeIndex),
  onMoveRange: (from, to) => selection.moveRange(from, to)
  // No onExtendHandle: the circular editor does not support handle extend, so the
  // contributor omits the "Extend to position..." item entirely.
})
provide('sequenceMenuActions', {
  onSelectAll: () => selectAll(),
  onInsert: () => openInsertModal(false)
})

// Single editor-level Create Annotation item (not owned by the annotation layer).
const createAnnotationContributor = {
  id: 'create-annotation',
  getItems: () => props.readonly ? [] : [{ id: 'create-annotation', label: 'Create Annotation', action: () => openAnnotationModal() }]
}
onMounted(() => contextMenu.register(createAnnotationContributor))
onUnmounted(() => contextMenu.unregister(createAnnotationContributor))

// SVG ref
const svgRef = ref(null)
const containerRef = ref(null)

// Refs to layer components
const circularAnnotationLayerRef = ref(null)
const circularSelectionLayerRef = ref(null)
const circularSequenceLayerRef = ref(null)

// ============================================
// Document Sync
// ============================================

// Watch document changes and sync to editorState
watch(() => targetDoc.value, (doc) => {
  if (!doc) {
    editorState.setSequence('')
    return
  }

  const sequence = doc.sequence ?? doc.sequenceRef?.value ?? ''
  editorState.setSequence(sequence, doc.name ?? '')

  // Watch for sequence changes on document
  if (doc.sequenceRef) {
    watch(() => doc.sequenceRef.value, (newSeq) => {
      editorState.setSequence(newSeq)
    })
  }
}, { immediate: true })

// ============================================
// Annotations
// ============================================

const localAnnotations = computed(() => {
  if (!targetDoc.value?.annotations) return []
  const annotations = targetDoc.value.annotations.value ?? targetDoc.value.annotations
  return Array.isArray(annotations) ? annotations : []
})

const annotationInstances = computed(() => {
  return localAnnotations.value.map(ann => {
    if (ann instanceof Annotation) return ann
    return new Annotation(ann)
  })
})

// ============================================
// Selection Status
// ============================================

const selectionStatusText = computed(() => {
  if (!selection.isSelected.value || !selection.domain.value) return ''

  const ranges = selection.domain.value.ranges
  if (ranges.length === 0) return ''

  const totalBases = ranges.reduce((sum, r) => sum + (r.end - r.start), 0)

  if (ranges.length === 1) {
    const range = ranges[0]
    if (range.start === range.end) {
      return `Cursor at ${range.start.toLocaleString()}`
    }
    return `${range.start.toLocaleString()}..${range.end.toLocaleString()} (${totalBases.toLocaleString()} bp)`
  }

  return `${ranges.length} ranges (${totalBases.toLocaleString()} bp total)`
})

// ============================================
// Backbone Path
// ============================================

const backbonePath = computed(() => {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const r = circularGraphics.backboneRadius.value
  return `M ${cx - r},${cy} A ${r},${r} 0 1,1 ${cx + r},${cy} A ${r},${r} 0 1,1 ${cx - r},${cy}`
})

// ============================================
// Title & Length Display
// ============================================

const titlePosition = computed(() => ({
  x: circularGraphics.centerX.value,
  y: circularGraphics.centerY.value - 10
}))

const lengthPosition = computed(() => ({
  x: circularGraphics.centerX.value,
  y: circularGraphics.centerY.value + 10
}))

// ============================================
// Mouse Handling
// ============================================

const isDragging = ref(false)
const dragStart = ref(null)
const lastDragPos = ref(null)
// Cumulative signed arc swept since mousedown (see circularDragOffset). Its
// magnitude is the true selection length even when the drag rounds the horn.
const dragOffset = ref(0)
// Ranges from earlier ctrl-selections, preserved while the active range drags.
const dragBaseRanges = ref([])

function getCoordsFromEvent(event) {
  if (!svgRef.value) return null

  const rect = svgRef.value.getBoundingClientRect()
  const vbWidth = circularGraphics.viewBoxWidth.value
  const vbHeight = circularGraphics.viewBoxHeight.value

  const scaleX = vbWidth / rect.width
  const scaleY = vbHeight / rect.height
  const scale = Math.max(scaleX, scaleY)

  const renderedWidth = vbWidth / scale
  const renderedHeight = vbHeight / scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2

  return {
    x: (event.clientX - rect.left - offsetX) * scale,
    y: (event.clientY - rect.top - offsetY) * scale
  }
}

function getPositionFromEvent(event) {
  const coords = getCoordsFromEvent(event)
  if (!coords) return null
  return circularGraphics.mouseToPosition(coords.x, coords.y)
}

function isInDeadZone(coords) {
  const cx = circularGraphics.centerX.value
  const cy = circularGraphics.centerY.value
  const backboneRadius = circularGraphics.backboneRadius.value
  const dx = coords.x - cx
  const dy = coords.y - cy
  const distance = Math.sqrt(dx * dx + dy * dy)
  const deadZoneOuterRadius = backboneRadius - 20
  return distance < deadZoneOuterRadius
}

function handleMouseDown(event) {
  const coords = getCoordsFromEvent(event)

  // Right-click in dead zone starts zoom
  if (event.button === 2 && coords && isInDeadZone(coords)) {
    startZoomDrag(event)
    return
  }

  // Only left click for selection
  if (event.button !== 0) return
  event.preventDefault()

  // Left-click in dead zone clears selection
  if (coords && isInDeadZone(coords)) {
    selection.unselect()
    return
  }

  const pos = getPositionFromEvent(event)
  if (pos === null) return

  isDragging.value = true
  dragStart.value = pos
  lastDragPos.value = pos
  dragOffset.value = 0

  // Shift-click extends selection
  if (event.shiftKey && selection.isSelected.value) {
    selection.extendToPosition(pos, true)
    return
  }

  // Start a new selection (or add range with Ctrl). startSelection appends a
  // single cursor range at the tail; everything before it is a prior
  // ctrl-selection we hold fixed while the active (last) range drags.
  selection.startSelection(pos, event.ctrlKey)
  dragBaseRanges.value = selection.domain.value.ranges.slice(0, -1)

  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
}

function handleMouseMove(event) {
  if (!isDragging.value || dragStart.value === null) return

  const pos = getPositionFromEvent(event)
  if (pos === null) return

  const seqLen = editorState.sequenceLength.value
  const anchor = selection.anchor.value

  // Integrate the pointer motion into a cumulative signed arc. This tracks the
  // true swept length across the origin without guessing at a crossing from a
  // single frame's jump (the old heuristic false-triggered on fast drags and
  // missed slow crossings, reporting the complement arc).
  if (lastDragPos.value !== null) {
    dragOffset.value = circularDragOffset(dragOffset.value, lastDragPos.value, pos, seqLen)
  }
  lastDragPos.value = pos

  // A zero offset is a bare cursor; leave the cursor range as-is.
  if (dragOffset.value === 0) return

  // Rebuild the active selection from the swept arc, restoring any prior
  // ctrl-selected ranges ahead of it.
  const segments = offsetToSegments(anchor, dragOffset.value, seqLen).map(
    (seg) => new Range(seg.start, seg.end, seg.orientation)
  )
  selection.domain.value = new SelectionDomain([...dragBaseRanges.value, ...segments])
}

function handleMouseUp() {
  isDragging.value = false
  lastDragPos.value = null
  dragOffset.value = 0
  dragBaseRanges.value = []
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)

  selection.endSelection()

  const domain = selection.domain.value
  if (domain && domain.ranges.length > 0) {
    emit('select', { ranges: domain.ranges })
  }
}

/**
 * Unified click handler for the circular SVG.
 * Routes clicks through layers using elementsFromPoint with priority order:
 * Annotation > Selection > Sequence.
 * If no layer handles the click, clears selection (background click).
 *
 * @param {MouseEvent} event - The click event
 */
function handleSvgClick(event) {
  // Skip if not left-click
  if (event.button !== 0) return

  // Use elementsFromPoint to find all elements at the click position
  const elements = document.elementsFromPoint(event.clientX, event.clientY)

  // Priority order: Annotation > Selection > Sequence
  for (const el of elements) {
    if (!el.dataset.layer) continue

    // Try each layer in priority order
    if (circularAnnotationLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (circularSelectionLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
    if (circularSequenceLayerRef.value?.handleClickForElement?.(el.dataset, event)) return
  }

  // No layer handled it - this is a background click
  // Note: Dead zone clearing is handled by handleMouseDown, so we don't need to
  // clear selection here - the mousedown/mouseup cycle handles that.
}

// ============================================
// Zoom Dragging
// ============================================

const isZooming = ref(false)
const zoomStartY = ref(0)
const zoomStartScale = ref(1.0)
const showZoomTooltip = ref(false)

function startZoomDrag(event) {
  event.preventDefault()
  event.stopPropagation()

  isZooming.value = true
  zoomStartY.value = event.clientY
  zoomStartScale.value = circularGraphics.zoomScale.value
  showZoomTooltip.value = true

  window.addEventListener('mousemove', handleZoomDrag)
  window.addEventListener('mouseup', handleZoomEnd)
}

function handleZoomDrag(event) {
  if (!isZooming.value) return

  const deltaY = zoomStartY.value - event.clientY
  const scaleFactor = 1 + deltaY / 200
  circularGraphics.setZoom(zoomStartScale.value * scaleFactor)
}

function handleZoomEnd() {
  isZooming.value = false
  showZoomTooltip.value = false
  window.removeEventListener('mousemove', handleZoomDrag)
  window.removeEventListener('mouseup', handleZoomEnd)
}

// ============================================
// Origin Dragging
// ============================================

const isDraggingOrigin = ref(false)
const originDragStartAngle = ref(0)
const originDragStartOffset = ref(0)

function startOriginDrag(event) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()

  isDraggingOrigin.value = true

  const coords = getCoordsFromEvent(event)
  if (coords) {
    originDragStartAngle.value = circularGraphics.mouseToAngle(coords.x, coords.y)
    originDragStartOffset.value = circularGraphics.originOffset.value
  }

  window.addEventListener('mousemove', handleOriginDragMove)
  window.addEventListener('mouseup', handleOriginDragEnd)
}

function handleOriginDragMove(event) {
  if (!isDraggingOrigin.value) return

  const coords = getCoordsFromEvent(event)
  if (!coords) return

  const currentAngle = circularGraphics.mouseToAngle(coords.x, coords.y)
  const angleDelta = currentAngle - originDragStartAngle.value
  circularGraphics.setOriginOffset(originDragStartOffset.value + angleDelta)
}

function handleOriginDragEnd() {
  isDraggingOrigin.value = false
  window.removeEventListener('mousemove', handleOriginDragMove)
  window.removeEventListener('mouseup', handleOriginDragEnd)
}

// ============================================
// Context Menu
// ============================================

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuItems = ref([])

function handleContextMenu(event) {
  if (isZooming.value) {
    event.preventDefault()
    return
  }

  const coords = getCoordsFromEvent(event)
  if (coords && isInDeadZone(coords)) {
    event.preventDefault()
    return
  }

  event.preventDefault()
  const pos = getPositionFromEvent(event)
  showContextMenu(event, { position: pos, source: 'background' })
}

function showContextMenu(event, context) {
  // Map the source-tagged context to a target chain and aggregate via the service.
  const targets = []
  if (context.source === 'annotation' && context.annotation) {
    targets.push({ layer: 'annotation', annotation: context.annotation, rangeIndex: context.fragment?.rangeIndex ?? 0 })
  } else if (context.source === 'selection' || context.source === 'handle') {
    targets.push({ layer: 'selection', rangeIndex: context.rangeIndex, range: context.range, handleType: context.handleType })
  } else {
    // background / sequence
    targets.push({ layer: context.source === 'sequence' ? 'sequence' : 'background', pos: context.position })
  }

  const items = contextMenu.buildMenu({
    mode: 'circular',
    targets,
    annotations: localAnnotations.value,
    selection,
    document: targetDoc.value,
    readonly: props.readonly,
    sequenceLength: editorState.sequenceLength.value,
    pos: context.position
  })

  if (items.length === 0) return
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuItems.value = items
  contextMenuVisible.value = true
}

function hideContextMenu() {
  contextMenuVisible.value = false
}

function selectAll() {
  const seqLen = editorState.sequenceLength.value
  if (seqLen > 0) {
    selection.select([new Range(0, seqLen)])
  }
}

// ============================================
// Selection Events
// ============================================

function handleSelectionChange(data) {
  emit('select', data)
}

function handleSelectionContextMenu(data) {
  showContextMenu(data.event, { ...data, source: 'selection' })
}

function handleSequenceContextMenu(data) {
  showContextMenu(data.event, { ...data, source: 'sequence' })
}

function handleHandleContextMenu(data) {
  showContextMenu(data.event, { ...data, source: 'handle' })
}

// ============================================
// Annotation Events
// ============================================

function handleAnnotationClick(data) {
  emit('annotation-click', data)
}

function handleAnnotationContextMenu(data) {
  emit('annotation-contextmenu', data)
  showContextMenu(data.event, { ...data, source: 'annotation' })
}

function handleAnnotationHover(data) {
  emit('annotation-hover', data)
}

// ============================================
// Keyboard Handling
// ============================================

function handleKeyDown(event) {
  // Copy
  if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
    event.preventDefault()
    handleCopy()
    return
  }

  // Paste
  if ((event.ctrlKey || event.metaKey) && event.key === 'v' && !props.readonly) {
    event.preventDefault()
    handlePaste()
    return
  }

  // Delete
  if ((event.key === 'Delete' || event.key === 'Backspace') && !props.readonly) {
    if (selection.isSelected.value) {
      event.preventDefault()
      handleDelete()
    }
    return
  }

  // Select all
  if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
    event.preventDefault()
    selectAll()
    return
  }

  // Escape
  if (event.key === 'Escape') {
    selection.unselect()
    return
  }
}

// ============================================
// Edit Operations
// ============================================

async function handleCopy() {
  if (!selection.isSelected.value) return

  const sequence = editorState.sequence.value
  const ranges = selection.domain.value.ranges
  let copyText = ''

  for (const range of ranges) {
    const seg = sequence.slice(range.start, range.end)
    if (range.orientation === Orientation.MINUS) {
      copyText += reverseComplement(seg)
    } else {
      copyText += seg
    }
  }

  try {
    await navigator.clipboard.writeText(copyText)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

async function handlePaste() {
  if (props.readonly) return

  try {
    const text = await navigator.clipboard.readText()
    const cleaned = text.toUpperCase().replace(/[^ATCGNRYSWKMBDHV]/g, '')
    if (cleaned) {
      insertModalText.value = cleaned
      openInsertModal(selection.isSelected.value && selection.domain.value.ranges[0].start !== selection.domain.value.ranges[0].end)
    }
  } catch (err) {
    console.error('Paste failed:', err)
  }
}

function handleDelete() {
  if (props.readonly || !selection.isSelected.value) return

  // SequenceDocument.delete() takes an array of fenced {start, end} ranges and
  // handles ordering internally.
  const ranges = selection.domain.value.ranges
    .filter(range => range.start !== range.end)
    .map(range => ({ start: range.start, end: range.end }))

  if (ranges.length > 0) {
    targetDoc.value?.delete?.(ranges)
  }

  selection.unselect()
  emit('edit', { type: 'delete' })
}

// ============================================
// Insert Modal
// ============================================

const insertModalVisible = ref(false)
const insertModalText = ref('')
const insertModalIsReplace = ref(false)
const insertModalPosition = ref(0)
const insertModalSelectionEnd = ref(0)
const insertModalOrientation = ref(Orientation.PLUS)

function openInsertModal(isReplace) {
  insertModalIsReplace.value = isReplace

  if (selection.isSelected.value && selection.domain.value.ranges.length > 0) {
    const range = selection.domain.value.ranges[0]
    insertModalPosition.value = range.start
    insertModalSelectionEnd.value = range.end
    insertModalOrientation.value = range.orientation || Orientation.PLUS
  } else {
    insertModalPosition.value = 0
    insertModalSelectionEnd.value = 0
    insertModalOrientation.value = Orientation.PLUS
  }

  insertModalText.value = ''
  insertModalVisible.value = true
}

function handleModalSubmit({ text, preserveAnnotations }) {
  const cleaned = text.toUpperCase().replace(/[^ATCGNRYSWKMBDHV]/g, '')
  if (!cleaned) {
    insertModalVisible.value = false
    return
  }

  if (insertModalIsReplace.value) {
    targetDoc.value?.replace?.(
      insertModalPosition.value,
      insertModalSelectionEnd.value,
      cleaned,
      { adjustAnnotations: !preserveAnnotations }
    )
  } else {
    targetDoc.value?.insert?.(insertModalPosition.value, cleaned)
  }

  insertModalVisible.value = false
  selection.unselect()
  emit('edit', { type: insertModalIsReplace.value ? 'replace' : 'insert' })
}

function handleInsertCancel() {
  insertModalVisible.value = false
}

// ============================================
// Annotation Modal
// ============================================

const annotationModalOpen = ref(false)
const annotationModalSpan = ref(null)
const editingAnnotation = ref(null)

function openAnnotationModal() {
  // Open with the current selection's ranges, or a blank span if nothing is selected.
  const ranges = (selection.isSelected.value && selection.domain.value)
    ? selection.domain.value.ranges.map(r => new Range(r.start, r.end, r.orientation))
    : []
  annotationModalSpan.value = new Span(ranges)
  editingAnnotation.value = null
  annotationModalOpen.value = true
}

function openAnnotationModalForEdit(annotation) {
  editingAnnotation.value = annotation
  annotationModalSpan.value = annotation.span ?? new Span()
  annotationModalOpen.value = true
}

function closeAnnotationModal() {
  annotationModalOpen.value = false
  annotationModalSpan.value = null
  editingAnnotation.value = null
}

async function handleAnnotationCreate(annotationData) {
  if (targetDoc.value?.addAnnotation) {
    // addAnnotation mints the id via the injectable (possibly async) generator;
    // await before emitting so the update reflects the new annotation.
    await targetDoc.value.addAnnotation(annotationData)
    emit('annotations-update')
  }
  closeAnnotationModal()
}

function handleAnnotationUpdate(annotationData) {
  if (targetDoc.value?.updateAnnotation) {
    targetDoc.value.updateAnnotation(annotationData)
    emit('annotations-update')
  }
  closeAnnotationModal()
}

// ============================================
// Extend Modal
// ============================================

const extendModalVisible = ref(false)
const extendModalDirection = ref('start')
const extendModalMaxBases = ref(0)

function handleExtendSubmit(bases) {
  extendModalVisible.value = false
  // Extend logic here
}

function handleExtendCancel() {
  extendModalVisible.value = false
}

// ============================================
// Delete Confirmation
// ============================================

const deleteConfirmVisible = ref(false)
const deleteConfirmLength = ref(0)

function confirmDelete() {
  deleteConfirmVisible.value = false
  handleDelete()
}

function cancelDelete() {
  deleteConfirmVisible.value = false
}

// ============================================
// Focus
// ============================================

function focusContainer() {
  containerRef.value?.focus()
}

// ============================================
// Lifecycle
// ============================================

onMounted(() => {
  emit('ready')
})

// ============================================
// Expose
// ============================================

defineExpose({
  circularGraphics,
  isZooming,
  showZoomTooltip,
  selection,
  editorState,
  // For testing the contributor-based context menu
  contextMenu,
  // For testing the edit paths (insert/replace/delete document mutation)
  openInsertModal,
  handleModalSubmit,
  handleDelete
})
</script>

<template>
  <div class="circular-editor">
    <!-- Toolbar -->
    <Toolbar
      :zoom-level="100"
      :show-zoom="false"
      :is-circular="true"
      :view-mode="'circular'"
      :readonly="props.readonly"
    >
      <template #title>
        <slot name="title">
          {{ editorState.title.value || 'Untitled' }} &mdash; {{ editorState.sequenceLength.value.toLocaleString() }} bp
        </slot>
      </template>

      <template #info>
        <slot name="info" />
      </template>

      <template #toolbar>
        <slot name="toolbar" />
      </template>

      <template #config>
        <slot name="config" />
      </template>
    </Toolbar>

    <!-- Editor Container -->
    <div class="editor-wrapper">
      <div
        ref="containerRef"
        class="editor-container"
        tabindex="0"
        @keydown="handleKeyDown"
        @click="focusContainer"
      >
        <svg
          ref="svgRef"
          class="circular-view"
          :viewBox="circularGraphics.viewBox.value"
          preserveAspectRatio="xMidYMid meet"
          @mousedown="handleMouseDown"
          @click="handleSvgClick"
          @contextmenu="handleContextMenu"
        >
          <!-- Background -->
          <rect
            x="0"
            y="0"
            :width="circularGraphics.viewBoxWidth.value"
            :height="circularGraphics.viewBoxHeight.value"
            class="background"
          />

          <!-- Sequence layer (backbone + tick marks) -->
          <CircularSequenceLayer
            ref="circularSequenceLayerRef"
            :draggable-origin="true"
            @select="handleSelectionChange"
            @contextmenu="handleSequenceContextMenu"
            @origin-drag-start="startOriginDrag"
          />

          <!-- Selection layer -->
          <CircularSelectionLayer
            ref="circularSelectionLayerRef"
            @select="handleSelectionChange"
            @contextmenu="handleSelectionContextMenu"
            @handle-contextmenu="handleHandleContextMenu"
          />

          <!-- Annotation layer -->
          <CircularAnnotationLayer
            ref="circularAnnotationLayerRef"
            :annotations="annotationInstances"
            :show-captions="showAnnotationCaptions"
            @click="handleAnnotationClick"
            @contextmenu="handleAnnotationContextMenu"
            @hover="handleAnnotationHover"
          />

          <!-- Extension layers -->
          <component
            v-for="ext in renderExtensions.filter(e => e.circularGraphicsLayer)"
            :key="ext.id + '-circular-layer'"
            :is="ext.circularGraphicsLayer"
          />

          <!-- Center text -->
          <text
            :x="titlePosition.x"
            :y="titlePosition.y"
            text-anchor="middle"
            dominant-baseline="middle"
            class="center-title"
          >
            {{ editorState.title.value || 'Untitled' }}
          </text>
          <text
            :x="lengthPosition.x"
            :y="lengthPosition.y"
            text-anchor="middle"
            dominant-baseline="middle"
            class="center-length"
          >
            {{ editorState.sequenceLength.value.toLocaleString() }} bp
          </text>

          <!-- Zoom tooltip -->
          <g v-if="showZoomTooltip" class="zoom-tooltip">
            <rect
              :x="circularGraphics.centerX.value - 50"
              :y="circularGraphics.centerY.value + 25"
              width="100"
              height="24"
              rx="4"
              class="zoom-tooltip-bg"
            />
            <text
              :x="circularGraphics.centerX.value"
              :y="circularGraphics.centerY.value + 42"
              text-anchor="middle"
              dominant-baseline="middle"
              class="zoom-tooltip-text"
            >
              Radius: {{ Math.round(circularGraphics.backboneRadius.value) }}px
            </text>
          </g>
        </svg>
      </div>

      <!-- Selection Status -->
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

    <!-- Insert Modal -->
    <InsertModal
      :visible="insertModalVisible"
      :initial-text="insertModalText"
      :is-replace="insertModalIsReplace"
      :position="insertModalPosition"
      :orientation="insertModalOrientation"
      @submit="handleModalSubmit"
      @cancel="handleInsertCancel"
    />

    <!-- Annotation Modal -->
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

    <!-- Extend Modal -->
    <ExtendModal
      :visible="extendModalVisible"
      :direction="extendModalDirection"
      :max-bases="extendModalMaxBases"
      @submit="handleExtendSubmit"
      @cancel="handleExtendCancel"
    />

    <!-- Delete Confirmation -->
    <ConfirmDialog
      :visible="deleteConfirmVisible"
      title="Delete Sequence"
      :message="`Are you sure you want to delete ${deleteConfirmLength.toLocaleString()} bp?`"
      confirm-label="Delete"
      @confirm="confirmDelete"
      @cancel="cancelDelete"
    />

    <!-- Extension panels -->
    <component
      v-for="ext in renderExtensions.filter(e => e.panel)"
      :key="ext.id + '-panel'"
      :is="ext.panel"
    />
  </div>
</template>

<style scoped>
.circular-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: system-ui, -apple-system, sans-serif;
  user-select: none;
}

.editor-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-container {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  background: white;
  outline: none;
}

.circular-view {
  width: 100%;
  height: 100%;
  max-width: 600px;
  max-height: 600px;
  user-select: none;
  -webkit-user-select: none;
}

.background {
  fill: white;
}

.backbone {
  fill: none;
  stroke: #333;
  stroke-width: 3;
}

.tick-marks {
  pointer-events: none;
}

.tick-line {
  stroke: #666;
  stroke-width: 1;
}

.tick-label {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 9px;
  fill: #666;
}

.origin-tick {
  pointer-events: all;
}

.origin-line {
  stroke: #333;
  stroke-width: 2;
}

.origin-label {
  font-weight: bold;
  fill: #333;
  cursor: grab;
}

.origin-label:hover {
  fill: #0066cc;
}

.origin-label:active {
  cursor: grabbing;
}

.center-title {
  font-family: Arial, sans-serif;
  font-size: 14px;
  font-weight: bold;
  fill: #333;
}

.center-length {
  font-family: Arial, sans-serif;
  font-size: 11px;
  fill: #666;
}

.zoom-tooltip {
  pointer-events: none;
}

.zoom-tooltip-bg {
  fill: rgba(0, 0, 0, 0.8);
}

.zoom-tooltip-text {
  font-family: "Lucida Console", Monaco, monospace;
  font-size: 11px;
  fill: white;
}
</style>
