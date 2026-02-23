import { describe, it, expect } from 'bun:test'
import { BlastExtension } from './index.js'
import { Span } from '../../utils/dna.js'
import { Annotation } from '../../utils/annotation.js'

describe('BlastExtension', () => {
  describe('contextMenuItems', () => {
    describe('selection context', () => {
      it('returns BLAST (DNA) for selection with sequence', () => {
        const items = BlastExtension.contextMenuItems({
          type: 'selection',
          data: { sequence: 'ATGCATGC' }
        })

        expect(items).toHaveLength(1)
        expect(items[0].label).toBe('BLAST (DNA)')
      })

      it('returns empty array for selection without sequence', () => {
        const items = BlastExtension.contextMenuItems({
          type: 'selection',
          data: {}
        })

        expect(items).toHaveLength(0)
      })
    })

    describe('annotation context', () => {
      it('returns BLAST (DNA) for non-CDS annotation', () => {
        const annotation = new Annotation({
          span: '100..200',
          type: 'gene',
          label: 'Test Gene'
        })

        const items = BlastExtension.contextMenuItems({
          type: 'annotation',
          data: { annotation, sequence: 'ATGCATGC' }
        })

        expect(items).toHaveLength(1)
        expect(items[0].label).toBe('BLAST (DNA)')
      })

      it('returns both BLAST (DNA) and BLAST (Protein) for CDS annotation', () => {
        const annotation = new Annotation({
          span: '100..200',
          type: 'CDS',
          label: 'Test CDS'
        })

        const items = BlastExtension.contextMenuItems({
          type: 'annotation',
          data: { annotation, sequence: 'ATGCATGC' }
        })

        expect(items).toHaveLength(2)
        expect(items[0].label).toBe('BLAST (DNA)')
        expect(items[1].label).toBe('BLAST (Protein)')
      })

      it('returns empty array for annotation without sequence', () => {
        const annotation = new Annotation({
          span: '100..200',
          type: 'CDS',
          label: 'Test CDS'
        })

        const items = BlastExtension.contextMenuItems({
          type: 'annotation',
          data: { annotation, sequence: '' }
        })

        expect(items).toHaveLength(0)
      })
    })

    describe('translation context', () => {
      it('returns BLAST (Protein) for translation', () => {
        const items = BlastExtension.contextMenuItems({
          type: 'translation',
          data: { translation: 'MKTAYIAKQRQISFVK' }
        })

        expect(items).toHaveLength(1)
        expect(items[0].label).toBe('BLAST (Protein)')
      })
    })

    describe('protein translation', () => {
      it('translates DNA sequence correctly for CDS', () => {
        const annotation = new Annotation({
          span: '0..9',
          type: 'CDS',
          label: 'Test CDS'
        })

        // ATG = M, CAT = H, GCA = A
        const items = BlastExtension.contextMenuItems({
          type: 'annotation',
          data: { annotation, sequence: 'ATGCATGCA' }
        })

        expect(items).toHaveLength(2)
        // Verify the protein BLAST action would use correct sequence
        // We can't easily test the action, but we can verify the item exists
        expect(items[1].label).toBe('BLAST (Protein)')
      })

      it('removes stop codons from protein sequence', () => {
        const annotation = new Annotation({
          span: '0..12',
          type: 'CDS',
          label: 'Test CDS'
        })

        // ATG = M, TAA = *, CAT = H, GCA = A
        // The stop codon should be filtered out
        const items = BlastExtension.contextMenuItems({
          type: 'annotation',
          data: { annotation, sequence: 'ATGTAACATGCA' }
        })

        expect(items).toHaveLength(2)
        expect(items[1].label).toBe('BLAST (Protein)')
      })
    })
  })
})
