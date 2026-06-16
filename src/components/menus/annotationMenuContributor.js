import { Orientation } from '../../utils/dna.js'
import { isAnnotationHidden } from '../../utils/annotation.js'

/**
 * Annotation context-menu contributor.
 *
 * Single source of truth for the items shown when an annotation is right-clicked,
 * shared by the linear (AnnotationLayer), circular (CircularAnnotationLayer), and
 * alignment (AlignmentEditor) views. It contains only annotation + selection logic
 * and no view/graphics dependency.
 *
 * The editor resolves the click into a rich `context` BEFORE calling this — in
 * particular `context.annotation` is the *effective* annotation (in alignment
 * mode the editor has already unwrapped `_originalAnnotation`), so this module
 * never reads alignment internals.
 *
 * `context.mode` is the display surface that was clicked:
 *   'linear' | 'circular' | 'target' | 'query'   (mutually exclusive)
 *   - 'linear'   single-sequence linear display (SequenceEditor)
 *   - 'circular' circular display (CircularEditor)
 *   - 'target' / 'query' the two rows of the alignment display (AlignmentEditor)
 *   NOTE: 'target' is *conceptually* linear, but it is NEVER part of a plain
 *   linear sequence display — it appears ONLY in the alignment display (likewise
 *   'query'). The four values are disjoint surfaces owned by three editors, so a
 *   contributor never sees 'linear' together with a target/query row.
 *
 * Mutating actions are delegated to `deps` callbacks (wired by each layer to its
 * own event/modal/undo plumbing) so the item SET is identical everywhere and only
 * the wiring differs.
 *
 * @param {Object} context
 * @param {'annotation'} context.kind
 * @param {Object} context.annotation - effective annotation
 * @param {number} [context.rangeIndex] - clicked range index within the span
 * @param {Array}  [context.annotations] - all annotations (for clip-primer matching)
 * @param {Object} [context.selection] - selection composable
 * @param {boolean} [context.readonly]
 * @param {Object} deps - { onEdit, onDelete, onToggleHidden, onSubtract,
 *   onMergeLeft, onMergeRight, onSplit, onClipPrimer }
 * @returns {Array} menu items
 */
