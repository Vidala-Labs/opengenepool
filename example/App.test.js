import { describe, it, expect } from 'bun:test'

/**
 * Tests for the handleEdit function logic in App.vue
 * These test the sequence manipulation logic that will be used in the app.
 */
describe('App edit handling logic', () => {
  // Helper function that mirrors the handleEdit logic
  function applyEdit(sequence, data) {
    let seq = sequence

    if (data.type === 'delete' && data.ranges) {
      // Delete ranges from highest to lowest to avoid position shifting
      const sortedRanges = [...data.ranges].sort((a, b) => b.start - a.start)
      for (const range of sortedRanges) {
        seq = seq.slice(0, range.start) + seq.slice(range.end)
      }
    } else if (data.type === 'insert' && data.position !== undefined && data.text) {
      seq = seq.slice(0, data.position) + data.text + seq.slice(data.position)
    }

    return seq
  }

  describe('delete operations', () => {
    it('deletes middle 5bp from 25bp sequence', () => {
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'
      const result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 10, end: 15 }]
      })
      expect(result).toBe('ATCGATCGAACGATCGATCG')
      expect(result.length).toBe(20)
    })

    it('handles multiple ranges deleted from high to low', () => {
      const sequence = 'ABCDEFGHIJKLMNOP'
      const result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 2, end: 4 }, { start: 10, end: 12 }]
      })
      // Deletes KL (10-12) first, then CD (2-4)
      expect(result).toBe('ABEFGHIJMNOP')
    })
  })

  describe('insert operations', () => {
    it('inserts 5bp in middle of 20bp sequence', () => {
      const sequence = 'ATCGATCGATCGATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 10,
        text: 'GGGGG'
      })
      expect(result).toBe('ATCGATCGATGGGGGCGATCGATCG')
      expect(result.length).toBe(25)
    })

    it('inserts at beginning', () => {
      const sequence = 'ATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 0,
        text: 'TTT'
      })
      expect(result).toBe('TTTATCGATCG')
    })

    it('inserts at end', () => {
      const sequence = 'ATCGATCG'
      const result = applyEdit(sequence, {
        type: 'insert',
        position: 8,
        text: 'CCC'
      })
      expect(result).toBe('ATCGATCGCCC')
    })
  })

  describe('replace operations (delete + insert)', () => {
    it('replaces TTTTT with CCCCC', () => {
      const sequence = 'ATCGATCGAATTTTTCGATCGATCG'

      // First delete
      let result = applyEdit(sequence, {
        type: 'delete',
        ranges: [{ start: 10, end: 15 }]
      })
      expect(result).toBe('ATCGATCGAACGATCGATCG')

      // Then insert at same position
      result = applyEdit(result, {
        type: 'insert',
        position: 10,
        text: 'CCCCC'
      })
      expect(result).toBe('ATCGATCGAACCCCCCGATCGATCG')
      expect(result.length).toBe(25)
    })
  })
})
