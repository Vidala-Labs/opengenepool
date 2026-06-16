/**
 * Sequence context-menu contributor.
 *
 * Owns the items that belong to the sequence/background surface itself (not a
 * selection or annotation):
 *   - Select all (whenever the sequence is non-empty)
 *   - Insert sequence... (at the cursor, or into an empty document) when editable
 *
 * Triggered for `context.kind === 'sequence'` or `'background'`.
 *
 * `context.mode` ('linear'|'circular'|'target'|'query') identifies the clicked
 * display surface. For alignment rows ('target'/'query') the layer is one of two
 * stacked rows, so this contributor uses `context.mode` to (a) only contribute for
 * the row that was actually clicked and (b) attribute the resulting selection to
 * that row via `deps.onSelectAll(mode)`. NOTE: 'target' is conceptually linear but
 * appears ONLY in the alignment display, never in a plain linear sequence display
 * (likewise 'query'); 'linear'/'circular'/'target'/'query' are disjoint surfaces.
 *
 * Mutating actions delegate to `deps`: { onSelectAll(mode), onInsert(position) }.
 * `context.layerMode` is the mode this contributor's layer represents (for
 * alignment rows); when set, the contributor returns [] if it doesn't match
 * `context.mode` so the non-clicked row stays silent.
 *
 * @param {Object} context
 * @param {Object} deps
 * @returns {Array} menu items
 */
export function sequenceMenuItems(context, deps = {}) {
  if (!context) return []
  const { kind, selection, readonly, mode, layerMode, sequenceLength = 0 } = context
  if (kind !== 'sequence' && kind !== 'background') return []

  // Alignment: only the clicked row contributes.
  if (layerMode && mode && layerMode !== mode) return []

  const items = []
  const domain = selection?.domain?.value
  const hasSelection = !!(selection?.isSelected?.value && domain && domain.ranges.length > 0)

  if (sequenceLength > 0) {
    items.push({ id: 'select-all', label: 'Select all', action: () => deps.onSelectAll?.(layerMode ?? mode ?? null) })
  }

  if (!readonly) {
    // Insert at the cursor (zero-length selection) or into an empty document.
    if (sequenceLength === 0) {
      items.push({ id: 'insert-sequence', label: 'Insert sequence...', action: () => deps.onInsert?.(0) })
    } else if (hasSelection) {
      const firstRange = domain.ranges[0]
      if (firstRange.start === firstRange.end) {
        items.push({ id: 'insert-sequence', label: 'Insert sequence...', action: () => deps.onInsert?.(firstRange.start) })
      }
    }
  }

  return items
}
