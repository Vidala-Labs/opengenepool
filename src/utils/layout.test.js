import { describe, it, expect } from 'bun:test'
import { rangesOverlap, anyRangesOverlap, assignToRows } from './layout.js'

describe('rangesOverlap', () => {
  it('returns true for overlapping ranges', () => {
    expect(rangesOverlap(0, 10, 5, 15)).toBe(true)
    expect(rangesOverlap(5, 15, 0, 10)).toBe(true)
  })

  it('returns true for contained ranges', () => {
    expect(rangesOverlap(0, 20, 5, 15)).toBe(true)
    expect(rangesOverlap(5, 15, 0, 20)).toBe(true)
  })

  it('returns false for non-overlapping ranges', () => {
    expect(rangesOverlap(0, 10, 20, 30)).toBe(false)
    expect(rangesOverlap(20, 30, 0, 10)).toBe(false)
  })

  it('returns false for touching ranges (exclusive)', () => {
    expect(rangesOverlap(0, 10, 10, 20)).toBe(false)
    expect(rangesOverlap(10, 20, 0, 10)).toBe(false)
  })
})

describe('anyRangesOverlap', () => {
  it('returns true if any pair overlaps', () => {
    const ranges1 = [{ start: 0, end: 10 }, { start: 40, end: 50 }]
    const ranges2 = [{ start: 5, end: 15 }]
    expect(anyRangesOverlap(ranges1, ranges2)).toBe(true)
  })

  it('returns false if no pairs overlap', () => {
    const ranges1 = [{ start: 0, end: 10 }, { start: 40, end: 50 }]
    const ranges2 = [{ start: 20, end: 30 }]
    expect(anyRangesOverlap(ranges1, ranges2)).toBe(false)
  })

  it('handles single-range arrays', () => {
    expect(anyRangesOverlap(
      [{ start: 0, end: 10 }],
      [{ start: 5, end: 15 }]
    )).toBe(true)

    expect(anyRangesOverlap(
      [{ start: 0, end: 10 }],
      [{ start: 20, end: 30 }]
    )).toBe(false)
  })
})

describe('assignToRows', () => {
  it('places non-overlapping items in the same row', () => {
    const items = [
      { id: 'a', ranges: [{ start: 0, end: 10 }] },
      { id: 'b', ranges: [{ start: 20, end: 30 }] }
    ]

    const { assignments, rowCount } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id
    })

    expect(rowCount).toBe(1)
    expect(assignments.get(items[0])).toBe(0)
    expect(assignments.get(items[1])).toBe(0)
  })

  it('places overlapping items in different rows', () => {
    const items = [
      { id: 'a', ranges: [{ start: 0, end: 20 }] },
      { id: 'b', ranges: [{ start: 10, end: 30 }] }
    ]

    const { assignments, rowCount } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id
    })

    expect(rowCount).toBe(2)
    expect(assignments.get(items[0])).toBe(0)
    expect(assignments.get(items[1])).toBe(1)
  })

  it('allows items to fit in gaps of multi-part ranges', () => {
    const items = [
      { id: 'multi', ranges: [{ start: 0, end: 10 }, { start: 40, end: 50 }] },
      { id: 'gap', ranges: [{ start: 20, end: 30 }] }
    ]

    const { assignments, rowCount } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id
    })

    expect(rowCount).toBe(1)
    expect(assignments.get(items[0])).toBe(0)
    expect(assignments.get(items[1])).toBe(0)
  })

  it('applies custom sorting before placement', () => {
    const items = [
      { id: 'small', ranges: [{ start: 5, end: 15 }] },
      { id: 'large', ranges: [{ start: 0, end: 100 }] }
    ]

    // Sort by size descending (largest first)
    const { assignments } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id,
      sort: (a, b) => {
        const aLen = a.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
        const bLen = b.ranges.reduce((sum, r) => sum + (r.end - r.start), 0)
        return bLen - aLen
      }
    })

    // Large gets row 0 (placed first), small gets row 1 (overlaps)
    expect(assignments.get(items[1])).toBe(0) // large
    expect(assignments.get(items[0])).toBe(1) // small
  })

  it('skips items with no ranges', () => {
    const items = [
      { id: 'a', ranges: [{ start: 0, end: 10 }] },
      { id: 'empty', ranges: [] },
      { id: 'null', ranges: null }
    ]

    const { assignments, rowCount } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id
    })

    expect(rowCount).toBe(1)
    expect(assignments.get(items[0])).toBe(0)
    expect(assignments.has(items[1])).toBe(false)
    expect(assignments.has(items[2])).toBe(false)
  })

  it('returns rows with placed items for further processing', () => {
    const items = [
      { id: 'a', ranges: [{ start: 0, end: 10 }] },
      { id: 'b', ranges: [{ start: 20, end: 30 }] }
    ]

    const { rows } = assignToRows(items, {
      getRanges: item => item.ranges,
      getId: item => item.id
    })

    expect(rows.length).toBe(1)
    expect(rows[0].length).toBe(2)
    expect(rows[0][0].id).toBe('a')
    expect(rows[0][1].id).toBe('b')
  })
})
