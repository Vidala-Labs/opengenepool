import { describe, it, expect } from 'vitest'
import { effect } from 'vue'
import { SequenceDocument } from './SequenceDocument.js'
import { SequenceDocumentRC } from './SequenceDocumentRC.js'
import { Span, Range, Orientation, reverseComplement } from '../utils/dna.js'
import { Annotation } from '../utils/annotation.js'

function makeInner(sequence = 'ATGGCCATTGTAATGGGCCGCTGAAA', annotations = [], opts = {}) {
  return new SequenceDocument({ sequence, annotations, ...opts })
}

describe('SequenceDocumentRC', () => {
  describe('reads (reverse-complemented view)', () => {
    it('sequence is the reverse complement of the inner sequence; length unchanged', () => {
      const inner = makeInner('ATGGGG')
      const rc = new SequenceDocumentRC(inner)
      expect(rc.sequence).toBe(reverseComplement('ATGGGG')) // CCCCAT
      expect(rc.length).toBe(inner.length)
    })

    it('sequenceRef is a reactive ref of the RC sequence', () => {
      const inner = makeInner('ATGGGG')
      const rc = new SequenceDocumentRC(inner)
      expect(rc.sequenceRef.value).toBe(reverseComplement('ATGGGG'))
    })

    it('flips an annotation span into RC coordinates and inverts the strand', () => {
      // forward [5,15) PLUS over a length-44 sequence -> RC [29,39) MINUS
      const inner = makeInner('A'.repeat(44), [
        new Annotation({ id: 'f', span: new Span([new Range(5, 15, Orientation.PLUS)]), type: 'misc_feature' })
      ])
      const rc = new SequenceDocumentRC(inner)
      const ann = rc.annotations[0]
      expect(ann.span.ranges[0].start).toBe(29)
      expect(ann.span.ranges[0].end).toBe(39)
      expect(ann.span.ranges[0].orientation).toBe(Orientation.MINUS)
      // metadata preserved
      expect(ann.id).toBe('f')
      expect(ann.type).toBe('misc_feature')
    })

    it('flips a multi-range span', () => {
      const inner = makeInner('A'.repeat(20), [
        new Annotation({ id: 'j', span: new Span([
          new Range(0, 3, Orientation.PLUS),
          new Range(10, 14, Orientation.PLUS)
        ]), type: 'misc_feature' })
      ])
      const rc = new SequenceDocumentRC(inner)
      const ranges = [...rc.annotations[0].span.ranges].sort((a, b) => a.start - b.start)
      expect(ranges[0].start).toBe(6)  // 20 - 14
      expect(ranges[0].end).toBe(10)   // 20 - 10
      expect(ranges[1].start).toBe(17) // 20 - 3
      expect(ranges[1].end).toBe(20)   // 20 - 0
      expect(ranges.every(r => r.orientation === Orientation.MINUS)).toBe(true)
    })

    it('passes name, circular, and readonly through unchanged', () => {
      const inner = makeInner('ATGC', [], { name: 'plasmid', circular: true, readonly: true })
      const rc = new SequenceDocumentRC(inner)
      expect(rc.name).toBe('plasmid')
      expect(rc.circular).toBe(true)
      expect(rc.readonly).toBe(true)
    })

    it('getAnnotation(id) returns the RC view of the annotation', () => {
      const inner = makeInner('A'.repeat(44), [
        new Annotation({ id: 'x', span: new Span([new Range(5, 15, Orientation.PLUS)]), type: 'misc_feature' })
      ])
      const rc = new SequenceDocumentRC(inner)
      const ann = rc.getAnnotation('x')
      expect(ann.span.ranges[0].start).toBe(29)
      expect(ann.span.ranges[0].orientation).toBe(Orientation.MINUS)
    })

    it('coordinateLabel maps a wrapped position to the TRUE underlying base index', () => {
      const inner = makeInner('ATGGGG') // length 6
      const rc = new SequenceDocumentRC(inner)
      expect(rc.coordinateLabel(0)).toBe(5)
      expect(rc.coordinateLabel(5)).toBe(0)
    })
  })

  describe('writes (translated to the inner document)', () => {
    it('insert: places the reverse complement of the text at the mirrored position', () => {
      const inner = makeInner('AAAATTTT') // RC view = AAAATTTT (palindromic length 8)
      const rc = new SequenceDocumentRC(inner)
      // Insert 'GG' at wrapped position 2. Inner gets RC('GG')='CC' at inner position 8-2=6.
      rc.insert(2, 'GG')
      expect(inner.sequence).toBe('AAAATT' + 'CC' + 'TT')
      // And the wrapped re-read reflects it.
      expect(rc.sequence).toBe(reverseComplement(inner.sequence))
    })

    it('insert at wrapped position 0 appends to the END of the inner sequence', () => {
      const inner = makeInner('AAAA')
      const rc = new SequenceDocumentRC(inner)
      rc.insert(0, 'GG') // inner position 4-0=4 (append); RC('GG')='CC'
      expect(inner.sequence).toBe('AAAACC')
    })

    it('insert at wrapped position N prepends to the inner sequence', () => {
      const inner = makeInner('AAAA')
      const rc = new SequenceDocumentRC(inner)
      rc.insert(4, 'GG') // inner position 4-4=0 (prepend); RC('GG')='CC'
      expect(inner.sequence).toBe('CCAAAA')
    })

    it('delete: removes the mirrored inner range and returns RC of the deleted text', () => {
      const inner = makeInner('ATGCATGC') // 8bp
      const rc = new SequenceDocumentRC(inner)
      // Delete wrapped [1,3). Inner range [8-3, 8-1) = [5,7).
      const deleted = rc.delete([{ start: 1, end: 3 }])
      const innerDeleted = 'ATGCATGC'.slice(5, 7) // 'TG'
      expect(inner.sequence).toBe('ATGCA' + 'C') // removed inner [5,7)
      expect(deleted).toBe(reverseComplement(innerDeleted))
    })

    it('replace: replaces the mirrored inner range with RC of the text', () => {
      const inner = makeInner('ATGCATGC')
      const rc = new SequenceDocumentRC(inner)
      // Replace wrapped [1,3) with 'AA'. Inner [5,7) replaced with RC('AA')='TT'.
      rc.replace(1, 3, 'AA')
      expect(inner.sequence).toBe('ATGCA' + 'TT' + 'C')
    })

    it('addAnnotation stores the un-RC span on the inner doc; wrapper re-reads it RC', async () => {
      const inner = makeInner('A'.repeat(37)) // N = 37
      const rc = new SequenceDocumentRC(inner)
      // Caller adds a plain forward [16,19) PLUS in WRAPPED coords.
      await rc.addAnnotation({ type: 'insertion', caption: '+x', span: new Span([new Range(16, 19, Orientation.PLUS)]) })
      // Inner stores the RC'd span [37-19,37-16)=[18,21) PLUS (orientation flips PLUS->... wait MINUS).
      const innerAnn = inner.annotations[0]
      expect(innerAnn.span.ranges[0].start).toBe(18)
      expect(innerAnn.span.ranges[0].end).toBe(21)
      expect(innerAnn.span.ranges[0].orientation).toBe(Orientation.MINUS)
      // Wrapper re-reads the SAME annotation flipped back: [16,19) PLUS.
      const wrappedAnn = rc.annotations[0]
      expect(wrappedAnn.span.ranges[0].start).toBe(16)
      expect(wrappedAnn.span.ranges[0].end).toBe(19)
      expect(wrappedAnn.span.ranges[0].orientation).toBe(Orientation.PLUS)
    })

    it('updateAnnotation with a caption-only partial update does not touch the span', async () => {
      const inner = makeInner('A'.repeat(20), [
        new Annotation({ id: 'u', span: new Span([new Range(2, 6, Orientation.PLUS)]), type: 'misc_feature', caption: 'old' })
      ])
      const rc = new SequenceDocumentRC(inner)
      rc.updateAnnotation({ id: 'u', caption: 'new' })
      expect(inner.getAnnotation('u').caption).toBe('new')
      // span unchanged on inner
      expect(inner.getAnnotation('u').span.ranges[0].start).toBe(2)
      expect(inner.getAnnotation('u').span.ranges[0].end).toBe(6)
    })

    it('deleteAnnotation removes by id', () => {
      const inner = makeInner('A'.repeat(20), [
        new Annotation({ id: 'd', span: new Span([new Range(2, 6, Orientation.PLUS)]), type: 'misc_feature' })
      ])
      const rc = new SequenceDocumentRC(inner)
      rc.deleteAnnotation('d')
      expect(inner.annotations.length).toBe(0)
    })

    it('setAnnotations flips each annotation to inner coordinates', () => {
      const inner = makeInner('A'.repeat(20))
      const rc = new SequenceDocumentRC(inner)
      rc.setAnnotations([
        new Annotation({ id: 's', span: new Span([new Range(2, 6, Orientation.PLUS)]), type: 'misc_feature' })
      ])
      // inner stores [20-6,20-2)=[14,18) MINUS
      expect(inner.annotations[0].span.ranges[0].start).toBe(14)
      expect(inner.annotations[0].span.ranges[0].end).toBe(18)
      expect(inner.annotations[0].span.ranges[0].orientation).toBe(Orientation.MINUS)
    })
  })

  describe('edit-then-read consistency', () => {
    it('after an insert, length and coordinateLabel reflect the new length', () => {
      const inner = makeInner('AAAA') // N=4
      const rc = new SequenceDocumentRC(inner)
      rc.insert(0, 'GG') // now length 6
      expect(rc.length).toBe(6)
      expect(rc.coordinateLabel(0)).toBe(5) // N-1 = 5
    })
  })

  describe('reactivity', () => {
    it('sequenceRef updates reactively when the inner doc mutates', () => {
      const inner = makeInner('AAAA')
      const rc = new SequenceDocumentRC(inner)
      let observed = null
      const stop = effect(() => { observed = rc.sequenceRef.value })
      expect(observed).toBe(reverseComplement('AAAA'))
      inner.insert(0, 'G') // mutate the inner shallowRef
      expect(observed).toBe(reverseComplement(inner.sequence))
      stop.effect.stop()
    })
  })

  describe('properties', () => {
    it('RC is an involution: wrapping twice yields the original sequence', () => {
      const inner = makeInner('ATGGCCATTG')
      const rc = new SequenceDocumentRC(inner)
      const rcrc = new SequenceDocumentRC(rc)
      expect(rcrc.sequence).toBe(inner.sequence)
    })

    it('a readonly inner blocks writes through the wrapper', () => {
      const inner = makeInner('AAAATTTT', [], { readonly: true })
      const rc = new SequenceDocumentRC(inner)
      rc.insert(2, 'GG')
      expect(inner.sequence).toBe('AAAATTTT') // unchanged
    })
  })
})
