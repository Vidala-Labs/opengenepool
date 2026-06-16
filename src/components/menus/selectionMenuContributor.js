/**
 * Selection context-menu contributor.
 *
 * Owns ALL selection-related menu items, across both invocation styles:
 *
 *  1. Clicked directly ON a selection range/handle (`context.kind === 'selection'`,
 *     with `rangeIndex` and optionally `handleType`): per-range operations —
 *     Copy selection, strand ops, multi-range move/delete, Extend-to-position.
 *
 *  2. Invoked in a broader sequence/background context (`context.kind` is
 *     'sequence' or 'background') where a selection merely EXISTS: the
 *     selection-state items — Copy selection, Select none, Replace, Delete,
 *     Create annotation.
 *
 * The contributor decides which style it is from `context.kind`, so a single
 * module produces the right items whether the user right-clicked the selection
 * itself or empty space while a selection was active.
 *
 * `context.mode` ('linear'|'circular'|'target'|'query') is passed through but the
 * selection items are coordinate-system agnostic; mode only matters for routing,
 * handled by the editor before this is called.
 *
 * Mutating actions delegate to `deps` callbacks wired by the layer/editor:
 *   { onCopy, onSelectNone, onSelectAll, onReplace, onDelete, onCreateAnnotation,
 *     onFlip, onSetOrientation, onDeleteRange, onMoveRange, onExtendHandle }
 *
 * @param {Object} context
 * @param {Object} deps
 * @returns {Array} menu items
 */
export function selectionMenuItems(context, deps = {}) {
  if (!context) return []
  const { kind, selection, readonly } = context
  const domain = selection?.domain?.value
  const hasSelection = !!(selection?.isSelected?.value && domain && domain.ranges.length > 0)

  // Style 1: clicked directly on a selection range/handle.
  if (kind === 'selection') {
    return selectionRangeItems(context, deps)
  }

  // Style 2: sequence/background context with an existing selection.
  if (kind !== 'sequence' && kind !== 'background') return []
  if (!hasSelection) return []

  const items = []
  const firstRange = domain.ranges[0]
  const isZeroLength = firstRange.start === firstRange.end

  items.push({ id: 'copy-selection', label: 'Copy selection', action: () => deps.onCopy?.() })
  items.push({ id: 'select-none', label: 'Select none', action: () => deps.onSelectNone?.() })

  if (!readonly) {
    // Replace only for a single non-zero-length range.
    if (!isZeroLength && domain.ranges.length === 1) {
      items.push({ id: 'replace-sequence', label: 'Replace sequence with...', action: () => deps.onReplace?.(firstRange) })
    }
    // Delete only for non-zero-length selections.
    if (!isZeroLength) {
      items.push({ id: 'delete-sequence', label: 'Delete sequence', action: () => deps.onDelete?.() })
    }
    items.push({ id: 'create-annotation', label: 'Create Annotation', action: () => deps.onCreateAnnotation?.() })
  }

  return items
}

/** Per-range / per-handle items (clicked directly on a selection element). */
function selectionRangeItems(context, deps) {
  const { selection, rangeIndex, handleType } = context
  const domain = selection?.domain?.value
  if (rangeIndex === undefined || !domain?.ranges?.[rangeIndex]) return []
  const range = domain.ranges[rangeIndex]

  if (handleType) {
    return [{
      id: 'extend-to-position',
      label: 'Extend to position...',
      action: () => deps.onExtendHandle?.(rangeIndex, range, handleType)
    }]
  }

  const items = []
  items.push({ id: 'copy-selection', label: 'Copy selection', action: () => deps.onCopy?.(rangeIndex, range) })

  if (range.orientation === 1 || range.orientation === -1) {
    items.push({ id: 'flip-strand', label: 'Flip strand', action: () => deps.onFlip?.(rangeIndex) })
    items.push({ id: 'make-undirected', label: 'Make undirected', action: () => deps.onSetOrientation?.(rangeIndex, 0) })
  } else {
    items.push({ id: 'set-plus-strand', label: 'Set to plus strand', action: () => deps.onSetOrientation?.(rangeIndex, 1) })
    items.push({ id: 'set-minus-strand', label: 'Set to minus strand', action: () => deps.onSetOrientation?.(rangeIndex, -1) })
  }

  if (domain.ranges.length > 1) {
    items.push({ id: 'delete-range', label: 'Delete this range', action: () => deps.onDeleteRange?.(rangeIndex) })
    if (rangeIndex > 0) {
      items.push({ id: 'move-range-up', label: 'Move range up', action: () => deps.onMoveRange?.(rangeIndex, rangeIndex - 1) })
    }
    if (rangeIndex < domain.ranges.length - 1) {
      items.push({ id: 'move-range-down', label: 'Move range down', action: () => deps.onMoveRange?.(rangeIndex, rangeIndex + 1) })
    }
  }

  return items
}
