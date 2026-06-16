/**
 * Context-menu contributor service.
 *
 * Each interactive layer self-registers a *contributor* — an object
 * `{ id, getItems(context) => MenuItem[] }` — on mount, and unregisters on
 * unmount. When the editor wants a menu, it resolves the click into a rich
 * `context` object and calls `buildMenu(context)`, which asks every registered
 * contributor (in registration order) for its items and concatenates them with
 * one separator between non-empty contributors.
 *
 * This replaces the old approach where each editor hand-enumerated its layer
 * refs and assembled items itself, and removes the per-editor duplication of
 * "global" items between the linear and circular editors.
 *
 * A `MenuItem` is `{ id?, label, action, disabled? }` or `{ separator: true }`.
 */

/**
 * Collapse separators in a menu-item list so the menu never shows a leading,
 * trailing, or doubled divider. Pure + exported for direct unit testing.
 *
 * @param {Array} items
 * @returns {Array}
 */
export function normalizeMenuItems(items) {
  const out = []
  for (const it of items) {
    if (!it) continue
    if (it.separator) {
      // Only keep a separator if it follows a real item (drops leading + collapses runs).
      if (out.length > 0 && !out[out.length - 1].separator) {
        out.push(it)
      }
      continue
    }
    out.push(it)
  }
  // Drop a trailing separator.
  while (out.length > 0 && out[out.length - 1].separator) {
    out.pop()
  }
  return out
}

export function useContextMenu() {
  // Insertion-ordered map keyed by contributor id (idempotent registration).
  const contributors = new Map()

  function register(contributor) {
    if (!contributor?.id) {
      throw new Error('Context-menu contributor must have an id')
    }
    contributors.set(contributor.id, contributor)
  }

  function unregister(contributor) {
    const id = typeof contributor === 'string' ? contributor : contributor?.id
    if (id) contributors.delete(id)
  }

  /**
   * Build the aggregated menu for a resolved context.
   * Contributors run in registration order; each contributor's items are kept
   * as a group and groups are joined by a single separator (then normalized).
   *
   * @param {Object} context - The resolved click context (see editor resolvers).
   * @returns {Array} Normalized menu items.
   */
  function buildMenu(context) {
    const groups = []
    for (const contributor of contributors.values()) {
      const items = contributor.getItems(context)
      if (Array.isArray(items) && items.length > 0) {
        groups.push(items)
      }
    }
    // Join groups with a boundary separator, then normalize away any
    // leading/trailing/doubled separators (including ones a contributor emitted
    // at its own boundaries).
    const joined = []
    groups.forEach((group, i) => {
      if (i > 0) joined.push({ separator: true })
      joined.push(...group)
    })
    return normalizeMenuItems(joined)
  }

  return { register, unregister, buildMenu }
}