export function annotationMenuItems(context, deps = {}) {
  if (!context || context.kind !== 'annotation' || !context.annotation) return []
  if (context.readonly) return []

  const { annotation, selection } = context
  const rangeIndex = context.rangeIndex
  const spanRanges = annotation.span?.ranges
  const items = []

  // Edit
  items.push({
    id: 'edit-annotation',
    label: 'Edit Annotation',
    action: () => deps.onEdit?.(annotation)
  })

  // Delete
  items.push({
    id: 'delete-annotation',
    label: 'Delete Annotation',
    action: () => deps.onDelete?.(annotation)
  })

  // Hide / Unhide (toggles the ogp:hidden internal attribute)
  const currentlyHidden = isAnnotationHidden(annotation)
  items.push({
    id: currentlyHidden ? 'unhide-annotation' : 'hide-annotation',
    label: currentlyHidden ? 'Unhide annotation' : 'Hide annotation',
    action: () => deps.onToggleHidden?.(annotation, !currentlyHidden)
  })

  // Subtract from selection (when the annotation overlaps the selection)
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const hasOverlap = selection.domain.value.ranges.some(selRange =>
      spanRanges?.some(annRange => selRange.overlaps?.(annRange))
    )
    if (hasOverlap) {
      items.push({
        id: 'subtract-from-selection',
        label: 'Subtract from selection',
        action: () => deps.onSubtract?.(annotation)
      })
    }
  }

  // Merge segment options for multi-range annotations
  if (rangeIndex !== undefined && spanRanges && spanRanges.length > 1) {
    const currentRange = spanRanges[rangeIndex]

    if (rangeIndex > 0) {
      const leftRange = spanRanges[rangeIndex - 1]
      if (leftRange.end === currentRange.start && leftRange.orientation === currentRange.orientation) {
        items.push({
          id: 'merge-with-left-segment',
          label: 'Merge with left segment',
          action: () => deps.onMergeLeft?.(annotation, rangeIndex)
        })
      }
    }

    if (rangeIndex < spanRanges.length - 1) {
      const rightRange = spanRanges[rangeIndex + 1]
      if (currentRange.end === rightRange.start && currentRange.orientation === rightRange.orientation) {
        items.push({
          id: 'merge-with-right-segment',
          label: 'Merge with right segment',
          action: () => deps.onMergeRight?.(annotation, rangeIndex)
        })
      }
    }
  }

  // Split annotation when a cursor sits strictly inside a range
  if (selection?.isSelected?.value && rangeIndex !== undefined) {
    const selRanges = selection.domain.value?.ranges
    if (selRanges?.length === 1 && selRanges[0].start === selRanges[0].end) {
      const cursorPos = selRanges[0].start
      const targetRange = spanRanges?.[rangeIndex]
      if (targetRange && cursorPos > targetRange.start && cursorPos < targetRange.end) {
        items.push({
          id: 'split-annotation',
          label: 'Split annotation',
          action: () => deps.onSplit?.(annotation, rangeIndex, cursorPos)
        })
      }
    }
  }

  // Clip primer binding: selection exactly matches a primer's span, and the
  // clicked annotation has exactly one end inside that selection.
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const selRanges = selection.domain.value.ranges
    if (selRanges?.length === 1) {
      const selRange = selRanges[0]
      const allAnnotations = context.annotations || []

      const matchingPrimers = allAnnotations.filter(a => {
        if (a.type !== 'primer') return false
        if (a.attributes?.primer_bind !== undefined) return false
        const ranges = a.span?.ranges
        if (!ranges || ranges.length !== 1) return false
        const r = ranges[0]
        return r.start === selRange.start && r.end === selRange.end
      })

      const clickedRange = spanRanges?.[rangeIndex ?? 0]
      if (clickedRange && matchingPrimers.length > 0) {
        const startInside = clickedRange.start > selRange.start && clickedRange.start < selRange.end
        const endInside = clickedRange.end > selRange.start && clickedRange.end < selRange.end

        if (startInside !== endInside) { // XOR - exactly one end inside
          const clipPosition = startInside ? clickedRange.start : clickedRange.end
          for (const primer of matchingPrimers) {
            items.push({
              id: 'clip-primer-binding',
              label: `Clip primer binding of ${primer.caption}`,
              action: () => deps.onClipPrimer?.(primer, clipBind(primer.span.ranges[0], clipPosition))
            })
          }
        }
      }
    }
  }

  // Reverse: clip THIS primer with the current selection (one terminus inside it).
  if (selection?.isSelected?.value && selection?.domain?.value) {
    const selRanges = selection.domain.value.ranges
    if (selRanges?.length === 1) {
      const selRange = selRanges[0]
      if (annotation.type === 'primer' && annotation.attributes?.primer_bind === undefined) {
        const primerRanges = spanRanges
        if (primerRanges?.length === 1) {
          const primerRange = primerRanges[0]
          const selStartInside = selRange.start > primerRange.start && selRange.start < primerRange.end
          const selEndInside = selRange.end > primerRange.start && selRange.end < primerRange.end

          if (selStartInside !== selEndInside) { // XOR
            const clipPosition = selStartInside ? selRange.start : selRange.end
            items.push({
              id: 'clip-this-primer',
              label: 'Clip this primer with selection',
              action: () => deps.onClipPrimer?.(annotation, clipBind(primerRange, clipPosition))
            })
          }
        }
      }
    }
  }

  return items
}

/** primer_bind length from a primer range + clip position, honoring orientation. */
function clipBind(primerRange, clipPosition) {
  return primerRange.orientation === Orientation.PLUS
    ? primerRange.end - clipPosition
    : clipPosition - primerRange.start
}
