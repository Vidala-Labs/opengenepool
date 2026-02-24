/**
 * Layout utilities for annotation row assignment.
 * Shared between linear (useAnnotations) and circular (CircularAnnotationLayer) views.
 */

/**
 * Check if two ranges overlap (exclusive of touching edges).
 * @param {number} start1
 * @param {number} end1
 * @param {number} start2
 * @param {number} end2
 * @returns {boolean}
 */
export function rangesOverlap(start1, end1, start2, end2) {
  return start1 < end2 && end1 > start2
}

/**
 * Check if any range in ranges1 overlaps with any range in ranges2.
 * @param {Array<{start: number, end: number}>} ranges1
 * @param {Array<{start: number, end: number}>} ranges2
 * @returns {boolean}
 */
export function anyRangesOverlap(ranges1, ranges2) {
  for (const r1 of ranges1) {
    for (const r2 of ranges2) {
      if (rangesOverlap(r1.start, r1.end, r2.start, r2.end)) {
        return true
      }
    }
  }
  return false
}

/**
 * Assign items to rows using greedy bin-packing based on range overlap.
 * Items are placed in the first row where they don't overlap with existing items.
 *
 * @param {Array} items - Items to place
 * @param {Object} options
 * @param {Function} options.getRanges - (item) => Array<{start, end}> - get ranges for an item
 * @param {Function} [options.sort] - Optional comparator for sorting items before placement
 * @param {Function} [options.getId] - Optional (item) => id for debugging/tracking
 * @returns {{ assignments: Map, rowCount: number, rows: Array }}
 */
export function assignToRows(items, { getRanges, sort, getId }) {
  const sorted = sort ? [...items].sort(sort) : items
  const rows = []
  const assignments = new Map()

  for (const item of sorted) {
    const ranges = getRanges(item)
    if (!ranges || ranges.length === 0) continue

    // Find first row where this item doesn't overlap
    let placedRow = -1
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]
      let hasOverlap = false

      for (const placed of row) {
        if (anyRangesOverlap(ranges, placed.ranges)) {
          hasOverlap = true
          break
        }
      }

      if (!hasOverlap) {
        placedRow = rowIdx
        break
      }
    }

    // If no existing row works, create a new one
    if (placedRow === -1) {
      placedRow = rows.length
      rows.push([])
    }

    // Place item in this row
    const id = getId ? getId(item) : null
    rows[placedRow].push({ ranges, id, item })
    assignments.set(item, placedRow)
  }

  return { assignments, rowCount: rows.length, rows }
}
