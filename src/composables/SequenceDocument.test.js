import { describe, it, expect, beforeEach } from 'bun:test'
import { SequenceDocument } from './SequenceDocument.js'
import { Span } from '../utils/dna.js'

describe('SequenceDocument', () => {
  describe('constructor', () => {
    it('creates empty document with defaults', () => {
      const doc = new SequenceDocument()
      expect(doc.sequence).toBe('')
      expect(doc.annotations).toEqual([])
      expect(doc.circular).toBe(false)
      expect(doc.length).toBe(0)
    })

    it('creates document with initial values', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: '1', caption: 'test', type: 'gene', span: Span.parse('0..4') }],
        circular: true
      })
      expect(doc.sequence).toBe('ATCGATCG')
      expect(doc.annotations.length).toBe(1)
      expect(doc.annotations[0].caption).toBe('test')
      expect(doc.circular).toBe(true)
      expect(doc.length).toBe(8)
    })

    it('normalizes annotations without id', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCG',
        annotations: [{ caption: 'test', type: 'CDS', span: Span.parse('0..4') }]
      })
      expect(doc.annotations[0].id).toBeDefined()
      expect(typeof doc.annotations[0].id).toBe('string')
    })

    it('throws when annotations ingress string spans', () => {
      expect(() => new SequenceDocument({
        sequence: 'ATCG',
        annotations: [{ id: '1', caption: 'test', type: 'gene', span: '0..4' }]
      })).toThrow('SequenceDocument requires annotation spans to be Span objects')
    })
  })

  describe('insert', () => {
    it('inserts at beginning', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      const inserted = doc.insert(0, 'GGG')
      expect(doc.sequence).toBe('GGGATCG')
      expect(inserted).toBe('GGG')
    })

    it('inserts in middle', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.insert(2, 'AAA')
      expect(doc.sequence).toBe('ATAAACG')
    })

    it('inserts at end', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.insert(4, 'TTT')
      expect(doc.sequence).toBe('ATCGTTT')
    })

    it('clamps position to valid range', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.insert(-5, 'GGG')
      expect(doc.sequence).toBe('GGGATCG')

      doc.insert(100, 'TTT')
      expect(doc.sequence).toBe('GGGATCGTTT')
    })
  })

  describe('delete', () => {
    it('deletes single range', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCG' })
      const deleted = doc.delete([{ start: 2, end: 5 }])
      expect(doc.sequence).toBe('ATTCG')
      expect(deleted).toBe('CGA')
    })

    it('deletes multiple ranges from high to low', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCGATCG' })
      // Original: A T C G A T C G A T C G
      // Positions: 0 1 2 3 4 5 6 7 8 9 10 11
      // Range 0..2 = 'AT', Range 6..8 = 'CG'
      const deleted = doc.delete([
        { start: 0, end: 2 },   // AT
        { start: 6, end: 8 }    // CG
      ])
      expect(doc.sequence).toBe('CGATATCG')
      expect(deleted).toBe('ATCG')
    })

    it('handles overlapping ranges', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCG' })
      doc.delete([
        { start: 2, end: 6 },
        { start: 4, end: 8 }
      ])
      // First deletes 4..8 -> ATCG, then 2..4 -> AT
      expect(doc.sequence).toBe('AT')
    })

    it('returns empty string for empty ranges', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      const deleted = doc.delete([])
      expect(deleted).toBe('')
      expect(doc.sequence).toBe('ATCG')
    })

    it('handles null/undefined ranges', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.delete(null)).toBe('')
      expect(doc.delete(undefined)).toBe('')
    })

    it('clamps ranges to sequence bounds', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.delete([{ start: -2, end: 100 }])
      expect(doc.sequence).toBe('')
    })
  })

  describe('replace', () => {
    it('replaces range with text', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCG' })
      // Original: A T C G A T C G
      // Positions: 0 1 2 3 4 5 6 7
      // Range 2..5 = 'CGA' (positions 2,3,4)
      const deleted = doc.replace(2, 5, 'XXX')
      expect(doc.sequence).toBe('ATXXXTCG')
      expect(deleted).toBe('CGA')
    })

    it('replaces with shorter text', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCG' })
      // Range 2..6 = 'CGAT' (positions 2,3,4,5) - 4 chars
      // Replace with 'X': 'AT' + 'X' + 'CG' = 'ATXCG'
      doc.replace(2, 6, 'X')
      expect(doc.sequence).toBe('ATXCG')
    })

    it('replaces with longer text', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.replace(1, 3, 'XXXXX')
      expect(doc.sequence).toBe('AXXXXXG')
    })

    it('replaces with empty string (deletion)', () => {
      const doc = new SequenceDocument({ sequence: 'ATCGATCG' })
      doc.replace(2, 5, '')
      expect(doc.sequence).toBe('ATTCG')
    })
  })

  describe('setCircular', () => {
    it('sets circular to true', () => {
      const doc = new SequenceDocument({ circular: false })
      doc.setCircular(true)
      expect(doc.circular).toBe(true)
    })

    it('sets circular to false', () => {
      const doc = new SequenceDocument({ circular: true })
      doc.setCircular(false)
      expect(doc.circular).toBe(false)
    })

    it('coerces truthy values', () => {
      const doc = new SequenceDocument({ circular: false })
      doc.setCircular(1)
      expect(doc.circular).toBe(true)
      doc.setCircular(0)
      expect(doc.circular).toBe(false)
    })
  })

  describe('annotation methods', () => {
    let doc

    beforeEach(() => {
      doc = new SequenceDocument({
        sequence: 'ATCGATCGATCG',
        annotations: [
          { id: 'ann1', caption: 'Gene1', type: 'gene', span: Span.parse('0..4') },
          { id: 'ann2', caption: 'Gene2', type: 'CDS', span: Span.parse('6..10') }
        ]
      })
    })

    describe('addAnnotation', () => {
      it('adds annotation and returns id', () => {
        const id = doc.addAnnotation({
          caption: 'New Gene',
          type: 'promoter',
          span: Span.parse('2..6')
        })
        expect(typeof id).toBe('string')
        expect(doc.annotations.length).toBe(3)
        expect(doc.annotations[2].caption).toBe('New Gene')
      })

      it('preserves provided id', () => {
        const id = doc.addAnnotation({
          id: 'custom-id',
          caption: 'Test',
          type: 'gene',
          span: Span.parse('0..4')
        })
        expect(id).toBe('custom-id')
      })
    })

    describe('updateAnnotation', () => {
      it('updates existing annotation', () => {
        const result = doc.updateAnnotation({
          id: 'ann1',
          caption: 'Updated Gene'
        })
        expect(result).toBe(true)
        expect(doc.annotations[0].caption).toBe('Updated Gene')
        expect(doc.annotations[0].type).toBe('gene') // unchanged
      })

      it('returns false for non-existent id', () => {
        const result = doc.updateAnnotation({
          id: 'nonexistent',
          caption: 'Test'
        })
        expect(result).toBe(false)
      })
    })

    describe('deleteAnnotation', () => {
      it('deletes annotation by id', () => {
        const result = doc.deleteAnnotation('ann1')
        expect(result).toBe(true)
        expect(doc.annotations.length).toBe(1)
        expect(doc.annotations[0].id).toBe('ann2')
      })

      it('returns false for non-existent id', () => {
        const result = doc.deleteAnnotation('nonexistent')
        expect(result).toBe(false)
        expect(doc.annotations.length).toBe(2)
      })
    })

    describe('getAnnotation', () => {
      it('returns annotation by id', () => {
        const ann = doc.getAnnotation('ann1')
        expect(ann).toBeDefined()
        expect(ann.caption).toBe('Gene1')
      })

      it('returns undefined for non-existent id', () => {
        const ann = doc.getAnnotation('nonexistent')
        expect(ann).toBeUndefined()
      })
    })
  })

  describe('serialization', () => {
    it('exports to JSON', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCG',
        annotations: [{ id: '1', caption: 'Test', type: 'gene', span: Span.parse('0..4') }],
        circular: true
      })

      const json = doc.toJSON()
      expect(json.sequence).toBe('ATCG')
      expect(json.annotations.length).toBe(1)
      expect(json.annotations[0].span).toBe('0..4')
      expect(json.circular).toBe(true)
    })

    it('creates from JSON', () => {
      const data = {
        sequence: 'ATCGATCG',
        annotations: [{ id: '1', caption: 'Test', type: 'CDS', span: Span.parse('0..4') }],
        circular: true
      }

      const doc = SequenceDocument.fromJSON(data)
      expect(doc.sequence).toBe('ATCGATCG')
      expect(doc.annotations[0].caption).toBe('Test')
      expect(doc.circular).toBe(true)
    })

    it('handles missing fields in fromJSON', () => {
      const doc = SequenceDocument.fromJSON({})
      expect(doc.sequence).toBe('')
      expect(doc.annotations).toEqual([])
      expect(doc.circular).toBe(false)
    })
  })

  describe('reactivity', () => {
    it('sequence getter returns updated value after insert', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.sequence).toBe('ATCG')
      doc.insert(2, 'GGG')
      expect(doc.sequence).toBe('ATGGGCG')
    })

    it('annotations getter returns updated value after add', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.annotations.length).toBe(0)
      doc.addAnnotation({ caption: 'Test', type: 'gene', span: Span.parse('0..4') })
      expect(doc.annotations.length).toBe(1)
    })
  })

  describe('sequenceRef', () => {
    it('returns the internal sequence ref for reactive tracking', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.sequenceRef.value).toBe('ATCG')
    })

    it('updates when sequence is modified', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      doc.insert(2, 'GGG')
      expect(doc.sequenceRef.value).toBe('ATGGGCG')
    })
  })

  describe('backend integration', () => {
    it('calls backend.insert on insert', () => {
      const calls = []
      const backend = {
        insert: (data) => calls.push({ type: 'insert', ...data })
      }
      const doc = new SequenceDocument({ sequence: 'ATCG', backend })
      doc.insert(2, 'GGG')

      expect(calls.length).toBe(1)
      expect(calls[0].type).toBe('insert')
      expect(calls[0].position).toBe(2)
      expect(calls[0].text).toBe('GGG')
      expect(calls[0].id).toBeDefined()
    })

    it('calls backend.delete on delete', () => {
      const calls = []
      const backend = {
        delete: (data) => calls.push({ type: 'delete', ...data })
      }
      const doc = new SequenceDocument({ sequence: 'ATCGATCG', backend })
      doc.delete([{ start: 2, end: 5 }])

      expect(calls.length).toBe(1)
      expect(calls[0].type).toBe('delete')
      expect(calls[0].start).toBe(2)
      expect(calls[0].end).toBe(5)
    })

    it('calls backend.delete and backend.insert on replace', () => {
      const calls = []
      const backend = {
        delete: (data) => calls.push({ type: 'delete', ...data }),
        insert: (data) => calls.push({ type: 'insert', ...data })
      }
      const doc = new SequenceDocument({ sequence: 'ATCGATCG', backend })
      doc.replace(2, 5, 'XXX')

      expect(calls.length).toBe(2)
      expect(calls[0].type).toBe('delete')
      expect(calls[0].start).toBe(2)
      expect(calls[0].end).toBe(5)
      expect(calls[1].type).toBe('insert')
      expect(calls[1].position).toBe(2)
      expect(calls[1].text).toBe('XXX')
    })

    it('calls backend.annotationCreated on addAnnotation', () => {
      const calls = []
      const backend = {
        annotationCreated: (data) => calls.push(data)
      }
      const doc = new SequenceDocument({ sequence: 'ATCG', backend })
      doc.addAnnotation({ caption: 'Test', type: 'gene', span: Span.parse('0..4') })

      expect(calls.length).toBe(1)
      expect(calls[0].caption).toBe('Test')
      expect(calls[0].type).toBe('gene')
      expect(calls[0].id).toBeDefined()
    })

    it('calls backend.annotationUpdate on updateAnnotation', () => {
      const calls = []
      const backend = {
        annotationUpdate: (data) => calls.push(data)
      }
      const doc = new SequenceDocument({
        sequence: 'ATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('0..4') }],
        backend
      })
      doc.updateAnnotation({ id: 'ann1', caption: 'Updated' })

      expect(calls.length).toBe(1)
      expect(calls[0].id).toBe('ann1')
      expect(calls[0].annotationId).toBe('ann1')
      expect(calls[0].caption).toBe('Updated')
      expect(calls[0].type).toBe('gene')  // type unchanged
    })

    it('calls backend.annotationDeleted on deleteAnnotation', () => {
      const calls = []
      const backend = {
        annotationDeleted: (data) => calls.push({ type: 'deleted', ...data })
      }
      const doc = new SequenceDocument({
        sequence: 'ATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('0..4') }],
        backend
      })
      doc.deleteAnnotation('ann1')

      expect(calls.length).toBe(1)
      expect(calls[0].type).toBe('deleted')
      expect(calls[0].annotationId).toBe('ann1')
    })
  })

  describe('annotation adjustment on insert', () => {
    it('shifts annotations after insertion point', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('4..8') }]
      })
      doc.insert(2, 'GGG')
      // Original 4..8 should shift to 7..11
      expect(doc.annotations[0].span.toJSON()).toBe('7..11')
    })

    it('expands annotations containing insertion point', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('2..6') }]
      })
      doc.insert(4, 'GGG')
      // Original 2..6, insert at 4 means it's inside, so end shifts: 2..9
      expect(doc.annotations[0].span.toJSON()).toBe('2..9')
    })

    it('does not change annotations before insertion point', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('0..2') }]
      })
      doc.insert(4, 'GGG')
      expect(doc.annotations[0].span.toJSON()).toBe('0..2')
    })

    it('respects extendEndIds option', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('0..4') }]
      })
      // Insert at position 4 (end of annotation), extend end
      doc.insert(4, 'GGG', { extendEndIds: ['ann1'] })
      // Should extend to include the insertion: 0..7
      expect(doc.annotations[0].span.toJSON()).toBe('0..7')
    })

    it('shifts annotation starting at insertion point by default', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('4..8') }]
      })
      // Insert at position 4 (start of annotation), default behavior shifts
      doc.insert(4, 'GGG')
      // Should shift both start and end: 7..11
      expect(doc.annotations[0].span.toJSON()).toBe('7..11')
    })

    it('respects extendStartIds option', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('4..8') }]
      })
      // Insert at position 4 (start of annotation), extend start
      doc.insert(4, 'GGG', { extendStartIds: ['ann1'] })
      // Should keep start, shift only end: 4..11
      expect(doc.annotations[0].span.toJSON()).toBe('4..11')
    })
  })

  describe('annotation adjustment on delete', () => {
    it('shifts annotations after deletion', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('6..8') }]
      })
      doc.delete([{ start: 2, end: 4 }])
      // Delete 2 chars, annotation shifts: 6..8 -> 4..6
      expect(doc.annotations[0].span.toJSON()).toBe('4..6')
    })

    it('truncates annotations overlapping deletion from left', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('2..6') }]
      })
      doc.delete([{ start: 4, end: 8 }])
      // Annotation ends inside deletion, truncate to 2..4
      expect(doc.annotations[0].span.toJSON()).toBe('2..4')
    })

    it('shrinks annotations containing deletion', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('2..10') }]
      })
      doc.delete([{ start: 4, end: 6 }])
      // Annotation contains deletion, shrink by deletion length: 2..8
      expect(doc.annotations[0].span.toJSON()).toBe('2..8')
    })

    it('collapses annotations contained by deletion', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('4..6') }]
      })
      doc.delete([{ start: 2, end: 8 }])
      // Annotation is inside deletion range, collapse to deletion start
      expect(doc.annotations[0].span.toJSON()).toBe('2')
    })
  })

  describe('annotation adjustment on replace', () => {
    it('adjusts annotations for replacement with same length', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('6..8') }]
      })
      doc.replace(2, 4, 'XX')
      // Same length replacement, annotation unchanged
      expect(doc.annotations[0].span.toJSON()).toBe('6..8')
    })

    it('adjusts annotations for replacement with shorter text', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('6..8') }]
      })
      doc.replace(2, 5, 'X')
      // Delete 3, insert 1, net -2: 6..8 -> 4..6
      expect(doc.annotations[0].span.toJSON()).toBe('4..6')
    })

    it('adjusts annotations for replacement with longer text', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('6..8') }]
      })
      doc.replace(2, 4, 'XXXXX')
      // Delete 2, insert 5, net +3: 6..8 -> 9..11
      expect(doc.annotations[0].span.toJSON()).toBe('9..11')
    })

    it('can skip annotation adjustment with option', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCGATCG',
        annotations: [{ id: 'ann1', caption: 'Test', type: 'gene', span: Span.parse('6..8') }]
      })
      doc.replace(2, 5, 'X', { adjustAnnotations: false })
      // No adjustment, span stays the same (though it's now invalid)
      expect(doc.annotations[0].span.toJSON()).toBe('6..8')
    })
  })

  describe('gaps', () => {
    it('defaults to empty array', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.gaps).toEqual([])
    })

    it('can be set via constructor', () => {
      const gaps = [{ position: 2, length: 3 }]
      const doc = new SequenceDocument({ sequence: 'ATCG', gaps })
      expect(doc.gaps).toEqual(gaps)
    })

    it('setGaps() updates gaps', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      const gaps = [{ position: 5, length: 2 }, { position: 10, length: 1 }]
      doc.setGaps(gaps)
      expect(doc.gaps).toEqual(gaps)
    })

    it('clearGaps() sets gaps to empty array', () => {
      const doc = new SequenceDocument({
        sequence: 'ATCG',
        gaps: [{ position: 2, length: 3 }]
      })
      doc.clearGaps()
      expect(doc.gaps).toEqual([])
    })

    it('gaps getter returns current gaps', () => {
      const doc = new SequenceDocument({ sequence: 'ATCG' })
      expect(doc.gaps).toEqual([])

      const gaps = [{ position: 1, length: 2 }]
      doc.setGaps(gaps)
      expect(doc.gaps).toEqual(gaps)
    })

    it('includes gaps in toJSON()', () => {
      const gaps = [{ position: 2, length: 3 }]
      const doc = new SequenceDocument({ sequence: 'ATCG', gaps })
      const json = doc.toJSON()
      expect(json.gaps).toEqual(gaps)
    })

    it('restores gaps from fromJSON()', () => {
      const data = {
        sequence: 'ATCG',
        gaps: [{ position: 2, length: 3 }]
      }
      const doc = SequenceDocument.fromJSON(data)
      expect(doc.gaps).toEqual(data.gaps)
    })

    it('fromJSON() defaults gaps to empty array if not provided', () => {
      const data = { sequence: 'ATCG' }
      const doc = SequenceDocument.fromJSON(data)
      expect(doc.gaps).toEqual([])
    })
  })
})
